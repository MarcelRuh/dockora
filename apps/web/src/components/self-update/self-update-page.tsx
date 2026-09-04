'use client';

import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin } from '@/lib/roles';
import { PageHeader } from '@/components/ui/page-parts';
import { SelfUpdateSection } from '@/components/settings/self-update-section';

export function SelfUpdatePage() {
  const { t } = useLocale();
  const { authEnabled, user } = useAuth();
  const isAdmin = canAdmin(user?.role, authEnabled);

  return (
    <div className="space-y-8">
      <PageHeader title={t.nav.selfUpdate} subtitle={t.settings.selfUpdate.hint} />
      {isAdmin ? (
        <SelfUpdateSection />
      ) : (
        <p className="text-sm text-dockora-muted">{t.common.noPermission}</p>
      )}
    </div>
  );
}
