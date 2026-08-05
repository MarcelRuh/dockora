import { AppShell } from '@/components/app-shell';
import { MonitoringPage } from '@/components/monitoring/monitoring-page';

export default function MonitoringRoute() {
  return (
    <AppShell>
      <MonitoringPage />
    </AppShell>
  );
}
