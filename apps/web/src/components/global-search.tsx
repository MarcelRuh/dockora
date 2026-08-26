'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchComposeProjects, fetchContainers, fetchImages } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { cn } from '@/lib/utils';

type Hit = { href: string; label: string; hint: string };

const NAV_HITS = [
  { href: '/', key: 'dashboard' },
  { href: '/containers', key: 'containers' },
  { href: '/compose', key: 'compose' },
  { href: '/images', key: 'images' },
  { href: '/volumes', key: 'volumes' },
  { href: '/updates', key: 'updates' },
  { href: '/monitoring', key: 'monitoring' },
  { href: '/network', key: 'network' },
  { href: '/backups', key: 'backups' },
  { href: '/logs', key: 'logs' },
  { href: '/terminal', key: 'terminal' },
  { href: '/settings', key: 'settings' },
] as const;

export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHits = useCallback(async () => {
    setLoading(true);
    try {
      const [containers, projects, images] = await Promise.all([
        fetchContainers().catch(() => []),
        fetchComposeProjects().catch(() => []),
        fetchImages().catch(() => []),
      ]);
      const next: Hit[] = [];
      for (const item of NAV_HITS) {
        next.push({ href: item.href, label: t.nav[item.key], hint: t.common.pages });
      }
      for (const c of containers) {
        next.push({
          href: `/containers/${encodeURIComponent(c.id)}`,
          label: c.name,
          hint: c.image,
        });
      }
      for (const p of projects) {
        next.push({
          href: `/compose/${encodeURIComponent(p.id)}`,
          label: p.name,
          hint: p.path,
        });
      }
      for (const img of images) {
        const tag = img.tags[0] ?? img.id.slice(0, 12);
        next.push({
          href: '/images',
          label: tag,
          hint: t.nav.images,
        });
      }
      setHits(next);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    void loadHits();
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, [open, loadHits]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hits.slice(0, 12);
    return hits
      .filter(
        (h) =>
          h.label.toLowerCase().includes(q) ||
          h.hint.toLowerCase().includes(q) ||
          h.href.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [hits, query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'dockora-field font-mono text-xs uppercase tracking-wider transition-shadow hover:border-dockora-pink hover:shadow-neon-pink',
          compact ? 'px-2 py-1' : 'w-full px-3 py-1.5 text-left',
        )}
        aria-label={t.common.globalSearch}
      >
        {compact ? t.common.search : t.common.globalSearchHint}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={t.common.globalSearch}>
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label={t.common.close}
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-1/2 top-[12vh] w-[min(36rem,92vw)] -translate-x-1/2 overflow-hidden rounded-md border border-dockora-border bg-dockora-surface shadow-neon">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.common.globalSearch}
              className="dockora-field w-full rounded-none border-0 border-b border-dockora-border px-4 py-3 font-mono text-sm"
            />
            <ul className="max-h-[min(50vh,22rem)] overflow-y-auto py-1">
              {loading && hits.length === 0 ? (
                <li className="px-4 py-3 text-sm text-dockora-muted">{t.common.loading}</li>
              ) : null}
              {!loading && filtered.length === 0 ? (
                <li className="px-4 py-3 text-sm text-dockora-muted">{t.common.noData}</li>
              ) : null}
              {filtered.map((hit) => (
                <li key={`${hit.href}:${hit.label}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left hover:bg-dockora-accentSoft"
                    onClick={() => go(hit.href)}
                  >
                    <span className="text-sm text-dockora-text">{hit.label}</span>
                    <span className="truncate font-mono text-[10px] text-dockora-muted">{hit.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
