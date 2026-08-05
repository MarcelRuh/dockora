import { AppShell } from '@/components/app-shell';
import { ComposeListPage } from '@/components/compose/compose-list-page';

export default function ComposeRoute() {
  return (
    <AppShell>
      <ComposeListPage />
    </AppShell>
  );
}
