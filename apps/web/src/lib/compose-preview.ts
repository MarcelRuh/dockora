import type { ComposeChangePreview } from '@dockora/shared';

type PreviewCopy = {
  previewAdded: string;
  previewRemoved: string;
  previewImages: string;
  previewEnv: string;
  previewNone: string;
};

/** Turn API preview into ConfirmDialog consequence lines. */
export function formatComposePreviewLines(
  preview: ComposeChangePreview,
  copy: PreviewCopy,
): string[] {
  const lines: string[] = [];
  if (preview.servicesAdded.length > 0) {
    lines.push(copy.previewAdded.replace('{list}', preview.servicesAdded.join(', ')));
  }
  if (preview.servicesRemoved.length > 0) {
    lines.push(copy.previewRemoved.replace('{list}', preview.servicesRemoved.join(', ')));
  }
  if (preview.imageChanges.length > 0) {
    lines.push(copy.previewImages);
    for (const ch of preview.imageChanges) {
      lines.push(`${ch.service}: ${ch.currentImage ?? '—'} → ${ch.desiredImage ?? '—'}`);
    }
  }
  if (preview.envChangedServices.length > 0) {
    lines.push(copy.previewEnv.replace('{list}', preview.envChangedServices.join(', ')));
  }
  if (lines.length === 0) {
    lines.push(copy.previewNone);
  }
  return lines;
}
