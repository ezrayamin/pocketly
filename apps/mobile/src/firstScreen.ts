import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * "The first screen shows real data", once per app run. Work that can wait keys on it (notifications start then,
 * ADR-0017 §4), and so does BM-01's fully-drawn marker; neither depends on the other. Home marks it today; a screen
 * the app opens on instead (a deep link) marks it the same way.
 */
let ready = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markFirstScreenReady(): void {
  if (ready) return;
  ready = true;
  for (const listener of listeners) listener();
}

export function useFirstScreenReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready);
}

/** For a screen: marks the app's first screen ready once `shown`, in the same frame (a layout effect). */
export function useMarkFirstScreenReady(shown: boolean): void {
  useLayoutEffect(() => {
    if (shown) markFirstScreenReady();
  }, [shown]);
}

/** Tests only: a fresh app run. */
export function resetFirstScreenReady(): void {
  ready = false;
}
