import { useCallback, useState } from "react";

/** Plain try/catch wrappers, not a hook — for a one-off read/write outside React state (a
 *  mount-time default, an event handler) where `useLocalStorage` below would be overkill.
 *  `localStorage` throws in a private window with site data blocked, and in some sandboxed
 *  iframes — every access here is guarded so a blocked/disabled store degrades to "nothing
 *  persisted" instead of crashing the app (`docs/features/23-ux-infrastructure-core.md`). */
export const storage = {
  get<T>(key: string): T | undefined {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  },
  set(key: string, value: unknown): void {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage blocked/full/disabled — the value simply isn't persisted this session.
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Same as `set` above.
    }
  },
};

/** React-state-backed `localStorage` value, same shape as `useState` plus persistence — every
 *  read/write goes through `storage` above, so it degrades the same way when storage is
 *  unavailable (state still works for the lifetime of the page, just isn't remembered next
 *  visit). Per-viewer convenience only (a remembered tab, a collapsed section) — never the only
 *  copy of state that matters, since it can come back empty at any time. */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => storage.get<T>(key) ?? initialValue);

  const setAndPersist = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        storage.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, setAndPersist] as const;
}
