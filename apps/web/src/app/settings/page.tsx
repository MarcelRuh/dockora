import { AppShell } from '@/components/app-shell';
import { SettingsPageView } from '@/components/settings/settings-page';

export default function SettingsRoute() {
  return (
    <AppShell>
      <SettingsPageView />
    </AppShell>
  );
}
