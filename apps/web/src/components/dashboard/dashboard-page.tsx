'use client';

import { DashboardView } from '@/components/dashboard/dashboard-view';
import { useDashboard } from '@/hooks/use-dashboard';

export function DashboardPage() {
  const dashboard = useDashboard();
  return <DashboardView {...dashboard} />;
}
