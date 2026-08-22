import { ComposeDetailPage } from '@/components/compose/compose-detail-page';

export default async function ComposeDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ComposeDetailPage id={decodeURIComponent(id)} />;
}
