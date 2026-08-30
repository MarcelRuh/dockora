import { parseEnvFile } from './env-file';

export function envMapFromFile(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of parseEnvFile(source)) {
    if (entry.kind === 'pair') out[entry.key] = entry.value;
  }
  return out;
}

export function findInterpolationRefs(yamlText: string): Array<{
  name: string;
  from: number;
  to: number;
  hasDefault: boolean;
}> {
  const refs: Array<{ name: string; from: number; to: number; hasDefault: boolean }> = [];
  const isNameChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  let i = 0;
  while (i < yamlText.length) {
    if (yamlText[i] !== '$') {
      i += 1;
      continue;
    }
    if (yamlText[i + 1] === '{') {
      const from = i;
      const close = yamlText.indexOf('}', i + 2);
      if (close < 0) break;
      const inner = yamlText.slice(i + 2, close);
      const defAt = inner.indexOf(':-');
      const name = (defAt >= 0 ? inner.slice(0, defAt) : inner).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        refs.push({ name, from, to: close + 1, hasDefault: defAt >= 0 });
      }
      i = close + 1;
      continue;
    }
    if (yamlText[i + 1] && /[A-Za-z_]/.test(yamlText[i + 1]!)) {
      const from = i;
      i += 1;
      while (i < yamlText.length && isNameChar(yamlText[i]!)) i += 1;
      refs.push({ name: yamlText.slice(from + 1, i), from, to: i, hasDefault: false });
      continue;
    }
    i += 1;
  }
  return refs;
}

export function previewComposeInterpolation(
  yamlText: string,
  envText: string,
): { preview: string; missing: string[] } {
  const env = envMapFromFile(envText);
  const missing: string[] = [];
  const refs = findInterpolationRefs(yamlText);
  let preview = yamlText;
  for (const ref of [...refs].reverse()) {
    const raw = yamlText.slice(ref.from, ref.to);
    let replacement = raw;
    if (Object.prototype.hasOwnProperty.call(env, ref.name)) {
      replacement = env[ref.name] ?? '';
    } else if (raw.includes(':-')) {
      replacement = raw.slice(raw.indexOf(':-') + 2, -1);
    } else if (!missing.includes(ref.name)) {
      missing.push(ref.name);
    }
    preview = preview.slice(0, ref.from) + replacement + preview.slice(ref.to);
  }
  return { preview, missing };
}
