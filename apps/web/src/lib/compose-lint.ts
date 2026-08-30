import { isMap, parseDocument } from 'yaml';
import { envMapFromFile, findInterpolationRefs } from './compose-interpolation';

export type ComposeLint = {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
};

export {
  envMapFromFile,
  findInterpolationRefs,
  previewComposeInterpolation,
} from './compose-interpolation';

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
