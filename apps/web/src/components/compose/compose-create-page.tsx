'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  composeAction,
  createComposeProject,
  fetchComposeBases,
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canOperate } from '@/lib/roles';
import { Button, Input, Select, Label } from '@/components/ui/form-controls';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ErrorBanner, PageHeader } from '@/components/ui/page-parts';
import { EnvEditor } from '@/components/compose/env-editor';
import { CodeEditor } from '@/components/compose/code-editor';
import { previewComposeInterpolation } from '@/lib/compose-interpolation';

export const DEFAULT_COMPOSE_YAML = `services:
  web:
    image: nginx:alpine
    ports:
      - "18080:80"
    restart: unless-stopped
    labels:
      - icon=https://cdn.jsdelivr.net/gh/selfhst/icons/png/nginx.png
`;

type CreateStep = 'validate' | 'write' | 'start' | 'done';

export function ComposeCreatePage() {
  const { t } = useLocale();
  const { authEnabled, user } = useAuth();
  const canOps = canOperate(user?.role, authEnabled);
  const router = useRouter();

  const [bases, setBases] = useState<Array<{ path: string; writable: boolean }>>([]);
  const [name, setName] = useState('');
  const [basePath, setBasePath] = useState('');
  const [composeFileName, setComposeFileName] = useState('compose.yaml');
  const [yaml, setYaml] = useState(DEFAULT_COMPOSE_YAML);
  const [envContent, setEnvContent] = useState('');
  const [startAfterCreate, setStartAfterCreate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createProgress, setCreateProgress] = useState<{
    percent: number;
    step: CreateStep;
  } | null>(null);

  const missingEnv = useMemo(
    () => previewComposeInterpolation(yaml, envContent).missing,
    [yaml, envContent],
  );

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

  const loadBases = useCallback(async () => {
    try {
      const baseList = await fetchComposeBases();
      setBases(baseList);
      const preferred =
        baseList.find((b) => b.writable && b.path === '/home')?.path ??
        baseList.find((b) => b.writable)?.path ??
        baseList[0]?.path ??
        '/home';
      setBasePath((prev) => prev || preferred);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.compose.loadError);
    }
  }, [t.compose.loadError]);

  useEffect(() => {
    void loadBases();
  }, [loadBases]);

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
      router.push(`/compose/${encodeURIComponent(project.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.compose.createError);
    } finally {
      if (tick) clearInterval(tick);
      setCreating(false);
      setCreateProgress(null);
    }
  };

  if (!canOps) {
    return (
      <div className="space-y-6">
        <PageHeader title={t.compose.createTitle} subtitle={t.compose.createSubtitle} />
        <ErrorBanner message={t.compose.createForbidden} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t.compose.createTitle}
        subtitle={t.compose.createSubtitle}
        actions={
          <Button onClick={() => router.push('/compose')} disabled={creating}>
            {t.common.back}
          </Button>
        }
      />

      <section className="dockora-panel space-y-4 border-l-[3px] border-l-dockora-pink p-4">
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

        <div className="space-y-1.5 text-sm">
          <Label>{t.compose.yaml}</Label>
          <CodeEditor
            language="yaml"
            value={yaml}
            onChange={setYaml}
            disabled={creating}
            minHeight={360}
            formatLabel={t.compose.format}
            formatFailed={t.compose.formatFailed}
            envText={envContent}
          />
          {missingEnv.length > 0 ? (
            <p className="text-xs text-dockora-warning">
              {t.compose.envMissingVars.replace('{keys}', missingEnv.join(', '))}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5 text-sm">
          <Label>{t.compose.envOptional}</Label>
          <p className="text-xs text-dockora-muted">{t.compose.envHint}</p>
          <EnvEditor
            value={envContent}
            onChange={setEnvContent}
            disabled={creating}
            defaultMode="raw"
            placeholder={'PUID=1000\nPGID=1000\nTZ=Europe/Berlin'}
            labels={{
              fields: t.compose.envModeFields,
              raw: t.compose.envModeRaw,
              key: t.compose.envKey,
              value: t.compose.envValue,
              show: t.compose.envShow,
              hide: t.compose.envHide,
              remove: t.compose.envRemove,
              empty: t.compose.envFieldsEmpty,
              format: t.compose.format,
              formatFailed: t.compose.formatFailed,
            }}
          />
        </div>

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
    </div>
  );
}
