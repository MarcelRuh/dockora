import type { ActionResult, ImageSummary } from '@dockora/shared';
import {
  isDockoraSelfContainer,
  isDockoraSelfImageTags,
  isImageUsedOnlyByDockoraSelf,
} from '../../domain/dockora-self.js';
import type { IDockerClient } from '../../domain/ports.js';

export interface ImagesServiceDeps {
  docker: IDockerClient;
  /** Zusätzliche Regex-Quellen (IMAGE_EXCLUDE_PREFIXES) */
  excludeTagPatterns?: RegExp[];
}

export class ImagesService {
  private readonly excludeTagPatterns: RegExp[];

  constructor(private readonly deps: ImagesServiceDeps) {
    this.excludeTagPatterns = deps.excludeTagPatterns ?? [];
  }

  async list(): Promise<ImageSummary[]> {
    const [images, containers] = await Promise.all([
      this.deps.docker.listImages(),
      this.deps.docker.listContainers(true),
    ]);

    const selfNames = new Set(
      containers.filter((c) => isDockoraSelfContainer(c)).map((c) => c.name.toLowerCase()),
    );
    const usedByMap = buildUsedByMap(containers);
    const usedByExternalMap = buildUsedByMap(
      containers.filter((c) => !isDockoraSelfContainer(c)),
    );

    return images
      .filter((img) => {
        const allUsers =
          usedByMap.get(img.id) ?? usedByMap.get(normalizeImageId(img.id)) ?? [];
        if (isImageUsedOnlyByDockoraSelf(allUsers, selfNames)) return false;
        return !isExcludedImage(img.tags, this.excludeTagPatterns);
      })
      .map((img) => {
        const usedBy =
          usedByExternalMap.get(img.id) ??
          usedByExternalMap.get(normalizeImageId(img.id)) ??
          [];
        return {
          id: img.id,
          tags: img.tags,
          size: img.size,
          createdAt: img.createdAt,
          dangling: img.dangling,
          usedBy,
        };
      });
  }

  async pull(image: string): Promise<ActionResult> {
    await this.deps.docker.pullImage(image);
    return { ok: true, message: `Image pull succeeded: ${image}` };
  }

  async remove(id: string, force = false): Promise<ActionResult> {
    await this.deps.docker.removeImage(id, force);
    return { ok: true, message: 'Image removed' };
  }

  async prune(
    danglingOnly = true,
  ): Promise<ActionResult & { imagesDeleted: number; spaceReclaimed: number }> {
    const result = await this.deps.docker.pruneImages(danglingOnly);
    return {
      ok: true,
      message: `Pruned ${result.imagesDeleted} image(s), reclaimed ${result.spaceReclaimed} bytes`,
      imagesDeleted: result.imagesDeleted,
      spaceReclaimed: result.spaceReclaimed,
    };
  }
}

function isExcludedImage(tags: string[], patterns: RegExp[]): boolean {
  if (isDockoraSelfImageTags(tags)) return true;
  if (tags.length === 0 || patterns.length === 0) return false;
  return tags.some((tag) => {
    const repo = tag.split(':')[0] ?? tag;
    return patterns.some((re) => re.test(tag) || re.test(repo));
  });
}

function buildUsedByMap(
  containers: Awaited<ReturnType<IDockerClient['listContainers']>>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const c of containers) {
    const keys = [c.imageId, c.image].filter(Boolean) as string[];
    for (const key of keys) {
      const normalized = normalizeImageId(key);
      const existing = map.get(normalized) ?? [];
      if (!existing.includes(c.name)) {
        existing.push(c.name);
        map.set(normalized, existing);
      }
      map.set(key, existing);
    }
  }

  return map;
}

function normalizeImageId(id: string): string {
  if (id.startsWith('sha256:')) return id;
  if (/^[a-f0-9]{64}$/i.test(id)) return `sha256:${id}`;
  return id;
}
