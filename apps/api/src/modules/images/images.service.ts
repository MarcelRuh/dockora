import type { ActionResult, ImageSummary } from '@dockora/shared';
import type { IDockerClient } from '../../domain/ports.js';

/** Standard: Images der Dockora-Suite selbst ausblenden */
const DEFAULT_EXCLUDE_TAG_PATTERNS = [/^dockora(-|[/:])/i, /^dockora$/i];

export interface ImagesServiceDeps {
  docker: IDockerClient;
  /** Zusätzliche Regex-Quellen; Default blendet dockora-* aus */
  excludeTagPatterns?: RegExp[];
}

export class ImagesService {
  private readonly excludeTagPatterns: RegExp[];

  constructor(private readonly deps: ImagesServiceDeps) {
    this.excludeTagPatterns =
      deps.excludeTagPatterns && deps.excludeTagPatterns.length > 0
        ? deps.excludeTagPatterns
        : DEFAULT_EXCLUDE_TAG_PATTERNS;
  }

  async list(): Promise<ImageSummary[]> {
    const [images, containers] = await Promise.all([
      this.deps.docker.listImages(),
      this.deps.docker.listContainers(true),
    ]);

    const usedByMap = buildUsedByMap(containers);

    return images
      .filter((img) => !isExcludedImage(img.tags, this.excludeTagPatterns))
      .map((img) => ({
        id: img.id,
        tags: img.tags,
        size: img.size,
        createdAt: img.createdAt,
        dangling: img.dangling,
        usedBy: usedByMap.get(img.id) ?? usedByMap.get(normalizeImageId(img.id)) ?? [],
      }));
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
  if (tags.length === 0) return false;
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
