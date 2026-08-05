import { AppShell } from '@/components/app-shell';
import { LogsPageView } from '@/components/logs/logs-page';

export default function LogsRoute() {
  return (
    <AppShell>
      <LogsPageView />
    </AppShell>
  );
}
