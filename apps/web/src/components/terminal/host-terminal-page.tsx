'use client';

import dynamic from 'next/dynamic';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin } from '@/lib/roles';
import { getAuthToken } from '@/lib/auth';
import { ErrorBanner, PageHeader } from '@/components/ui/page-parts';

const WebTerminal = dynamic(
  () => import('@/components/terminal/web-terminal').then((m) => m.WebTerminal),
  { ssr: false },
);

export function HostTerminalPage() {
  const { t } = useLocale();
  const { authEnabled, user } = useAuth();
  const isAdmin = canAdmin(user?.role, authEnabled);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader title={t.hostTerminal.title} subtitle={t.hostTerminal.subtitle} />

      {!isAdmin ? (
        <ErrorBanner message={t.common.noPermission} />
      ) : (
        <>
          <p className="text-sm text-dockora-muted">{t.hostTerminal.hint}</p>
          <WebTerminal
            path="/system/host-terminal"
            token={getAuthToken()}
            errorLabel={t.hostTerminal.error}
            unauthorizedLabel={t.hostTerminal.unauthorized}
          />
        </>
      )}
    </div>
  );
}
