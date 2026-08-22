export type SelfUpdateProgress = {
  percent: number;
  step: string;
  detail: string | null;
};

const PROGRESS_FILE = '.dockora-update-progress';

const LOG_RULES: Array<{ test: RegExp; percent: number; step: string }> = [
  { test: /==> Dockora self-update/i, percent: 4, step: 'start' },
  { test: /Resolving remote/i, percent: 8, step: 'resolve' },
  { test: /remote=[a-f0-9]/i, percent: 12, step: 'resolve' },
  { test: /Downloading source tarball/i, percent: 16, step: 'sync' },
  { test: /Syncing files|Git sync complete|git already at/i, percent: 22, step: 'sync' },
  { test: /Rebuilding stack/i, percent: 28, step: 'build' },
  { test: /dockora-api Building|Building api/i, percent: 38, step: 'buildApi' },
  { test: /dockora-web Building|Building web/i, percent: 52, step: 'buildWeb' },
  { test: /Compiled successfully/i, percent: 64, step: 'buildWeb' },
  { test: /exporting to image/i, percent: 72, step: 'export' },
  { test: /Image dockora-api Built|naming to .*dockora-api/i, percent: 76, step: 'buildApi' },
  { test: /Image dockora-web Built|naming to .*dockora-web/i, percent: 80, step: 'buildWeb' },
  { test: /Container dockora-api\s+Started/i, percent: 84, step: 'startApi' },
  { test: /Container dockora-api\s+Healthy/i, percent: 88, step: 'startApi' },
  { test: /Container dockora-web\s+Started/i, percent: 90, step: 'startWeb' },
  { test: /Refreshing proxy/i, percent: 93, step: 'proxy' },
  { test: /wrote \.dockora-revision/i, percent: 95, step: 'finalize' },
  { test: /Pruning Docker build cache/i, percent: 97, step: 'finalize' },
  { test: /Done\. Dockora should come back/i, percent: 100, step: 'done' },
];

export function progressFileName(): string {
  return PROGRESS_FILE;
}

export function parseProgressFile(raw: string): SelfUpdateProgress | null {
  const percentMatch = /^percent=(\d{1,3})\s*$/m.exec(raw);
  const stepMatch = /^step=([A-Za-z0-9_-]+)\s*$/m.exec(raw);
  if (!percentMatch?.[1] || !stepMatch?.[1]) return null;
  const percent = Math.min(100, Math.max(0, Number(percentMatch[1])));
  if (!Number.isFinite(percent)) return null;
  const detailMatch = /^detail=(.*)$/m.exec(raw);
  const detail = detailMatch?.[1]?.trim() || null;
  return { percent, step: stepMatch[1], detail };
}

const EXPLICIT_PROGRESS = /^==>\s*\[(\d{1,3})%\]\s+([A-Za-z0-9_-]+)/;

function consider(current: SelfUpdateProgress | null, next: SelfUpdateProgress): SelfUpdateProgress {
  if (!current || next.percent >= current.percent) return next;
  return current;
}

export function parseUpdaterLogs(logs: string): SelfUpdateProgress | null {
  let current: SelfUpdateProgress | null = null;
  for (const line of logs.split(/\r?\n/)) {
    const explicit = EXPLICIT_PROGRESS.exec(line);
    if (explicit?.[1] && explicit[2]) {
      const percent = Math.min(100, Math.max(0, Number(explicit[1])));
      if (Number.isFinite(percent)) {
        current = consider(current, {
          percent,
          step: explicit[2],
          detail: line.trim().slice(0, 160) || null,
        });
      }
      continue;
    }
    for (const rule of LOG_RULES) {
      if (rule.test.test(line)) {
        current = consider(current, {
          percent: rule.percent,
          step: rule.step,
          detail: line.trim().slice(0, 160) || null,
        });
      }
    }
  }
  return current;
}

export function mergeProgress(
  file: SelfUpdateProgress | null,
  logs: SelfUpdateProgress | null,
): SelfUpdateProgress | null {
  if (!file) return logs;
  if (!logs) return file;
  return logs.percent >= file.percent ? logs : file;
}
