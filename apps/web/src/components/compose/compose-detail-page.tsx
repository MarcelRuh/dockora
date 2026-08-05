'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ComposeProjectDetails } from '@dockora/shared';
import {
  backupComposeProject,
  composeAction,
  deleteComposeProject,
  fetchComposeEnv,
  fetchComposeLogs,
  fetchComposeProject,
  saveComposeEnv,
  saveComposeYaml,
  validateComposeConfig,
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin, canOperate } from '@/lib/roles';
import { composeStatusTone } from '@/lib/status';
import { Button, Select, Textarea } from '@/components/ui/form-controls';
import {
  ErrorBanner,
  LoadingState,
  LogViewer,
  PageHeader,
  Section,
  StatusBadge,
  SuccessBanner,
} from '@/components/ui/page-parts';

export function ComposeDetailPage({ id }: { id: string }) {
  const { t } = useLocale();
  const { authEnabled, user } = useAuth();
  const canOps = canOperate(user?.role, authEnabled);
  const isAdmin = canAdmin(user?.role, authEnabled);
  const router = useRouter();
  const [project, setProject] = useState<ComposeProjectDetails | null>(null);
  const [yaml, setYaml] = useState('');
  const [envContent, setEnvContent] = useState('');
  const [envFile, setEnvFile] = useState('.env');
  const [envExists, setEnvExists] = useState(false);
  const [logs, setLogs] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadEnv = useCallback(
    async (fileName: string) => {
      const env = await fetchComposeEnv(id, fileName);
      setEnvFile(env.fileName);
      setEnvContent(env.content);
      setEnvExists(env.exists);
    },
    [id],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchComposeProject(id);
      setProject(data);
      setYaml(data.yaml);
      const preferred =
        data.envFiles.includes('.env') || data.envFiles.length === 0
          ? '.env'
          : (data.envFiles[0] ?? '.env');
      await loadEnv(preferred);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.compose.notFound);
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [id, loadEnv, t.compose.notFound]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await saveComposeYaml(id, yaml);
      setProject(updated);
      setYaml(updated.yaml);
      setSuccess(t.compose.saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEnv = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await saveComposeEnv(id, envContent, envFile);
      setProject(updated);
      setEnvExists(true);
      setSuccess(t.compose.envSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    setBusy(true);
    setError(null);
    setValidation(null);
    setSuccess(null);
    try {
      const result = await validateComposeConfig(id);
      setValidation(result || t.compose.validateOk);
      setSuccess(t.compose.validateOk);
    } catch (err) {
      const message = err instanceof Error ? err.message : t.common.failed;
      setError(message);
      setValidation(`${t.compose.validateFailed}\n\n${message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLogs = async () => {
    setBusy(true);
    try {
      setLogs(await fetchComposeLogs(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleBackup = async () => {
    setBusy(true);
    setSuccess(null);
    try {
      const backup = await backupComposeProject(id);
      setSuccess(`${t.compose.backup}: ${backup.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: 'up' | 'down' | 'restart' | 'pull' | 'build') => {
    setBusy(true);
    try {
      await composeAction(id, action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!project) return;
    const confirmed = window.confirm(t.compose.deleteConfirm.replace('{name}', project.name));
    if (!confirmed) return;
    const removeVolumes = window.confirm(t.compose.deleteVolumesConfirm);

    setBusy(true);
    setError(null);
    try {
      await deleteComposeProject(id, { removeFiles: true, removeVolumes });
      router.push('/compose');
    } catch (err) {
      setError(err instanceof Error ? err.message : t.compose.deleteError);
      setBusy(false);
    }
  };

  if (loading && !project) return <LoadingState message={t.common.loading} />;

  if (!project) {
    return (
      <div className="space-y-4">
        <Link href="/compose" className="text-sm text-dockora-accent hover:underline">
          ← {t.common.back}
        </Link>
        <ErrorBanner message={error ?? t.compose.notFound} />
      </div>
    );
  }

  const envChoices = Array.from(new Set(['.env', ...project.envFiles]));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Link href="/compose" className="text-sm text-dockora-accent hover:underline">
        ← {t.common.back}
      </Link>

      <PageHeader
        title={project.name}
        subtitle={project.path}
        actions={
          <>
            <StatusBadge status={composeStatusTone(project.status)} label={project.status} />
            {canOps ? (
              <Button variant="primary" disabled={busy} onClick={() => void runAction('up')}>
                {t.compose.up}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button disabled={busy} onClick={() => void runAction('down')}>
                {t.compose.down}
              </Button>
            ) : null}
            {canOps ? (
              <Button disabled={busy} onClick={() => void runAction('restart')}>
                {t.compose.restart}
              </Button>
            ) : null}
            {canOps ? (
              <Button disabled={busy} onClick={() => void handleBackup()}>
                {t.compose.backup}
              </Button>
            ) : null}
            {isAdmin ? (
              <Button variant="danger" disabled={busy} onClick={() => void handleDelete()}>
                {t.common.delete}
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <Section title={t.compose.yaml}>
        <Textarea
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          rows={18}
          spellCheck={false}
          disabled={!canOps}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {canOps ? (
            <Button variant="primary" disabled={busy} onClick={() => void handleSave()}>
              {t.compose.saveYaml}
            </Button>
          ) : null}
          <Button disabled={busy} onClick={() => void handleValidate()}>
            {t.compose.validate}
          </Button>
        </div>
        {validation ? (
          <pre className="mt-3 max-h-48 overflow-auto rounded border border-dockora-border bg-dockora-bg p-3 font-mono text-xs whitespace-pre-wrap">
            {validation}
          </pre>
        ) : null}
      </Section>

      <Section title={t.compose.envFile}>
        <p className="mb-2 text-sm text-dockora-muted">{t.compose.envHint}</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select
            value={envFile}
            onChange={(e) => {
              const next = e.target.value;
              setEnvFile(next);
              void loadEnv(next).catch((err) =>
                setError(err instanceof Error ? err.message : t.common.failed),
              );
            }}
            className="w-auto font-mono text-sm"
          >
            {envChoices.map((f) => (
              <option key={f} value={f}>
                {f}
                {project.envFiles.includes(f) ? '' : ` (${t.compose.envNew})`}
              </option>
            ))}
          </Select>
          <span className="font-mono text-xs text-dockora-muted">
            {envExists ? t.compose.envExists : t.compose.envMissing}
          </span>
        </div>
        <Textarea
          value={envContent}
          onChange={(e) => setEnvContent(e.target.value)}
          rows={10}
          spellCheck={false}
          disabled={!canOps}
          className="font-mono text-sm"
          placeholder="PUID=1000&#10;PGID=1000&#10;TZ=Europe/Berlin"
        />
        {canOps ? (
          <div className="mt-3">
            <Button variant="primary" disabled={busy} onClick={() => void handleSaveEnv()}>
              {t.compose.saveEnv}
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title={t.compose.services}>
        <p className="font-mono text-sm">{project.services.join(', ') || '—'}</p>
      </Section>

      <Section title={t.compose.logs}>
        <Button disabled={busy} onClick={() => void handleLogs()}>
          {t.containers.logs.fetch}
        </Button>
        <LogViewer content={logs} />
      </Section>
    </div>
  );
}
