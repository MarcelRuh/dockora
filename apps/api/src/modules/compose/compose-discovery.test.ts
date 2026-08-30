import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverComposeProjects,
  encodeComposeId,
  invalidateComposeDiscoveryCache,
  resolveDiscoveredProject,
} from './compose-discovery.js';

afterEach(() => {
  invalidateComposeDiscoveryCache();
});

describe('compose discovery', () => {
  it('finds compose files and skips node_modules', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dockora-compose-'));
    await writeFile(path.join(root, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n');
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(
      path.join(root, 'node_modules', 'pkg', 'compose.yaml'),
      'services:\n  junk:\n    image: alpine\n',
    );

    const found = await discoverComposeProjects([root]);
    expect(found).toHaveLength(1);
    expect(found[0]?.composeFile).toBe('compose.yaml');
    expect(found[0]?.path).toBe(root);
  });

  it('caches repeated scans until invalidate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dockora-compose-'));
    await writeFile(path.join(root, 'compose.yml'), 'services:\n  a:\n    image: alpine\n');

    invalidateComposeDiscoveryCache();
    const first = await discoverComposeProjects([root]);
    expect(first).toHaveLength(1);

    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', 'compose.yaml'), 'services:\n  b:\n    image: alpine\n');

    const cached = await discoverComposeProjects([root]);
    expect(cached).toHaveLength(1);

    invalidateComposeDiscoveryCache();
    const fresh = await discoverComposeProjects([root]);
    expect(fresh).toHaveLength(2);
  });

  it('resolves a project by id without requiring a full rescan hit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dockora-compose-'));
    const composePath = path.join(root, 'docker-compose.yml');
    await writeFile(composePath, 'services:\n  db:\n    image: postgres\n');
    const id = encodeComposeId(composePath);

    const project = await resolveDiscoveredProject(id, [root]);
    expect(project?.absoluteComposePath).toBe(path.resolve(composePath));
    expect(project?.composeFile).toBe('docker-compose.yml');
  });

  it('rejects ids outside search paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dockora-compose-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'dockora-outside-'));
    const composePath = path.join(outside, 'compose.yaml');
    await writeFile(composePath, 'services:\n  x:\n    image: alpine\n');

    const project = await resolveDiscoveredProject(encodeComposeId(composePath), [root]);
    expect(project).toBeNull();
  });
});
