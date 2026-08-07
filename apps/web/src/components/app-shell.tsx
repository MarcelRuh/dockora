'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/i18n/locale-provider';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import type { Locale } from '@dockora/shared';
import { AuthLogoutButton } from '@/components/auth/auth-provider';
import { NAV_ICONS } from '@/components/ui/nav-icons';

const NAV_ITEMS = [
  { key: 'dashboard', href: '/', ready: true },
  { key: 'containers', href: '/containers', ready: true },
  { key: 'compose', href: '/compose', ready: true },
  { key: 'images', href: '/images', ready: true },
  { key: 'updates', href: '/updates', ready: true },
  { key: 'monitoring', href: '/monitoring', ready: true },
  { key: 'network', href: '/network', ready: true },
  { key: 'backups', href: '/backups', ready: true },
  { key: 'logs', href: '/logs', ready: true },
  { key: 'settings', href: '/settings', ready: true },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();

  return (
    <div className="relative flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-dockora-border bg-dockora-rail text-dockora-railText md:flex">
        <Link href="/" className="flex items-center gap-3 px-5 py-6">
          <span className="dockora-brand-mark flex h-10 w-10 items-center justify-center font-display text-base font-extrabold tracking-tight">
            Dk
          </span>
          <span>
            <span className="block font-display text-xl font-bold tracking-tight">{t.appName}</span>
            <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
              {t.tagline}
            </span>
          </span>
        </Link>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              const Icon = NAV_ICONS[item.key];
              const className = cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'dockora-nav-active'
                  : 'text-white/55 hover:bg-white/5 hover:text-white',
              );

              return (
                <li key={item.key}>
                  {item.ready ? (
                    <Link href={item.href} className={className}>
                      <Icon className={cn(active ? 'opacity-100' : 'opacity-80')} />
                      <span>{t.nav[item.key]}</span>
                    </Link>
                  ) : (
                    <span className={className}>
                      <Icon className="opacity-50" />
                      <span>{t.nav[item.key]}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="space-y-2 border-t border-white/10 px-3 py-4">
          <div className="flex gap-2">
            <select
              aria-label={t.locale.label}
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 font-mono text-xs outline-none focus:border-dockora-accent"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="de">DE</option>
              <option value="en">EN</option>
            </select>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-xs uppercase tracking-wider hover:border-dockora-accent"
              aria-label={t.theme.toggle}
            >
              {theme === 'dark' ? t.theme.light : t.theme.dark}
            </button>
          </div>
          <AuthLogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-dockora-border bg-dockora-bg/90 px-4 py-3 backdrop-blur-md md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <span className="dockora-brand-mark flex h-8 w-8 items-center justify-center text-sm font-extrabold">
              Dk
            </span>
            <span className="font-display text-lg font-bold">{t.appName}</span>
          </Link>
          <div className="flex items-center gap-2">
            <select
              aria-label={t.locale.label}
              className="rounded-lg border border-dockora-border bg-dockora-surface px-2 py-1 font-mono text-xs"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="de">DE</option>
              <option value="en">EN</option>
            </select>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg border border-dockora-border bg-dockora-surface px-2 py-1 font-mono text-xs"
            >
              {theme === 'dark' ? t.theme.light : t.theme.dark}
            </button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-dockora-border px-3 py-2 md:hidden">
          {NAV_ITEMS.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = NAV_ICONS[item.key];
            return item.ready ? (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
                  active ? 'dockora-nav-active' : 'text-dockora-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t.nav[item.key]}</span>
              </Link>
            ) : (
              <span
                key={item.key}
                className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs text-dockora-muted"
              >
                <Icon className="h-3.5 w-3.5 opacity-50" />
                <span>{t.nav[item.key]}</span>
              </span>
            );
          })}
        </nav>

        <main className="mx-auto w-full max-w-shell flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
