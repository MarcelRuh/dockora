import { parseDocument } from 'yaml';

export type FormatResult = { ok: true; text: string } | { ok: false; error: string };

const STRINGIFY = {
  indent: 2,
  lineWidth: 0,
  minContentWidth: 0,
  indentSeq: true,
} as const;

/**
 * Pretty-print Compose YAML with 2-space indent.
 * Comments and quoted scalars (e.g. `"8080:80"`) are kept.
 */
export function formatComposeYaml(source: string): FormatResult {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replace(/^\uFEFF/, '').replace(/\t/g, '  ');
  if (!normalized.trim()) {
    return { ok: true, text: source };
  }

  try {
    const doc = parseDocument(normalized, {
      prettyErrors: true,
      uniqueKeys: false,
    });
    const firstError = doc.errors[0];
    if (firstError) {
      return { ok: false, error: firstError.message };
    }

    let text = doc.toString(STRINGIFY);
    if (!text.endsWith('\n')) text += '\n';
    if (newline === '\r\n') text = text.replace(/\n/g, '\r\n');
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Trim trailing spaces, drop extra blank lines at EOF, keep comments. */
export function formatEnvFile(source: string): FormatResult {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trimEnd());
  while (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 1 && lines[0] === '') {
    return { ok: true, text: '' };
  }
  return { ok: true, text: `${lines.join(newline)}${newline}` };
}
