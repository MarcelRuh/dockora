import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IComposeVersionProvider } from '../../domain/ports.js';

const execFileAsync = promisify(execFile);

/**
 * Liest die Docker-Compose-Version über CLI (Plugin oder Legacy Binary).
 * Dockerode deckt Compose nicht ab – CLI ist hier bewusst erlaubt.
 */
export class ComposeVersionProvider implements IComposeVersionProvider {
  async getVersion(): Promise<string | null> {
    const fromPlugin = await this.tryExec('docker', ['compose', 'version', '--short']);
    if (fromPlugin) return fromPlugin;

    const fromLegacy = await this.tryExec('docker-compose', ['version', '--short']);
    if (fromLegacy) return fromLegacy;

    // Fallback: volle Ausgabe parsen
    const full = await this.tryExec('docker', ['compose', 'version']);
    if (full) {
      const match = full.match(/v?\d+\.\d+\.\d+/);
      return match?.[0] ?? full;
    }

    return null;
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
