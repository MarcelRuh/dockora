'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'dockora-theme';

/** Dockora is dark-only. Strip leftover light class / storage from older versions. */
export function DarkTheme({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('dark');
    root.classList.remove('light');
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return children;
}
