import { isMap, parseDocument } from 'yaml';
import { parseEnvFile } from './env-file';

export type ComposeLint = {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
};

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

export function lintComposeYaml(source: string, envText = ''): ComposeLint[] {
  const diagnostics: ComposeLint[] = [];
  const doc = parseDocument(source, { prettyErrors: true, uniqueKeys: true });
  for (const err of doc.errors) {
    const pos = err.pos;
    const from = Array.isArray(pos) ? pos[0] ?? 0 : 0;
    const to = Array.isArray(pos) ? pos[1] ?? from + 1 : from + 1;
    diagnostics.push({
      from,
      to: Math.max(to, from + 1),
      severity: 'error',
      message: err.message.replace(/^YAMLParseError:\s*/, ''),
    });
  }

  const env = envMapFromFile(envText);
  for (const ref of findInterpolationRefs(source)) {
    if (ref.hasDefault) continue;
    if (Object.prototype.hasOwnProperty.call(env, ref.name)) continue;
    diagnostics.push({
      from: ref.from,
      to: ref.to,
      severity: 'warning',
      message: `Variable \${${ref.name}} is not set in .env`,
    });
  }

  if (doc.errors.length > 0) return diagnostics;

  const contents = doc.contents;
  if (!isMap(contents)) {
    if (source.trim()) {
      diagnostics.push({
        from: 0,
        to: Math.min(source.length, 12),
        severity: 'error',
        message: 'Compose file must be a mapping with a services: block',
      });
    }
    return diagnostics;
  }

  const services = contents.get('services');
  if (!isMap(services) || services.items.length === 0) {
    diagnostics.push({
      from: 0,
      to: Math.min(source.length, 12),
      severity: 'error',
      message: 'YAML must contain a services: block',
    });
    return diagnostics;
  }

  for (const pair of services.items) {
    const name = String(pair.key);
    const service = pair.value;
    if (!isMap(service)) continue;
    const hasImage = service.has('image');
    const hasBuild = service.has('build');
    if (!hasImage && !hasBuild) {
      const range = service.range;
      const from = range?.[0] ?? 0;
      const to = range?.[1] ?? from + name.length;
      diagnostics.push({
        from,
        to: Math.max(to, from + 1),
        severity: 'warning',
        message: `Service "${name}" has neither image nor build`,
      });
    }
  }

  return diagnostics;
}

export function lintEnvFile(source: string): ComposeLint[] {
  const diagnostics: ComposeLint[] = [];
  const seen = new Map<string, number>();
  let offset = 0;
  const lines = source.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const lineStart = offset;
    offset += line.length + 1;
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed) && !trimmed.startsWith('export ')) {
      diagnostics.push({
        from: lineStart,
        to: lineStart + line.length,
        severity: 'warning',
        message: 'Expected KEY=value (or a comment)',
      });
      continue;
    }
    const key = trimmed.replace(/^export\s+/, '').split('=')[0];
    if (!key) continue;
    const prev = seen.get(key);
    if (prev != null) {
      diagnostics.push({
        from: lineStart,
        to: lineStart + key.length,
        severity: 'warning',
        message: `Duplicate key "${key}"`,
      });
    } else {
      seen.set(key, lineStart);
    }
  }
  return diagnostics;
}
