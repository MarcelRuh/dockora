import { AppShell } from '@/components/app-shell';
import { ContainersPage } from '@/components/containers/containers-page';

export default function ContainersRoute() {
  return (
    <AppShell>
      <ContainersPage />
    </AppShell>
  );
}
