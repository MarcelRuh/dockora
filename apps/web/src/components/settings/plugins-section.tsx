'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  disablePlugin,
  enablePlugin,
  fetchPlugins,
  type PluginInfo,
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { Button } from '@/components/ui/form-controls';
import { ErrorBanner, Section, SuccessBanner } from '@/components/ui/page-parts';

export function PluginsSection() {
  const { t } = useLocale();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [pluginDir, setPluginDir] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchPlugins();
      setPlugins(data.plugins);
      setPluginDir(data.pluginDir);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    }
  }, [t.common.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (plugin: PluginInfo) => {
    setBusy(plugin.dirName);
    setError(null);
    setSuccess(null);
    try {
      const data = plugin.enabled
        ? await disablePlugin(plugin.dirName)
        : await enablePlugin(plugin.dirName);
      setPlugins(data.plugins);
      setSuccess(
        plugin.enabled
          ? t.settings.plugins.disabled.replace('{name}', plugin.name)
          : t.settings.plugins.enabled.replace('{name}', plugin.name),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title={t.settings.plugins.title}>
      <p className="mb-3 text-sm text-dockora-muted">{t.settings.plugins.hint}</p>
      {pluginDir ? (
        <p className="mb-3 font-mono text-xs text-dockora-muted">
          {t.settings.plugins.dir}: {pluginDir}
        </p>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {plugins.length === 0 ? (
        <p className="text-sm text-dockora-muted">{t.settings.plugins.empty}</p>
      ) : (
        <ul className="space-y-2">
          {plugins.map((plugin) => (
            <li
              key={plugin.dirName}
              className="dockora-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {plugin.name}{' '}
                  <span className="font-mono text-xs text-dockora-muted">
                    {plugin.version ? `v${plugin.version}` : ''}
                  </span>
                </p>
                <p className="text-xs text-dockora-muted">
                  {plugin.enabled ? t.settings.plugins.stateOn : t.settings.plugins.stateOff}
                  {plugin.loaded ? ` · ${t.settings.plugins.loaded}` : ''}
                </p>
              </div>
              <Button
                variant={plugin.enabled ? 'danger' : 'primary'}
                disabled={busy === plugin.dirName}
                onClick={() => void toggle(plugin)}
              >
                {busy === plugin.dirName
                  ? t.common.loading
                  : plugin.enabled
                    ? t.settings.plugins.disable
                    : t.settings.plugins.enable}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <Button disabled={Boolean(busy)} onClick={() => void load()}>
          {t.common.refresh}
        </Button>
      </div>
    </Section>
  );
}
