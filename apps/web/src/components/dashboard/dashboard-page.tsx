'use client';

import { DashboardView } from '@/components/dashboard/dashboard-view';
import { HomeChrome } from '@/components/home-chrome';
import { useDashboard } from '@/hooks/use-dashboard';

export function DashboardPage() {
  const dashboard = useDashboard();
  return (
    <HomeChrome>
      <DashboardView {...dashboard} />
    </HomeChrome>
  );
}
