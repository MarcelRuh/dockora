'use client';

import { WebTerminal } from '@/components/terminal/web-terminal';
import { useLocale } from '@/i18n/locale-provider';
import { getSessionToken } from '@/lib/auth';

export function ContainerTerminal({ containerId }: { containerId: string }) {
  const { t } = useLocale();

  return (
    <WebTerminal
      path={`/containers/${encodeURIComponent(containerId)}/terminal`}
      token={getSessionToken()}
      errorLabel={t.containers.terminal.error}
      unauthorizedLabel={t.containers.terminal.unauthorized}
      heightClassName="h-[420px]"
    />
  );
}
