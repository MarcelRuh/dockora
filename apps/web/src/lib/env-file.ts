export type EnvEntry =
  | { kind: 'pair'; key: string; value: string }
  | { kind: 'other'; raw: string };

const PAIR = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function parseEnvFile(content: string): EnvEntry[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => {
    const match = PAIR.exec(line);
    if (!match?.[1]) return { kind: 'other', raw: line };
    return { kind: 'pair', key: match[1], value: unquoteEnv(match[2] ?? '') };
  });
}

export function serializeEnvFile(entries: EnvEntry[]): string {
  const lines = entries.map((e) => (e.kind === 'pair' ? `${e.key}=${quoteEnv(e.value)}` : e.raw));
  return lines.join('\n').replace(/\n+$/, '') + (lines.length ? '\n' : '');
}

export function isSecretEnvKey(key: string): boolean {
  return /pass|secret|token|api[_-]?key|private|credential|auth(?:_|$)|pwd/i.test(key);
}

function unquoteEnv(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n');
  }
  return value;
}

function quoteEnv(value: string): string {
  if (value === '') return '';
  if (/[\s#"'\\]/.test(value) || value.startsWith(' ')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}
