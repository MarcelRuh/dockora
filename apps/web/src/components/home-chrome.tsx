'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

let homeChrome = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return homeChrome;
}

function setHomeChrome(next: boolean) {
  if (homeChrome === next) return;
  homeChrome = next;
  for (const listener of listeners) listener();
}

/** AppShell reads this so the module sidebar stays off on the Casa home. */
export function useHomeChrome(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Mounted by the dashboard page to mark the home surface. */
export function HomeChrome({ children }: { children: ReactNode }) {
  useEffect(() => {
    setHomeChrome(true);
    return () => setHomeChrome(false);
  }, []);
  return children;
}
