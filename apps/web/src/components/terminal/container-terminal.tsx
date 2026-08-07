'use client';

import { WebTerminal } from '@/components/terminal/web-terminal';
import { useLocale } from '@/i18n/locale-provider';
import { getAuthToken } from '@/lib/auth';

export function ContainerTerminal({ containerId }: { containerId: string }) {
  const { t } = useLocale();

  return (
    <WebTerminal
      path={`/containers/${encodeURIComponent(containerId)}/terminal`}
      token={getAuthToken()}
      errorLabel={t.containers.terminal.error}
      unauthorizedLabel={t.containers.terminal.unauthorized}
      heightClassName="h-[420px]"
    />
  );
}
