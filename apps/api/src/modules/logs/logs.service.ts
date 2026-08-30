import type { LogEntry, LogLevel } from '@dockora/shared';
import { mapPool } from '../../infrastructure/async/map-pool.js';
import type { IDockerClient } from '../../domain/ports.js';

export interface LogsQuery {
  container?: string;
  level?: LogLevel;
  q?: string;
  limit?: number;
  since?: string;
}

export interface LogsServiceDeps {
  docker: IDockerClient;
}

const MAX_LOG_TARGETS = 12;
const LEVEL_PATTERNS: Array<{ level: LogLevel; pattern: RegExp }> = [
  { level: 'error', pattern: /\b(error|err|fatal|panic|critical)\b/i },
  { level: 'warn', pattern: /\b(warn|warning)\b/i },
  { level: 'debug', pattern: /\b(debug|trace|verbose)\b/i },
  { level: 'info', pattern: /\b(info|notice)\b/i },
];

export class LogsService {
  constructor(private readonly deps: LogsServiceDeps) {}

  async aggregate(query: LogsQuery = {}): Promise<LogEntry[]> {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const perContainer = Math.max(Math.ceil(limit / 5), 20);

    const containers = await this.deps.docker.listContainers(true);
    let targets = containers;

    if (query.container) {
      const needle = query.container.toLowerCase();
      targets = containers.filter(
        (c) => c.id.startsWith(needle) || c.name.toLowerCase().includes(needle),
      );
    } else {
      targets = containers.filter((c) => c.status === 'running');
    }

    targets = targets.slice(0, MAX_LOG_TARGETS);

    const entries: LogEntry[] = [];
    const sinceMs = query.since ? Date.parse(query.since) : NaN;

    await mapPool(targets, 4, async (container) => {
      try {
        const raw = await this.deps.docker.getContainerLogs(container.id, {
          tail: perContainer,
          timestamps: true,
          stdout: true,
          stderr: true,
        });

        const lines = raw.split('\n').filter(Boolean);
        for (const line of lines) {
          const parsed = parseLogLine(line, container.id, container.name);
          if (Number.isFinite(sinceMs) && Date.parse(parsed.timestamp) < sinceMs) {
            continue;
          }
          if (query.level && parsed.level !== query.level) {
            continue;
          }
          if (query.q && !parsed.message.toLowerCase().includes(query.q.toLowerCase())) {
            continue;
          }
          entries.push(parsed);
        }
      } catch {
        // Container ohne Logs überspringen
      }
    });

    entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return entries.slice(0, limit);
  }
}

function parseLogLine(line: string, containerId: string, containerName: string): LogEntry {
  const cleaned = stripDockerLogPrefix(line);
  const { timestamp, message } = extractTimestamp(cleaned);
  const level = detectLevel(message);

  return {
    id: `${containerId}-${timestamp}-${hash(message)}`,
    containerId,
    containerName,
    level,
    message,
    timestamp,
  };
}

function stripDockerLogPrefix(line: string): string {
  if (line.length > 8 && (line.charCodeAt(0) < 32 || line.startsWith('\u0001'))) {
    return line.slice(8);
  }
  return line;
}

function extractTimestamp(line: string): { timestamp: string; message: string } {
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+-Z]+)\s+(.*)$/);
  if (isoMatch) {
    return { timestamp: isoMatch[1]!, message: isoMatch[2]! };
  }

  const rfcMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.*)$/);
  if (rfcMatch) {
    return { timestamp: new Date(rfcMatch[1]!).toISOString(), message: rfcMatch[2]! };
  }

  return { timestamp: new Date().toISOString(), message: line };
}

function detectLevel(message: string): LogLevel {
  for (const { level, pattern } of LEVEL_PATTERNS) {
    if (pattern.test(message)) {
      return level;
    }
  }
  return 'info';
}

function hash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
