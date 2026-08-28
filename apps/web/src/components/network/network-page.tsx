'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContainerSummary } from '@dockora/shared';
import { fetchContainers } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { Button } from '@/components/ui/form-controls';
import { ErrorBanner, LoadingState, PageHeader } from '@/components/ui/page-parts';
import { PortCards } from '@/components/monitoring/port-cards';
import { NetworkTopology } from '@/components/monitoring/network-topology';

export function NetworkPage() {
  const { t } = useLocale();
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setContainers(await fetchContainers({ includeSelf: true }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.network.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.network.loadError]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-5 animate-in fade-in">
      <PageHeader
        title={t.network.title}
        subtitle={t.network.subtitle}
        actions={
          <Button variant="primary" onClick={() => void load()}>
            {t.common.refresh}
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {loading && containers.length === 0 ? <LoadingState message={t.common.loading} /> : null}

      {!loading || containers.length > 0 ? (
        <div className="space-y-5">
          <PortCards containers={containers} labels={t.network.ports} />
          <NetworkTopology containers={containers} labels={t.network.topology} />
        </div>
      ) : null}
    </div>
  );
}
