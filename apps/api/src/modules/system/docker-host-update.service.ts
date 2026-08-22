import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActionResult } from '@dockora/shared';
import {
  fetchDockerComponentLatest,
  normalizeDockerVersion,
} from './docker-host-versions.js';

const execFileAsync = promisify(execFile);
const HOST_AGENT = 'dockora-host-agent';
const APPLY_TIMEOUT_MS = 10 * 60 * 1000;

export type DockerHostComponent = 'engine' | 'compose';

const ENGINE_SCRIPT = `set -eu
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  if dpkg -l docker-ce 2>/dev/null | grep -q '^ii'; then
    apt-get install -y -o Dpkg::Options::=--force-confold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif dpkg -l docker.io 2>/dev/null | grep -q '^ii'; then
    apt-get install -y -o Dpkg::Options::=--force-confold docker.io docker-compose-plugin
  else
    apt-get install -y -o Dpkg::Options::=--force-confold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  docker version --format '{{.Server.Version}}' 2>/dev/null || true
  exit 0
fi
if command -v dnf >/dev/null 2>&1; then
  dnf upgrade -y docker-ce docker-ce-cli docker-compose-plugin
  docker version --format '{{.Server.Version}}' 2>/dev/null || true
  exit 0
fi
echo 'Kein apt/dnf auf dem Host – Engine-Update nicht automatisch möglich' >&2
exit 2
`;

const COMPOSE_SCRIPT = `set -eu
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1 && apt-cache show docker-compose-plugin >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -o Dpkg::Options::=--force-confold docker-compose-plugin
  docker compose version --short 2>/dev/null || true
  exit 0
fi
if command -v dnf >/dev/null 2>&1; then
  dnf upgrade -y docker-compose-plugin
  docker compose version --short 2>/dev/null || true
  exit 0
fi
arch=$(uname -m)
case "$arch" in
  x86_64) gharch=x86_64 ;;
  aarch64|arm64) gharch=aarch64 ;;
  *) echo "Unsupported arch: $arch" >&2; exit 2 ;;
esac
url="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$gharch"
tmp=$(mktemp)
if command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$url"
elif command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "$tmp" "$url"
else
  echo 'wget/curl fehlen auf dem Host' >&2
  rm -f "$tmp"
  exit 2
fi
chmod +x "$tmp"
dir=/usr/libexec/docker/cli-plugins
mkdir -p "$dir"
mv "$tmp" "$dir/docker-compose"
docker compose version --short 2>/dev/null || true
`;

export class DockerHostUpdateService {
  async latest(): Promise<{ engine: string | null; compose: string | null }> {
    try {
      return await fetchDockerComponentLatest();
    } catch {
      return { engine: null, compose: null };
    }
  }

  async apply(component: DockerHostComponent): Promise<ActionResult> {
    const script = component === 'engine' ? ENGINE_SCRIPT : COMPOSE_SCRIPT;
    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', HOST_AGENT, 'nsenter', '-t', '1', '-m', '-u', '-i', '-n', 'sh', '-c', script],
        { timeout: APPLY_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      );
      const combined = `${stdout}\n${stderr}`.trim();
      const version = normalizeDockerVersion(combined);
      const label = component === 'engine' ? 'Docker Engine' : 'Docker Compose';
      return {
        ok: true,
        message: version
          ? `${label} aktualisiert (${version})`
          : `${label} Update ausgeführt`,
      };
    } catch (error) {
      const err = error as { stderr?: string; message?: string; code?: string };
      const detail = err.stderr?.trim() || err.message || String(error);
      if (/no such container/i.test(detail) || err.code === 'ENOENT') {
        return {
          ok: false,
          message:
            'Host-Agent nicht erreichbar (dockora-host-agent). Compose-Install mit host-agent wird für Host-Updates benötigt.',
        };
      }
      return { ok: false, message: detail.slice(0, 2000) };
    }
  }
}
