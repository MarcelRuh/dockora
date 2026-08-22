'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ComposeProjectSummary } from '@dockora/shared';
import {
  composeAction,
  createComposeProject,
  deleteComposeProject,
  fetchComposeBases,
  fetchComposeProjects,
  fetchContainers,
  previewComposeChanges,
} from '@/lib/api';
import { formatComposePreviewLines } from '@/lib/compose-preview';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin, canOperate } from '@/lib/roles';
import { composeStatusTone } from '@/lib/status';
import { resolveContainerIconUrl } from '@/lib/container-icon';
import { Button, FilterBar, Input, Select, Textarea, Label } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProgressBar } from '@/components/ui/progress-bar';
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

const DEFAULT_YAML = `services:
  web:
    image: nginx:alpine
    ports:
      - "18080:80"
    restart: unless-stopped
    labels:
      - icon=https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/nginx.png
`;

type CreateStep = 'validate' | 'write' | 'start' | 'done';

export function ComposeListPage() {
  const { t } = useLocale();
  const { authEnabled, user } = useAuth();
  const canOps = canOperate(user?.role, authEnabled);
  const isAdmin = canAdmin(user?.role, authEnabled);
  const router = useRouter();
  const [items, setItems] = useState<ComposeProjectSummary[]>([]);
  const [bases, setBases] = useState<Array<{ path: string; writable: boolean }>>([]);
  const [projectIcons, setProjectIcons] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState<{
    percent: number;
    step: CreateStep;
  } | null>(null);

  const [name, setName] = useState('');
  const [basePath, setBasePath] = useState('');
  const [composeFileName, setComposeFileName] = useState('compose.yaml');
  const [yaml, setYaml] = useState(DEFAULT_YAML);
  const [envContent, setEnvContent] = useState('');
  const [startAfterCreate, setStartAfterCreate] = useState(true);

  const createStepLabel = (step: CreateStep) => {
    switch (step) {
      case 'validate':
        return t.compose.createProgressValidate;
      case 'write':
        return t.compose.createProgressWrite;
      case 'start':
        return t.compose.createProgressStart;
      case 'done':
        return t.compose.createProgressDone;
    }
  };

  const load = useCallback(async (opts?: { clearError?: boolean }) => {
    setLoading(true);
    if (opts?.clearError) setError(null);
    try {
      const [projects, baseList, containers] = await Promise.all([
        fetchComposeProjects(),
        fetchComposeBases(),
        fetchContainers().catch(() => []),
      ]);
      setItems(projects);
      setBases(baseList);
      const icons: Record<string, string[]> = {};
      for (const c of containers) {
        const project = c.composeProject;
        const url = resolveContainerIconUrl(c.labels);
        if (!project || !url) continue;
        const list = icons[project] ?? (icons[project] = []);
        if (!list.includes(url)) list.push(url);
      }
      setProjectIcons(icons);
      const preferred =
        baseList.find((b) => b.writable && b.path === '/home')?.path ??
        baseList.find((b) => b.writable)?.path ??
        baseList[0]?.path ??
        '/home';
      setBasePath((prev) => prev || preferred);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.compose.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.compose.loadError]);

  useEffect(() => {
    void load({ clearError: true });
  }, [load]);

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

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = items.length > 0 && items.every((p) => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((p) => p.id)));
  };

  const selectedIds = Array.from(selected);
  const anyBusy = Boolean(busy) || bulkBusy || confirmBusy;

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(trimmed)) {
      setError(t.compose.invalidName);
      return;
    }
    if (!yaml.trim() || !/^\s*services:\s*(?:#.*)?$/m.test(yaml)) {
      setError(t.compose.invalidYaml);
      return;
    }
    setCreating(true);
    setError(null);
    setCreateProgress({ percent: 8, step: 'validate' });
    let tick: ReturnType<typeof setInterval> | null = null;
    try {
      setCreateProgress({ percent: 22, step: 'write' });
      const project = await createComposeProject({
        name: trimmed,
        basePath,
        composeFileName,
        yaml,
        envContent: envContent.trim() || undefined,
        start: false,
      });

      if (startAfterCreate) {
        let percent = 55;
        setCreateProgress({ percent, step: 'start' });
        tick = setInterval(() => {
          percent = Math.min(percent + 2, 92);
          setCreateProgress({ percent, step: 'start' });
        }, 700);
        try {
          await composeAction(project.id, 'up');
        } catch (err) {
          if (tick) clearInterval(tick);
          tick = null;
          const msg = err instanceof Error ? err.message : t.common.failed;
          setCreateProgress(null);
          await load();
          // Stay on create form with YAML intact so the user can fix ports/volumes
          setError(
            `${t.compose.createStartFailed}: ${msg} (${t.compose.targetPath}: ${basePath}/${trimmed})`,
          );
          return;
        } finally {
          if (tick) clearInterval(tick);
          tick = null;
        }
      }

      setCreateProgress({ percent: 100, step: 'done' });
      await new Promise((r) => setTimeout(r, 280));
      setShowCreate(false);
      setName('');
      setYaml(DEFAULT_YAML);
      setEnvContent('');
      await load({ clearError: true });
      router.push(`/compose/${encodeURIComponent(project.id)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.compose.createError;
      await load();
      setError(msg);
      // Created on disk but later step failed – keep form open with error (no silent navigate)
    } finally {
      if (tick) clearInterval(tick);
      setCreating(false);
      setCreateProgress(null);
    }
  };

  const rows = items.map((p) => [
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
              <Button
                variant="primary"
                disabled={creating}
                onClick={() => setShowCreate((v) => !v)}
              >
                {showCreate ? t.common.cancel : t.compose.create}
              </Button>
            ) : null}
            <Button onClick={() => void load({ clearError: true })}>{t.common.refresh}</Button>
          </div>
        }
      />

      {showCreate && canOps ? (
        <section className="dockora-panel space-y-4 border-l-[3px] border-l-dockora-pink p-4">
          <h2 className="dockora-title-gradient text-lg">{t.compose.createTitle}</h2>
          <div className="sticky top-16 z-30 -mx-1 space-y-3 bg-dockora-surface/95 px-1 py-2 backdrop-blur-md md:top-4">
            {error ? <ErrorBanner message={error} /> : null}
            {createProgress ? (
              <div className="space-y-2 rounded-md border border-dockora-border bg-dockora-surface2/80 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-dockora-muted">{createStepLabel(createProgress.step)}</span>
                  <span className="tabular-nums text-dockora-muted">
                    {Math.round(createProgress.percent)}%
                  </span>
                </div>
                <ProgressBar
                  value={createProgress.percent}
                  tone={createProgress.step === 'done' ? 'success' : 'accent'}
                  autoTone={false}
                />
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <Label>{t.common.name}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-app"
                autoComplete="off"
                disabled={creating}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <Label>{t.compose.basePath}</Label>
              <Select
                value={basePath}
                onChange={(e) => setBasePath(e.target.value)}
                disabled={creating}
                className="w-full"
              >
                {bases.map((b) => (
                  <option key={b.path} value={b.path} disabled={!b.writable}>
                    {b.path}
                    {b.writable ? '' : ` (${t.compose.readOnlyPath})`}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5 text-sm">
              <Label>{t.compose.filename}</Label>
              <Select
                value={composeFileName}
                onChange={(e) => setComposeFileName(e.target.value)}
                disabled={creating}
                className="w-full"
              >
                <option value="compose.yaml">compose.yaml</option>
                <option value="compose.yml">compose.yml</option>
                <option value="docker-compose.yml">docker-compose.yml</option>
                <option value="docker-compose.yaml">docker-compose.yaml</option>
              </Select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={startAfterCreate}
                onChange={(e) => setStartAfterCreate(e.target.checked)}
                className="h-4 w-4 accent-dockora-pink"
                disabled={creating}
              />
              <span>{t.compose.startAfterCreate}</span>
            </label>
          </div>
          <label className="block space-y-1.5 text-sm">
            <Label>{t.compose.yaml}</Label>
            <Textarea
              rows={12}
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              disabled={creating}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <Label>{t.compose.envOptional}</Label>
            <Textarea
              rows={4}
              value={envContent}
              onChange={(e) => setEnvContent(e.target.value)}
              placeholder="KEY=value"
              disabled={creating}
            />
          </label>
          <p className="font-mono text-xs text-dockora-muted">
            {t.compose.targetPath}: {basePath}/{name || '…'}/{composeFileName}
          </p>
          <Button
            variant="primary"
            disabled={creating || !name.trim() || !yaml.trim()}
            onClick={() => void onCreate()}
          >
            {creating ? t.common.loading : t.compose.createSubmit}
          </Button>
        </section>
      ) : null}

      {error && !showCreate ? <ErrorBanner message={error} /> : null}
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
