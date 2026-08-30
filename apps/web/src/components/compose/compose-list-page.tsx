'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComposeProjectSummary } from '@dockora/shared';
import {
  composeAction,
  deleteComposeProject,
  fetchComposeProjects,
  fetchContainers,
  previewComposeChanges,
} from '@/lib/api';
import { formatComposePreviewLines } from '@/lib/compose-preview';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { useDockerLiveReload } from '@/hooks/use-docker-live-reload';
import { canAdmin, canOperate } from '@/lib/roles';
import { composeStatusTone } from '@/lib/status';
import { resolveContainerIconUrl } from '@/lib/container-icon';
import { Button, FilterBar, Input, buttonClassName } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ServiceIcon } from '@/components/ui/service-icon';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-parts';

type ConfirmKind = 'up' | 'down' | 'restart' | 'recreate' | 'delete';
type ConfirmState = {
  kind: ConfirmKind;
  ids: string[];
  names: string[];
  removeVolumes?: boolean;
  consequences: string[];
};

export function ComposeListPage() {
  const { t } = useLocale();
  const { authEnabled, user } = useAuth();
  const canOps = canOperate(user?.role, authEnabled);
  const isAdmin = canAdmin(user?.role, authEnabled);
  const [items, setItems] = useState<ComposeProjectSummary[]>([]);
  const [projectIcons, setProjectIcons] = useState<Record<string, string[]>>({});
  const [projectUnhealthy, setProjectUnhealthy] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async (opts?: { clearError?: boolean; silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    if (opts?.clearError) setError(null);
    try {
      const [projects, containers] = await Promise.all([
        fetchComposeProjects(),
        fetchContainers().catch(() => []),
      ]);
      setItems(projects);
      const icons: Record<string, string[]> = {};
      const unhealthy: Record<string, number> = {};
      for (const c of containers) {
        const project = c.composeProject;
        if (!project) continue;
        const url = resolveContainerIconUrl(c.labels);
        if (url) {
          const list = icons[project] ?? (icons[project] = []);
          if (!list.includes(url)) list.push(url);
        }
        if (c.health === 'unhealthy') {
          unhealthy[project] = (unhealthy[project] ?? 0) + 1;
        }
      }
      setProjectIcons(icons);
      setProjectUnhealthy(unhealthy);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.compose.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.compose.loadError]);

  useEffect(() => {
    void load({ clearError: true });
  }, [load]);

  useDockerLiveReload(() => void load({ silent: true }), 60_000);

  const run = async (id: string, action: 'up' | 'down' | 'restart' | 'pull' | 'build') => {
    setBusy(id);
    setError(null);
    try {
      await composeAction(id, action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
    }
  };

  const openConfirm = async (kind: ConfirmKind, ids: string[]) => {
    const targets = items.filter((p) => ids.includes(p.id));
    if (targets.length === 0) return;
    setConfirmBusy(true);
    setError(null);
    try {
      let consequences: string[] = [];
      if (kind === 'up' || kind === 'recreate' || kind === 'delete') {
        const previews = await Promise.all(
          targets.map(async (p) => {
            try {
              return await previewComposeChanges(p.id);
            } catch {
              return null;
            }
          }),
        );
        for (const preview of previews) {
          if (preview) {
            consequences.push(...formatComposePreviewLines(preview, t.compose));
          }
        }
      }
      if (kind === 'down') {
        consequences = [...t.compose.downConsequences];
      }
      if (kind === 'restart') {
        consequences = [...t.compose.restartConsequences];
      }
      if (kind === 'recreate') {
        consequences = [...consequences, ...t.compose.recreateConsequences];
      }
      if (kind === 'delete') {
        consequences = [...consequences, ...t.compose.deleteConsequences];
      }
      setConfirm({
        kind,
        ids,
        names: targets.map((p) => p.name),
        removeVolumes: kind === 'delete' ? false : undefined,
        consequences,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setConfirmBusy(false);
    }
  };

  const executeConfirm = async () => {
    if (!confirm) return;
    const { kind, ids, removeVolumes } = confirm;
    setConfirm(null);
    setBulkBusy(true);
    setError(null);
    setBulkProgress({ done: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        setBusy(id);
        setBulkProgress({ done: i, total: ids.length });
        if (kind === 'delete') {
          await deleteComposeProject(id, {
            removeFiles: true,
            removeVolumes: Boolean(removeVolumes),
          });
        } else {
          const action =
            kind === 'up'
              ? 'up'
              : kind === 'down'
                ? 'down'
                : kind === 'recreate'
                  ? 'recreate'
                  : 'restart';
          await composeAction(id, action);
        }
        setBulkProgress({ done: i + 1, total: ids.length });
      }
      setSelected(new Set());
      await load({ clearError: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.common.failed;
      await load();
      setError(msg);
    } finally {
      setBusy(null);
      setBulkBusy(false);
      setBulkProgress(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q) || p.status.toLowerCase().includes(q),
    );
  }, [items, query]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  };

  const selectedIds = Array.from(selected);
  const anyBusy = Boolean(busy) || bulkBusy || confirmBusy;

  const rows = filtered.map((p) => [
    <input
      key={`cb-${p.id}`}
      type="checkbox"
      className="h-3.5 w-3.5 accent-dockora-pink"
      checked={selected.has(p.id)}
      onChange={() => toggleOne(p.id)}
      aria-label={p.name}
    />,
    <Link
      key={`n-${p.id}`}
      href={`/compose/${encodeURIComponent(p.id)}`}
      className="dockora-link inline-flex items-center gap-2 font-medium"
    >
      <span className="flex items-center -space-x-1.5">
        {(projectIcons[p.name] ?? []).slice(0, 6).map((url) => (
          <ServiceIcon key={url} url={url} alt={p.name} size="sm" className="ring-2 ring-dockora-bg" />
        ))}
      </span>
      <span>{p.name}</span>
      {(projectUnhealthy[p.name] ?? 0) > 0 ? (
        <StatusBadge status="danger" label={`${t.compose.unhealthy} ${projectUnhealthy[p.name]}`} />
      ) : null}
    </Link>,
    <StatusBadge key={`s-${p.id}`} status={composeStatusTone(p.status)} label={p.status} />,
    <span key={`p-${p.id}`} className="font-mono text-xs text-dockora-muted">
      {p.path}
    </span>,
    <span key={`c-${p.id}`} className="font-mono text-xs tabular-nums">
      {p.runningCount}/{p.containerCount}
    </span>,
    <div key={`a-${p.id}`} className="inline-flex flex-nowrap items-center gap-1.5">
      {canOps ? (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={anyBusy}
            onClick={() => void openConfirm('up', [p.id])}
          >
            {t.compose.up}
          </Button>
          <Button
            size="sm"
            disabled={anyBusy}
            onClick={() => void openConfirm('recreate', [p.id])}
          >
            {t.compose.recreate}
          </Button>
          {isAdmin ? (
            <Button
              size="sm"
              disabled={anyBusy}
              onClick={() => void openConfirm('down', [p.id])}
            >
              {t.compose.down}
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={anyBusy}
            onClick={() => void openConfirm('restart', [p.id])}
          >
            {t.compose.restart}
          </Button>
          <Button size="sm" disabled={anyBusy} onClick={() => void run(p.id, 'pull')}>
            {t.compose.pull}
          </Button>
          <Button size="sm" disabled={anyBusy} onClick={() => void run(p.id, 'build')}>
            {t.compose.build}
          </Button>
        </>
      ) : null}
      {isAdmin ? (
        <Button
          size="sm"
          variant="danger"
          disabled={anyBusy}
          onClick={() => void openConfirm('delete', [p.id])}
        >
          {t.common.delete}
        </Button>
      ) : null}
    </div>,
  ]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t.compose.title}
        subtitle={t.compose.subtitle}
        actions={
          <div className="flex gap-2">
            {canOps ? (
              <Link href="/compose/new" className={buttonClassName({ variant: 'primary' })}>
                {t.compose.create}
              </Link>
            ) : null}
            <Button onClick={() => void load({ clearError: true })}>{t.common.refresh}</Button>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      <FilterBar>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.common.search}
          className="max-w-md"
        />
      </FilterBar>
      {bulkProgress ? (
        <p className="font-mono text-xs text-dockora-muted">
          {t.common.bulkProgress
            .replace('{done}', String(bulkProgress.done))
            .replace('{total}', String(bulkProgress.total))}
        </p>
      ) : null}

      {canOps && selectedIds.length > 0 ? (
        <FilterBar>
          <span className="text-sm text-dockora-muted">
            {t.common.selected.replace('{count}', String(selectedIds.length))}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={anyBusy}
              onClick={() => void openConfirm('up', selectedIds)}
            >
              {t.compose.bulkUp}
            </Button>
            <Button
              size="sm"
              disabled={anyBusy}
              onClick={() => void openConfirm('recreate', selectedIds)}
            >
              {t.compose.bulkRecreate}
            </Button>
            <Button
              size="sm"
              disabled={anyBusy}
              onClick={() => void openConfirm('restart', selectedIds)}
            >
              {t.compose.bulkRestart}
            </Button>
            {isAdmin ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={anyBusy}
                  onClick={() => void openConfirm('down', selectedIds)}
                >
                  {t.compose.bulkDown}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={anyBusy}
                  onClick={() => void openConfirm('delete', selectedIds)}
                >
                  {t.compose.bulkDelete}
                </Button>
              </>
            ) : null}
          </div>
        </FilterBar>
      ) : null}

      {loading ? <LoadingState message={t.common.loading} /> : null}
      {!loading ? (
        <DataTable
          stickyFirst
          stickyLast
          headers={[
            '',
            t.common.name,
            t.common.status,
            t.compose.path,
            t.compose.containers,
            t.common.actions,
          ]}
          rows={rows}
          empty={<EmptyState message={t.compose.empty} />}
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <p className="font-mono text-xs text-dockora-muted">
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-dockora-pink"
              checked={allSelected}
              onChange={toggleAll}
            />
            {t.common.selectAll}
          </label>
        </p>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm?.kind === 'delete'
            ? t.common.delete
            : confirm?.kind === 'down'
              ? t.compose.down
            : confirm?.kind === 'restart'
              ? t.compose.restart
              : confirm?.kind === 'recreate'
                ? t.compose.recreate
                : t.compose.previewTitle
        }
        description={
          confirm?.kind === 'delete'
            ? t.compose.deleteConfirm.replace('{name}', confirm.names.join(', '))
            : confirm?.kind === 'down'
              ? t.compose.downConfirm.replace('{name}', confirm.names.join(', '))
              : confirm?.kind === 'restart'
                ? t.compose.restartConfirm.replace('{name}', confirm.names.join(', '))
                : confirm?.kind === 'recreate'
                  ? t.compose.recreateConfirm.replace('{name}', confirm.names.join(', '))
                  : confirm?.kind === 'up'
                    ? t.compose.upConfirm.replace('{name}', confirm.names.join(', '))
                    : undefined
        }
        consequences={confirm?.consequences}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger={confirm?.kind === 'delete' || confirm?.kind === 'down'}
        busy={anyBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void executeConfirm()}
      >
        {confirm?.kind === 'delete' ? (
          <label className="flex cursor-pointer items-start gap-2 text-sm text-dockora-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 accent-dockora-pink"
              checked={Boolean(confirm.removeVolumes)}
              onChange={(e) =>
                setConfirm((c) => (c ? { ...c, removeVolumes: e.target.checked } : c))
              }
            />
            <span>{t.compose.deleteVolumesConfirm}</span>
          </label>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
