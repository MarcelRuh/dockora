'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin } from '@/lib/roles';
import { getSessionToken } from '@/lib/auth';
import { fetchHostTerminalStatus } from '@/lib/api';
import { ErrorBanner, PageHeader } from '@/components/ui/page-parts';

const WebTerminal = dynamic(
  () => import('@/components/terminal/web-terminal').then((m) => m.WebTerminal),
  { ssr: false },
);

export function HostTerminalPage() {
  const { t } = useLocale();
  const { authEnabled, user } = useAuth();
  const isAdmin = canAdmin(user?.role, authEnabled);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void fetchHostTerminalStatus()
      .then((status) => {
        if (!cancelled) setEnabled(status.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader title={t.hostTerminal.title} subtitle={t.hostTerminal.subtitle} />

      {!isAdmin ? (
        <ErrorBanner message={t.common.noPermission} />
      ) : (
        <>
          <p className="text-sm text-dockora-muted">{t.hostTerminal.hint}</p>
          {enabled === false ? (
            <ErrorBanner message={t.hostTerminal.disabled} />
          ) : enabled ? (
            <WebTerminal
              path="/system/host-terminal"
              token={getSessionToken()}
              errorLabel={t.hostTerminal.error}
              unauthorizedLabel={t.hostTerminal.unauthorized}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
