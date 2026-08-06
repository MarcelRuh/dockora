import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { IComposeVersionProvider } from '../../domain/ports.js';

const execFileAsync = promisify(execFile);

/**
 * Liest die Docker-Compose-Version.
 * Reihenfolge: Env → Host-Agent-Snap → CLI (Plugin/Legacy).
 * Dockerode deckt Compose nicht ab – CLI bleibt Fallback.
 */
export class ComposeVersionProvider implements IComposeVersionProvider {
  constructor(
    private readonly snapPath = process.env.DOCKORA_HOST_PROC_SNAP?.trim() || '/data/host-proc.snap',
  ) {}

  async getVersion(): Promise<string | null> {
    const fromEnv = process.env.DOCKER_COMPOSE_VERSION?.trim();
    if (fromEnv) return fromEnv;

    const fromSnap = await this.readFromSnap();
    if (fromSnap) return fromSnap;

    const fromPlugin = await this.tryExec('docker', ['compose', 'version', '--short']);
    if (fromPlugin) return fromPlugin;

    const fromLegacy = await this.tryExec('docker-compose', ['version', '--short']);
    if (fromLegacy) return fromLegacy;

    const full = await this.tryExec('docker', ['compose', 'version']);
    if (full) {
      const match = full.match(/v?\d+\.\d+\.\d+/);
      return match?.[0] ?? full;
    }

    return null;
  }

  private async readFromSnap(): Promise<string | null> {
    try {
      const raw = await readFile(this.snapPath, 'utf8');
      const marker = '----COMPOSE----';
      const idx = raw.indexOf(marker);
      if (idx < 0) return null;
      const section = raw.slice(idx + marker.length).split('----')[0] ?? '';
      const line = section
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (!line) return null;
      const match = line.match(/v?\d+\.\d+\.\d+/);
      return match?.[0] ?? line;
    } catch {
      return null;
    }
  }

  private async tryExec(cmd: string, args: string[]): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(cmd, args, {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
      });
      const trimmed = stdout.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }
}
