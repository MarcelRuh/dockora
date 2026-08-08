'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, NotificationEvent } from '@dockora/shared';
import { fetchSettings, testDiscordNotification, updateSettings } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { Button, Input, Label, Select } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  AccentPanel,
  ErrorBanner,
  LoadingState,
  PageHeader,
  Section,
  SuccessBanner,
  TabBar,
} from '@/components/ui/page-parts';
import { SchedulerSection } from '@/components/settings/scheduler-section';
import { UsersSection } from '@/components/settings/users-section';
import { AuditSection } from '@/components/settings/audit-section';
import { SelfUpdateSection } from '@/components/settings/self-update-section';
import { PluginsSection } from '@/components/settings/plugins-section';
import { TotpSection } from '@/components/settings/totp-section';

const NOTIFICATION_EVENTS: NotificationEvent[] = [
  'container.started',
  'container.stopped',
  'container.crashed',
  'container.restarted',
  'update.available',
  'update.installed',
  'error',
  'backup.completed',
  'restore.completed',
  'system',
];

type SettingsTab =
  | 'general'
  | 'docker'
  | 'updates'
  | 'notifications'
  | 'backup'
  | 'monitoring'
  | 'scheduler'
  | 'security'
  | 'plugins'
  | 'audit';

const FORM_TABS: SettingsTab[] = [
  'general',
  'docker',
  'updates',
  'notifications',
  'backup',
  'monitoring',
  'security',
];

export function SettingsPageView() {
  const { t } = useLocale();
  const { authEnabled, user } = useAuth();
  const isAdmin = canAdmin(user?.role, authEnabled);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tab, setTab] = useState<SettingsTab>('general');
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSettings();
      setSettings(data);
      setBaseline(JSON.stringify(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.settings.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.settings.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs = useMemo(() => {
    const all: { id: SettingsTab; label: string }[] = [
      { id: 'general', label: t.settings.sections.general },
      { id: 'docker', label: t.settings.sections.docker },
      { id: 'updates', label: t.settings.sections.updates },
      { id: 'notifications', label: t.settings.sections.notifications },
      { id: 'backup', label: t.settings.sections.backup },
      { id: 'monitoring', label: t.settings.sections.monitoring },
      { id: 'scheduler', label: t.settings.sections.scheduler },
    ];
    if (isAdmin) {
      all.push({ id: 'security', label: t.settings.sections.security });
      all.push({ id: 'plugins', label: t.settings.sections.plugins });
      all.push({ id: 'audit', label: t.settings.sections.audit });
    }
    return all;
  }, [t, isAdmin]);

  useEffect(() => {
    if (!tabs.some((item) => item.id === tab)) {
      setTab('general');
    }
  }, [tabs, tab]);

  const dirty = Boolean(settings && baseline && JSON.stringify(settings) !== baseline);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const requestTabChange = (next: SettingsTab) => {
    if (next === tab) return;
    if (dirty && FORM_TABS.includes(tab)) {
      setPendingTab(next);
      return;
    }
    setTab(next);
  };

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const previousAuthEnabled = settings.authEnabled;
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
      setBaseline(JSON.stringify(updated));
      setSuccess(t.settings.saved);
      if (updated.authEnabled !== previousAuthEnabled) {
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscordTest = async () => {
    setSaving(true);
    setError(null);
    try {
      await testDiscordNotification();
      setSuccess(t.settings.testDiscordOk);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) return <LoadingState message={t.common.loading} />;
  if (!settings) return <ErrorBanner message={error ?? t.settings.loadError} />;

  const showSave = isAdmin && FORM_TABS.includes(tab);
  const desc = t.settings.descriptions;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t.settings.title}
        subtitle={t.settings.subtitle}
        actions={
          showSave ? (
            <div className="flex flex-wrap items-center gap-2">
              {dirty ? (
                <span className="font-mono text-[11px] uppercase tracking-wider text-dockora-accent">
                  {t.settings.unsaved}
                </span>
              ) : null}
              <Button
                variant="primary"
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
              >
                {t.settings.save}
              </Button>
            </div>
          ) : null
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <div className="md:hidden">
        <TabBar tabs={tabs} active={tab} onChange={(id) => requestTabChange(id as SettingsTab)} />
      </div>

      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <nav className="sticky top-4 space-y-1 rounded-md border border-dockora-border bg-dockora-surface/60 p-2">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => requestTabChange(item.id)}
                className={cn(
                  'block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                  tab === item.id
                    ? 'bg-gradient-to-br from-dockora-pink to-dockora-purple text-white shadow-neon'
                    : 'text-dockora-muted hover:bg-dockora-surface2 hover:text-dockora-text',
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {tab === 'general' ? (
            <SettingsPanel title={t.settings.sections.general} description={desc.general}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.settings.fields.locale}>
                  <Select
                    value={settings.locale}
                    onChange={(e) => patch('locale', e.target.value as AppSettings['locale'])}
                    disabled={!isAdmin}
                    className="w-full"
                  >
                    <option value="de">Deutsch</option>
                    <option value="en">English</option>
                  </Select>
                </Field>
                <Field label={t.settings.fields.theme}>
                  <Select
                    value={settings.theme}
                    onChange={(e) => patch('theme', e.target.value as AppSettings['theme'])}
                    disabled={!isAdmin}
                    className="w-full"
                  >
                    <option value="dark">dark</option>
                    <option value="light">light</option>
                    <option value="system">system</option>
                  </Select>
                </Field>
                <Field label={t.settings.fields.timezone} hint={t.settings.hints.timezone}>
                  <Input
                    value={settings.timezone}
                    onChange={(e) => patch('timezone', e.target.value)}
                    disabled={!isAdmin}
                    placeholder="Europe/Berlin"
                  />
                </Field>
              </div>
            </SettingsPanel>
          ) : null}

          {tab === 'docker' ? (
            <SettingsPanel title={t.settings.sections.docker} description={desc.docker}>
              <div className="grid gap-4">
                <Field label={t.settings.fields.dockerSocket} hint={t.settings.hints.dockerSocket}>
                  <Input
                    value={settings.dockerSocket}
                    onChange={(e) => patch('dockerSocket', e.target.value)}
                    disabled={!isAdmin}
                    className="font-mono text-sm"
                  />
                </Field>
                <Field
                  label={t.settings.fields.composeSearchPaths}
                  hint={t.settings.hints.composeSearchPaths}
                >
                  <Input
                    value={settings.composeSearchPaths.join(', ')}
                    onChange={(e) =>
                      patch(
                        'composeSearchPaths',
                        e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                    disabled={!isAdmin}
                    className="font-mono text-sm"
                  />
                </Field>
              </div>
            </SettingsPanel>
          ) : null}

          {tab === 'updates' ? (
            <div className="space-y-6">
              <SettingsPanel title={t.settings.sections.updates} description={desc.updates}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.settings.fields.updateCheckIntervalMinutes}>
                    <Input
                      type="number"
                      min={5}
                      value={settings.updateCheckIntervalMinutes}
                      onChange={(e) => patch('updateCheckIntervalMinutes', Number(e.target.value))}
                      disabled={!isAdmin}
                    />
                  </Field>
                  <Field label={t.settings.fields.autoUpdateImages} hint={t.settings.hints.autoUpdate}>
                    <ToggleRow
                      checked={settings.autoUpdateImages}
                      disabled={!isAdmin}
                      onChange={(v) => patch('autoUpdateImages', v)}
                      yes={t.common.yes}
                      no={t.common.no}
                    />
                  </Field>
                  <Field label={t.settings.fields.ghcrToken} hint={t.settings.hints.ghcrToken}>
                    <Input
                      type="password"
                      autoComplete="off"
                      value={settings.ghcrToken}
                      onChange={(e) => patch('ghcrToken', e.target.value)}
                      disabled={!isAdmin}
                      placeholder={t.settings.fields.tokenPlaceholder}
                    />
                  </Field>
                  <Field label={t.settings.fields.lscrToken} hint={t.settings.hints.lscrToken}>
                    <Input
                      type="password"
                      autoComplete="off"
                      value={settings.lscrToken}
                      onChange={(e) => patch('lscrToken', e.target.value)}
                      disabled={!isAdmin}
                      placeholder={t.settings.fields.tokenPlaceholder}
                    />
                  </Field>
                </div>
              </SettingsPanel>
              {isAdmin ? <SelfUpdateSection /> : null}
            </div>
          ) : null}

          {tab === 'notifications' ? (
            <SettingsPanel
              title={t.settings.sections.notifications}
              description={desc.notifications}
              actions={
                <Button disabled={saving} onClick={() => void handleDiscordTest()}>
                  {t.settings.testDiscord}
                </Button>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t.settings.fields.discordWebhookUrl}
                  hint={t.settings.fields.discordWebhookPlaceholder}
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={t.settings.fields.discordWebhookPlaceholder}
                    value={settings.discordWebhookUrl}
                    onChange={(e) => patch('discordWebhookUrl', e.target.value)}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={t.settings.fields.discordEnabled}>
                  <ToggleRow
                    checked={settings.discordEnabled}
                    disabled={!isAdmin}
                    onChange={(v) => patch('discordEnabled', v)}
                    yes={t.common.yes}
                    no={t.common.no}
                  />
                </Field>
              </div>
              <Field label={t.settings.fields.discordEvents}>
                <AccentPanel className="mt-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {NOTIFICATION_EVENTS.map((ev) => (
                      <label key={ev} className="flex items-center gap-2 text-sm font-mono">
                        <input
                          type="checkbox"
                          checked={settings.discordEvents.includes(ev)}
                          disabled={!isAdmin}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...settings.discordEvents, ev]
                              : settings.discordEvents.filter((x) => x !== ev);
                            patch('discordEvents', next);
                          }}
                        />
                        {ev}
                      </label>
                    ))}
                  </div>
                </AccentPanel>
              </Field>
            </SettingsPanel>
          ) : null}

          {tab === 'backup' ? (
            <SettingsPanel title={t.settings.sections.backup} description={desc.backup}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t.settings.fields.backupRetentionDays}>
                  <Input
                    type="number"
                    min={1}
                    value={settings.backupRetentionDays}
                    onChange={(e) => patch('backupRetentionDays', Number(e.target.value))}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={t.settings.fields.backupFormat}>
                  <Select
                    value={settings.backupFormat}
                    onChange={(e) =>
                      patch('backupFormat', e.target.value as AppSettings['backupFormat'])
                    }
                    disabled={!isAdmin}
                    className="w-full"
                  >
                    <option value="zip">zip</option>
                    <option value="tar">tar</option>
                    <option value="tar.gz">tar.gz</option>
                  </Select>
                </Field>
                <Field label={t.settings.fields.backupSchedule}>
                  <Select
                    value={settings.backupSchedule}
                    onChange={(e) =>
                      patch('backupSchedule', e.target.value as AppSettings['backupSchedule'])
                    }
                    disabled={!isAdmin}
                    className="w-full"
                  >
                    <option value="off">off</option>
                    <option value="daily">daily</option>
                    <option value="weekly">weekly</option>
                    <option value="monthly">monthly</option>
                    <option value="custom">custom</option>
                  </Select>
                </Field>
              </div>
            </SettingsPanel>
          ) : null}

          {tab === 'monitoring' ? (
            <SettingsPanel title={t.settings.sections.monitoring} description={desc.monitoring}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t.settings.fields.monitoringCpuThreshold}>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.monitoringCpuThreshold}
                    onChange={(e) => patch('monitoringCpuThreshold', Number(e.target.value))}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={t.settings.fields.monitoringRamThreshold}>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.monitoringRamThreshold}
                    onChange={(e) => patch('monitoringRamThreshold', Number(e.target.value))}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={t.settings.fields.monitoringDiskThreshold}>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.monitoringDiskThreshold}
                    onChange={(e) => patch('monitoringDiskThreshold', Number(e.target.value))}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field
                  label={t.settings.fields.monitoringTempThreshold}
                  hint={t.settings.hints.monitoringTempThreshold}
                >
                  <Input
                    type="number"
                    min={50}
                    max={120}
                    value={settings.monitoringTempThreshold}
                    onChange={(e) => patch('monitoringTempThreshold', Number(e.target.value))}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field
                  label={t.settings.fields.monitoringBuildCacheGbThreshold}
                  hint={t.settings.hints.monitoringBuildCacheGbThreshold}
                >
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={settings.monitoringBuildCacheGbThreshold}
                    onChange={(e) =>
                      patch('monitoringBuildCacheGbThreshold', Number(e.target.value))
                    }
                    disabled={!isAdmin}
                  />
                </Field>
              </div>
            </SettingsPanel>
          ) : null}

          {tab === 'scheduler' ? <SchedulerSection canEdit={isAdmin} /> : null}

          {tab === 'security' && isAdmin ? (
            <div className="space-y-6">
              <SettingsPanel title={t.settings.sections.security} description={desc.security}>
                <Field label={t.settings.fields.authEnabled} hint={t.settings.hints.authEnabled}>
                  <ToggleRow
                    checked={settings.authEnabled}
                    disabled={!isAdmin}
                    onChange={(v) => patch('authEnabled', v)}
                    yes={t.common.yes}
                    no={t.common.no}
                  />
                </Field>
              </SettingsPanel>
              {authEnabled || settings.authEnabled ? (
                <>
                  <UsersSection />
                  {authEnabled ? <TotpSection /> : null}
                </>
              ) : null}
            </div>
          ) : null}

          {tab === 'plugins' && isAdmin ? <PluginsSection /> : null}

          {tab === 'audit' && isAdmin ? <AuditSection /> : null}

          {showSave ? (
            <div className="flex justify-end border-t border-dockora-border pt-4">
              <Button
                variant="primary"
                disabled={saving || !dirty}
                onClick={() => void handleSave()}
              >
                {t.settings.save}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingTab)}
        title={t.settings.unsavedConfirm}
        description={t.settings.unsavedConfirm}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger
        onCancel={() => setPendingTab(null)}
        onConfirm={() => {
          if (pendingTab) setTab(pendingTab);
          setPendingTab(null);
        }}
      />
    </div>
  );
}

function SettingsPanel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
          {description ? (
            <p className="max-w-2xl text-sm text-dockora-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="dockora-panel space-y-4 px-4 py-4 sm:px-5">{children}</div>
    </Section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1">{label}</Label>
      {children}
      {hint ? <p className="mt-1.5 text-xs text-dockora-muted">{hint}</p> : null}
    </div>
  );
}

function ToggleRow({
  checked,
  disabled,
  onChange,
  yes,
  no,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  yes: string;
  no: string;
}) {
  return (
    <label className="flex h-10 items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {checked ? yes : no}
    </label>
  );
}
