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
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin, canOperate } from '@/lib/roles';
import { composeStatusTone } from '@/lib/status';
import { resolveContainerIconUrl } from '@/lib/container-icon';
import { Button, Input, Select, Textarea } from '@/components/ui/form-controls';
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

const DEFAULT_YAML = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    restart: unless-stopped
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
    void load();
  }, [load]);

  const run = async (id: string, action: 'up' | 'down' | 'restart' | 'pull' | 'build') => {
    setBusy(id);
    try {
      await composeAction(id, action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (id: string, projectName: string) => {
    const confirmed = window.confirm(t.compose.deleteConfirm.replace('{name}', projectName));
    if (!confirmed) return;

    const removeVolumes = window.confirm(t.compose.deleteVolumesConfirm);

    setBusy(id);
    setError(null);
    try {
      await deleteComposeProject(id, { removeFiles: true, removeVolumes });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.compose.deleteError);
    } finally {
      setBusy(null);
    }
  };

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(trimmed)) {
      setError(t.compose.invalidName);
      return;
    }
    if (!yaml.trim() || !/^\s*services:\s*$/m.test(yaml)) {
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
      await load();
      router.push(`/compose/${encodeURIComponent(project.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.compose.createError);
      await load();
    } finally {
      if (tick) clearInterval(tick);
      setCreating(false);
      setCreateProgress(null);
    }
  };

  const rows = items.map((p) => [
    <Link
      key={`n-${p.id}`}
      href={`/compose/${encodeURIComponent(p.id)}`}
      className="inline-flex items-center gap-2 font-medium text-dockora-accent hover:underline"
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
    <span key={`c-${p.id}`}>
      {p.runningCount}/{p.containerCount}
    </span>,
    <div key={`a-${p.id}`} className="flex flex-wrap gap-1">
      {canOps ? (
        <>
          <Button variant="primary" disabled={busy === p.id} onClick={() => void run(p.id, 'up')}>
            {t.compose.up}
          </Button>
          {isAdmin ? (
            <Button disabled={busy === p.id} onClick={() => void run(p.id, 'down')}>
              {t.compose.down}
            </Button>
          ) : null}
          <Button disabled={busy === p.id} onClick={() => void run(p.id, 'restart')}>
            {t.compose.restart}
          </Button>
          <Button disabled={busy === p.id} onClick={() => void run(p.id, 'pull')}>
            {t.compose.pull}
          </Button>
          <Button disabled={busy === p.id} onClick={() => void run(p.id, 'build')}>
            {t.compose.build}
          </Button>
        </>
      ) : null}
      {isAdmin ? (
        <Button
          variant="danger"
          disabled={busy === p.id}
          onClick={() => void onDelete(p.id, p.name)}
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
            <Button onClick={() => void load()}>{t.common.refresh}</Button>
          </div>
        }
      />

      {showCreate && canOps ? (
        <section className="space-y-4 border-l-2 border-dockora-accent/50 bg-dockora-surface/40 p-4">
          <h2 className="text-lg font-medium">{t.compose.createTitle}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-dockora-muted">{t.common.name}</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-app"
                autoComplete="off"
                disabled={creating}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-dockora-muted">{t.compose.basePath}</span>
              <Select
                value={basePath}
                onChange={(e) => setBasePath(e.target.value)}
                disabled={creating}
              >
                {bases.map((b) => (
                  <option key={b.path} value={b.path} disabled={!b.writable}>
                    {b.path}
                    {b.writable ? '' : ` (${t.compose.readOnlyPath})`}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-dockora-muted">{t.compose.filename}</span>
              <Select
                value={composeFileName}
                onChange={(e) => setComposeFileName(e.target.value)}
                disabled={creating}
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
                className="h-4 w-4"
                disabled={creating}
              />
              <span>{t.compose.startAfterCreate}</span>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-dockora-muted">{t.compose.yaml}</span>
            <Textarea
              rows={12}
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              disabled={creating}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-dockora-muted">{t.compose.envOptional}</span>
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
          {createProgress ? (
            <div className="space-y-2 rounded-md border border-dockora-border bg-dockora-surface2/60 p-3">
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
          <Button
            variant="primary"
            disabled={creating || !name.trim() || !yaml.trim()}
            onClick={() => void onCreate()}
          >
            {creating ? t.common.loading : t.compose.createSubmit}
          </Button>
        </section>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}
      {!loading ? (
        <DataTable
          headers={[
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
    </div>
  );
}
