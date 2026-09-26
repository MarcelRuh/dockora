'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/i18n/locale-provider';
import { GlobalSearch } from '@/components/global-search';
import { NeonAtmosphere, NeonParticles } from '@/components/ui/neon-particles';
import { cn } from '@/lib/utils';
import type { Locale } from '@dockora/shared';
import { AuthLogoutButton, useAuth } from '@/components/auth/auth-provider';
import { NAV_ICONS } from '@/components/ui/nav-icons';
import { BrandLogo, BrandLogoWide } from '@/components/ui/brand-logo';
import { fetchSelfUpdateStatus } from '@/lib/api';
import { canAdmin } from '@/lib/roles';

const NAV_ITEMS = [
  { key: 'dashboard', href: '/', ready: true },
  { key: 'containers', href: '/containers', ready: true },
  { key: 'compose', href: '/compose', ready: true },
  { key: 'images', href: '/images', ready: true },
  { key: 'volumes', href: '/volumes', ready: true },
  { key: 'updates', href: '/updates', ready: true },
  { key: 'monitoring', href: '/monitoring', ready: true },
  { key: 'network', href: '/network', ready: true },
  { key: 'backups', href: '/backups', ready: true },
  { key: 'logs', href: '/logs', ready: true },
  { key: 'terminal', href: '/terminal', ready: true },
  { key: 'selfUpdate', href: '/self-update', ready: true },
  { key: 'settings', href: '/settings', ready: true },
] as const;

let selfUpdateCache: { at: number; available: boolean } | null = null;
const SELF_UPDATE_CACHE_MS = 60_000;

function useSelfUpdateAvailable() {
  const { authEnabled, user } = useAuth();
  const [available, setAvailable] = useState(
    () => selfUpdateCache?.available ?? false,
  );

  useEffect(() => {
    if (!canAdmin(user?.role, authEnabled)) {
      setAvailable(false);
      return;
    }
    if (selfUpdateCache && Date.now() - selfUpdateCache.at < SELF_UPDATE_CACHE_MS) {
      setAvailable(selfUpdateCache.available);
      return;
    }
    let cancelled = false;
    void fetchSelfUpdateStatus()
      .then((status) => {
        const next = Boolean(status.updateAvailable);
        selfUpdateCache = { at: Date.now(), available: next };
        if (!cancelled) setAvailable(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authEnabled, user?.role]);

  return available;
}

function NavList({
  onNavigate,
  compact = false,
  iconOnly = false,
}: {
  onNavigate?: () => void;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const selfUpdateAvailable = useSelfUpdateAvailable();

  return (
    <ul className={cn('space-y-0.5', compact && 'space-y-0')}>
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const Icon = NAV_ICONS[item.key];
        const className = cn(
          'flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors',
          compact && 'py-2',
          iconOnly && 'justify-center rounded-xl px-2 py-2.5',
          active
            ? 'dockora-nav-active'
            : 'text-dockora-railMuted hover:bg-dockora-accentSoft hover:text-white hover:shadow-[0_0_16px_rgba(255,0,110,0.15)]',
        );

        return (
          <li key={item.key}>
            {item.ready ? (
              <Link
                href={item.href}
                className={className}
                onClick={onNavigate}
                title={t.nav[item.key]}
                aria-current={active ? 'page' : undefined}
                aria-label={
                  item.key === 'selfUpdate' && selfUpdateAvailable
                    ? `${t.nav.selfUpdate} – ${t.settings.selfUpdate.apply}`
                    : t.nav[item.key]
                }
              >
                <span className="relative">
                  <Icon className={cn('opacity-90', iconOnly ? 'h-5 w-5' : 'h-4 w-4')} />
                  {iconOnly && item.key === 'selfUpdate' && selfUpdateAvailable ? (
                    <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-dockora-pink" aria-hidden />
                  ) : null}
                </span>
                <span className={cn('flex min-w-0 items-center gap-2', iconOnly && 'sr-only')}>
                  {t.nav[item.key]}
                  {item.key === 'selfUpdate' && selfUpdateAvailable ? (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-dockora-pink shadow-[0_0_8px_rgba(255,0,110,0.9)]"
                      title={t.settings.selfUpdate.apply}
                      aria-hidden
                    />
                  ) : null}
                </span>
              </Link>
            ) : (
              <span className={className}>
                <Icon className="h-4 w-4 opacity-40" />
                <span>{t.nav[item.key]}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LocaleControls({ dense = false, search = true }: { dense?: boolean; search?: boolean }) {
  const { t, locale, setLocale } = useLocale();

  return (
    <div className={cn('flex gap-2', dense ? 'items-center' : 'flex-col')}>
      {search ? <GlobalSearch compact={dense} /> : null}
      <select
        aria-label={t.locale.label}
        className={cn(
          'dockora-field dockora-select font-mono text-xs',
          dense ? 'px-2 py-1' : 'flex-1 px-3 py-1.5',
        )}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        <option value="de">DE</option>
        <option value="en">EN</option>
      </select>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const home = pathname === '/';
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const current = NAV_ITEMS.find((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  );

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <div className="pointer-events-none fixed inset-0 z-0">
        <NeonParticles />
        <NeonAtmosphere />
      </div>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:bg-dockora-surface focus:px-3 focus:py-2 focus:text-sm focus:text-dockora-text"
      >
        {t.common.skipToContent}
      </a>

      {home ? null : (
      <aside className="relative z-10 hidden h-full w-60 shrink-0 flex-col border-r border-white/10 bg-black/35 text-dockora-railText backdrop-blur-xl md:flex">
        <Link
          href="/"
          className="border-b border-white/10 px-4 py-4 transition-opacity hover:opacity-95"
          aria-label={t.appName}
        >
          <BrandLogoWide size="sm" priority />
        </Link>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <NavList />
        </nav>
      </aside>
      )}

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className={cn('z-40 items-center justify-between gap-3 border-b border-white/10 bg-black/30 px-4 py-3 backdrop-blur', home ? 'hidden' : 'flex')}>
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              className="dockora-field flex h-9 w-9 items-center justify-center"
              aria-label={t.common.menu}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <span className="sr-only">{t.common.menu}</span>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <Link href="/" className="flex items-center" aria-label={t.appName}>
              <BrandLogo size="sm" priority />
            </Link>
          </div>
          <span className="hidden min-w-0 flex-1 truncate text-sm font-medium md:block">
            {current ? t.nav[current.key] : t.appName}
          </span>
          <GlobalSearch compact className="hidden md:inline-flex" />
          <LocaleControls dense search={false} />
          <AuthLogoutButton className="hidden w-auto md:inline-flex" />
        </header>

        {drawerOpen ? (
          <div className="fixed inset-0 z-50 md:hidden" role="presentation">
            <button
              type="button"
              className="absolute inset-0 bg-black/70"
              aria-label={t.common.close}
              onClick={() => setDrawerOpen(false)}
            />
            <aside
              className="absolute inset-y-0 left-0 flex w-[min(18rem,88vw)] flex-col border-r border-dockora-railBorder bg-dockora-rail text-dockora-railText shadow-neon animate-in slide-in-from-left duration-200"
              role="dialog"
              aria-modal="true"
              aria-label={t.common.menu}
            >
              <div className="flex items-center justify-between gap-3 border-b border-dockora-railBorder px-3 py-3">
                <BrandLogoWide size="sm" />
                <button
                  type="button"
                  className="dockora-field px-2 py-1 font-mono text-xs uppercase"
                  onClick={() => setDrawerOpen(false)}
                >
                  {t.common.close}
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-2 py-3">
                <NavList compact onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <div className="space-y-2 border-t border-dockora-railBorder px-3 py-4">
                <LocaleControls search={false} />
                <AuthLogoutButton />
              </div>
            </aside>
          </div>
        ) : null}

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            home
              ? 'px-3 py-3 sm:px-5 sm:py-5'
              : 'mx-auto w-full max-w-shell px-4 py-8 sm:px-6 sm:py-10 xl:px-8',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
