'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { proxiedIconUrl } from '@/lib/icon-proxy';

export function ServiceIcon({
  url,
  alt,
  size = 'md',
  className,
}: {
  url: string | null | undefined;
  alt: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dim = size === 'sm' ? 'h-5 w-5' : size === 'lg' ? 'h-10 w-10' : 'h-7 w-7';
  const src = proxiedIconUrl(url);

  if (!src || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex shrink-0 items-center justify-center border border-[rgba(131,56,236,0.35)] bg-white/[0.04] font-mono text-[10px] uppercase text-dockora-muted',
          dim,
          className,
        )}
        title={alt}
      >
        {alt.slice(0, 1)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN icons from Compose labels
    <img
      src={src}
      alt=""
      title={alt}
      width={size === 'sm' ? 20 : size === 'lg' ? 40 : 28}
      height={size === 'sm' ? 20 : size === 'lg' ? 40 : 28}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-sm object-contain', dim, className)}
    />
  );
}
