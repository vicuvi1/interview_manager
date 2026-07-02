import { useEffect, useMemo, useRef } from "react";

/**
 * Returns a stable debounced version of `fn`. Rapid calls (e.g. a burst of
 * realtime postgres_changes) collapse into a single call after `ms` of quiet.
 */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms = 300) {
  const ref = useRef(fn);
  ref.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useMemo(() => {
    return (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...args), ms);
    };
  }, [ms]);
}
