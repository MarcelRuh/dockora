'use client';

import { DashboardView } from '@/components/dashboard/dashboard-view';
import { NeonAtmosphere, NeonParticles } from '@/components/ui/neon-particles';
import { useDashboard } from '@/hooks/use-dashboard';

export function DashboardPage() {
  const dashboard = useDashboard();
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0 md:left-60">
        <NeonParticles />
        <NeonAtmosphere />
      </div>
      <DashboardView {...dashboard} />
    </>
  );
}
