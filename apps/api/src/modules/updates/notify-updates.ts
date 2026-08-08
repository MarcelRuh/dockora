import type { UpdateCheckResult } from '@dockora/shared';
import type { NotificationsService } from '../notifications/notifications.service.js';

function containerName(row: Pick<UpdateCheckResult, 'containerName' | 'containerId'>): string {
  return row.containerName.replace(/^\//, '') || row.containerId.slice(0, 12);
}

function detailFields(rows: UpdateCheckResult[]) {
  return rows.slice(0, 10).map((r) => ({
    name: containerName(r),
    value: `\`${r.image}\`${r.currentTag ? `\nTag: \`${r.currentTag}\`` : ''}`,
    inline: true,
  }));
}

/** Discord + in-app: available image updates (manual or scheduled). */
export async function notifyUpdatesAvailable(
  notifications: NotificationsService,
  results: UpdateCheckResult[],
): Promise<void> {
  const available = results.filter((r) => r.updateAvailable && !r.error);
  if (available.length === 0) return;

  const names = available.map(containerName);
  const n = available.length;
  await notifications.notify(
    'update.available',
    n === 1 ? 'Update verfügbar' : 'Updates verfügbar',
    n === 1
      ? `Für **${names[0]}** ist ein neues Image verfügbar.`
      : `${n} Container haben neue Images.`,
    'info',
    { containers: names, fields: detailFields(available) },
  );
}

/** Discord + in-app after successful pull/recreate. */
export async function notifyUpdatesInstalled(
  notifications: NotificationsService,
  installed: UpdateCheckResult[],
  opts?: { auto?: boolean },
): Promise<void> {
  if (installed.length === 0) return;
  const names = installed.map(containerName);
  const n = names.length;
  const auto = opts?.auto === true;
  await notifications.notify(
    'update.installed',
    auto
      ? n === 1
        ? 'Auto-Update installiert'
        : 'Auto-Updates installiert'
      : n === 1
        ? 'Update installiert'
        : 'Updates installiert',
    n === 1
      ? `**${names[0]}** wurde aktualisiert (Pull + Recreate).`
      : `${n} Container aktualisiert (Pull + Recreate).`,
    'success',
    { containers: names, fields: detailFields(installed) },
  );
}
