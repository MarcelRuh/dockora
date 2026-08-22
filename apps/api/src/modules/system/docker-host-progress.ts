export type DockerHostUpdateStep =
  | 'start'
  | 'aptUpdate'
  | 'install'
  | 'download'
  | 'installBinary'
  | 'verify'
  | 'restart'
  | 'done'
  | 'error';

export type DockerHostUpdateProgress = {
  percent: number;
  step: string;
  detail: string | null;
};

const EXPLICIT_PROGRESS = /^==>\s*\[(\d{1,3})%\]\s+([A-Za-z0-9_-]+)/;

export function parseDockerUpdateProgressLine(line: string): DockerHostUpdateProgress | null {
  const explicit = EXPLICIT_PROGRESS.exec(line.trim());
  if (!explicit?.[1] || !explicit[2]) return null;
  const percent = Math.min(100, Math.max(0, Number(explicit[1])));
  if (!Number.isFinite(percent)) return null;
  return {
    percent,
    step: explicit[2],
    detail: line.trim().slice(0, 160) || null,
  };
}

export function applyDockerUpdateProgress(
  current: DockerHostUpdateProgress | null,
  line: string,
): DockerHostUpdateProgress | null {
  const next = parseDockerUpdateProgressLine(line);
  if (!next) return current;
  if (!current || next.percent >= current.percent) return next;
  return current;
}
