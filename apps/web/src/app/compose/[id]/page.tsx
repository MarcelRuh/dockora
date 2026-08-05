import { AppShell } from '@/components/app-shell';
import { ComposeDetailPage } from '@/components/compose/compose-detail-page';

export default async function ComposeDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <ComposeDetailPage id={decodeURIComponent(id)} />
    </AppShell>
  );
}
