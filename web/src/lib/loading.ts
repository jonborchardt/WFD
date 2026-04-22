// Tiny module-global loading counter used by the top-of-page
// LinearProgress bar in AppShell. Pages call `trackLoad` around their
// async fetches; while any count is > 0 the progress bar renders.
//
// Usage:
//   useEffect(() => {
//     const done = beginLoad();
//     fetchData().then(setData).finally(done);
//   }, []);
//
// Or the convenience `trackLoad` wrapper:
//   trackLoad(fetchData()).then(setData);

import { useEffect, useSyncExternalStore } from "react";

let activeCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function beginLoad(): () => void {
  activeCount += 1;
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeCount = Math.max(0, activeCount - 1);
    emit();
  };
}

export function trackLoad<T>(p: Promise<T>): Promise<T> {
  const end = beginLoad();
  return p.finally(end);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): number {
  return activeCount;
}

// Subscribe a component to the loading count.
export function useLoadingCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Convenience: track N promises in one call, automatically ending when
// all resolve/reject. Use when a page kicks off multiple fetches.
export function useTrackedLoads(deps: unknown[], ...promises: Promise<unknown>[]): void {
  useEffect(() => {
    if (promises.length === 0) return;
    const end = beginLoad();
    Promise.allSettled(promises).finally(end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
