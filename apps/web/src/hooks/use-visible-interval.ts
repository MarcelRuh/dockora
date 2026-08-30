'use client';

import { useEffect, useRef } from 'react';

/** Interval that pauses while the document is hidden. */
export function useVisibleInterval(callback: () => void, ms: number): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      cbRef.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
