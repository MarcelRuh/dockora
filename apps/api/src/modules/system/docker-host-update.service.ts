import { spawn } from 'node:child_process';
import type { ActionResult } from '@dockora/shared';
import { parseDockerUpdateProgressLine } from './docker-host-progress.js';
import {
  fetchDockerComponentLatest,
  normalizeDockerVersion,
} from './docker-host-versions.js';

const HOST_AGENT = 'dockora-host-agent';
const APPLY_TIMEOUT_MS = 10 * 60 * 1000;

export type DockerHostComponent = 'engine' | 'compose';

export type DockerHostUpdateStatus = {
  updating: boolean;
  target: DockerHostComponent | null;
  percent: number;
  step: string;
  detail: string | null;
  message: string | null;
  ok: boolean | null;
};

const ENGINE_SCRIPT = `set -eu
export DEBIAN_FRONTEND=noninteractive
echo "==> [6%] start"
if command -v apt-get >/dev/null 2>&1; then
  echo "==> [18%] aptUpdate"
  apt-get update -qq
  echo "==> [42%] install"
  if dpkg -l docker-ce 2>/dev/null | grep -q '^ii'; then
    apt-get install -y -o Dpkg::Options::=--force-confold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif dpkg -l docker.io 2>/dev/null | grep -q '^ii'; then
    apt-get install -y -o Dpkg::Options::=--force-confold docker.io docker-compose-plugin
  else
    apt-get install -y -o Dpkg::Options::=--force-confold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  echo "==> [88%] restart"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    docker version --format '{{.Server.Version}}' 2>/dev/null && break
    sleep 2
  done
  echo "==> [100%] done"
  exit 0
fi
if command -v dnf >/dev/null 2>&1; then
  echo "==> [42%] install"
  dnf upgrade -y docker-ce docker-ce-cli docker-compose-plugin
  echo "==> [88%] restart"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    docker version --format '{{.Server.Version}}' 2>/dev/null && break
    sleep 2
  done
  echo "==> [100%] done"
  exit 0
fi
echo "==> [0%] error"
echo 'Kein apt/dnf auf dem Host – Engine-Update nicht automatisch möglich' >&2
exit 2
`;

const COMPOSE_SCRIPT = `set -eu
export DEBIAN_FRONTEND=noninteractive
echo "==> [6%] start"
if command -v apt-get >/dev/null 2>&1 && apt-cache show docker-compose-plugin >/dev/null 2>&1; then
  echo "==> [18%] aptUpdate"
  apt-get update -qq
  echo "==> [50%] install"
  apt-get install -y -o Dpkg::Options::=--force-confold docker-compose-plugin
  echo "==> [90%] verify"
  docker compose version --short 2>/dev/null || true
  echo "==> [100%] done"
  exit 0
fi
if command -v dnf >/dev/null 2>&1; then
  echo "==> [50%] install"
  dnf upgrade -y docker-compose-plugin
  echo "==> [90%] verify"
  docker compose version --short 2>/dev/null || true
  echo "==> [100%] done"
  exit 0
fi
arch=$(uname -m)
case "$arch" in
  x86_64) gharch=x86_64 ;;
  aarch64|arm64) gharch=aarch64 ;;
  *) echo "==> [0%] error"; echo "Unsupported arch: $arch" >&2; exit 2 ;;
esac
url="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$gharch"
tmp=$(mktemp)
echo "==> [28%] download"
if command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$url"
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "$tmp" "$url"
else
  echo "==> [0%] error"
  echo 'wget/curl fehlen auf dem Host' >&2
  rm -f "$tmp"
  exit 2
fi
echo "==> [72%] installBinary"
chmod +x "$tmp"
dir=/usr/libexec/docker/cli-plugins
mkdir -p "$dir"
mv "$tmp" "$dir/docker-compose"
echo "==> [90%] verify"
docker compose version --short 2>/dev/null || true
echo "==> [100%] done"
`;

function idleStatus(): DockerHostUpdateStatus {
  return {
    updating: false,
    target: null,
    percent: 0,
    step: 'idle',
    detail: null,
    message: null,
    ok: null,
  };
}

export class DockerHostUpdateService {
  private current: DockerHostUpdateStatus = idleStatus();

  status(): DockerHostUpdateStatus {
    return { ...this.current };
  }

  async latest(): Promise<{ engine: string | null; compose: string | null }> {
    try {
      return await fetchDockerComponentLatest();
    } catch {
      return { engine: null, compose: null };
    }
  }

  async apply(component: DockerHostComponent): Promise<ActionResult> {
    if (this.current.updating) {
      return { ok: false, message: 'Ein Docker-Update läuft bereits.' };
    }

    const script = component === 'engine' ? ENGINE_SCRIPT : COMPOSE_SCRIPT;
    this.patch({
      updating: true,
      target: component,
      percent: 2,
      step: 'start',
      detail: null,
      message: null,
      ok: null,
    });

    try {
      const { stdout, stderr, code } = await this.runHostScript(script);
      const combined = `${stdout}\n${stderr}`.trim();
      if (code !== 0) {
        const detail = combined.slice(0, 2000) || `exit ${code}`;
        this.patch({
          updating: false,
          percent: this.current.percent,
          step: 'error',
          detail,
          message: detail,
          ok: false,
        });
        if (/no such container/i.test(detail)) {
          return {
            ok: false,
            message:
              'Host-Agent nicht erreichbar (dockora-host-agent). Compose-Install mit host-agent wird für Host-Updates benötigt.',
          };
        }
        return { ok: false, message: detail };
      }

      const version = normalizeDockerVersion(combined);
      const label = component === 'engine' ? 'Docker Engine' : 'Docker Compose';
      const message = version
        ? `${label} aktualisiert (${version})`
        : `${label} Update ausgeführt`;
      this.patch({
        updating: false,
        percent: 100,
        step: 'done',
        detail: message,
        message,
        ok: true,
      });
      return { ok: true, message };
    } catch (error) {
      const err = error as { stderr?: string; message?: string; code?: string };
      const detail = err.stderr?.trim() || err.message || String(error);
      if (/no such container/i.test(detail) || err.code === 'ENOENT') {
        const message =
          'Host-Agent nicht erreichbar (dockora-host-agent). Compose-Install mit host-agent wird für Host-Updates benötigt.';
        this.patch({
          updating: false,
          step: 'error',
          detail: message,
          message,
          ok: false,
        });
        return { ok: false, message };
      }
      this.patch({
        updating: false,
        step: 'error',
        detail: detail.slice(0, 2000),
        message: detail.slice(0, 2000),
        ok: false,
      });
      return { ok: false, message: detail.slice(0, 2000) };
    }
  }

  private patch(partial: Partial<DockerHostUpdateStatus>): void {
    this.current = { ...this.current, ...partial };
  }

  private ingestLine(line: string): void {
    const next = parseDockerUpdateProgressLine(line);
    if (!next || next.percent < this.current.percent) return;
    this.patch({
      percent: next.percent,
      step: next.step,
      detail: next.detail,
    });
  }

  private runHostScript(script: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'docker',
        ['exec', HOST_AGENT, 'nsenter', '-t', '1', '-m', '-u', '-i', '-n', 'sh', '-c', script],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let stdout = '';
      let stderr = '';
      let stdoutBuf = '';
      let stderrBuf = '';
      let settled = false;

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Docker-Update Timeout nach 10 Minuten'));
      }, APPLY_TIMEOUT_MS);

      const takeLines = (chunk: string, from: 'stdout' | 'stderr') => {
        const prev = from === 'stdout' ? stdoutBuf : stderrBuf;
        const next = prev + chunk;
        const parts = next.split(/\r?\n/);
        const rest = parts.pop() ?? '';
        if (from === 'stdout') stdoutBuf = rest;
        else stderrBuf = rest;
        for (const line of parts) this.ingestLine(line);
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        takeLines(text, 'stdout');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr += text;
        takeLines(text, 'stderr');
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (stdoutBuf) this.ingestLine(stdoutBuf);
        if (stderrBuf) this.ingestLine(stderrBuf);
        finish(code ?? 1);
      });
    });
  }
}
