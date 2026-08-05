import { AppShell } from '@/components/app-shell';
import { ContainerDetailPage } from '@/components/containers/container-detail-page';

export default async function ContainerDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <ContainerDetailPage id={decodeURIComponent(id)} />
    </AppShell>
  );
}
