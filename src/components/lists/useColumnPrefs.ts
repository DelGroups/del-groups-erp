"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  columnPrefsKey,
  defaultColumnPrefs,
  mergeColumnPrefs,
  resetColumnPrefs,
  saveColumnPrefs,
  type ColumnPrefs,
  type ListColumnDef,
} from "@/lib/lists/columns";

// One store for every list: localStorage is the truth; `memory` keeps a choice for this tab when
// the browser refuses storage (private mode), and listeners re-render lists that read a key.
const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};

function readRaw(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch {
    // Storage blocked: fall back to this tab's copy.
  }
  return memory.get(key) ?? null;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // Another tab changed a choice.
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

const serverSnapshot = () => null;

type ColumnLike = Pick<ListColumnDef, "key" | "defaultVisible" | "required">;

export interface ColumnPrefsApi {
  prefs: ColumnPrefs;
  /** Nothing stored: the list shows its defaults. */
  isDefault: boolean;
  setPrefs: (next: ColumnPrefs) => void;
  reset: () => void;
}

/**
 * The signed-in user's column choice for one list (prompt 24c), in this browser. The server
 * render and the first client render use the defaults, so hydration matches; the stored choice
 * follows at once. `defs` should be stable (module constant or memoised).
 */
export function useColumnPrefs(listKey: string, defs: readonly ColumnLike[]): ColumnPrefsApi {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const storageKey = columnPrefsKey(listKey, userId);
  const raw = useSyncExternalStore(subscribe, () => readRaw(storageKey), serverSnapshot);
  const prefs = useMemo(() => {
    if (!raw) return defaultColumnPrefs(defs);
    try {
      return mergeColumnPrefs(defs, JSON.parse(raw));
    } catch {
      return defaultColumnPrefs(defs);
    }
  }, [raw, defs]);

  const setPrefs = useCallback(
    (next: ColumnPrefs) => {
      memory.set(storageKey, JSON.stringify({ visible: next.visible, order: next.order }));
      saveColumnPrefs(listKey, userId, next);
      notify();
    },
    [listKey, userId, storageKey]
  );
  const reset = useCallback(() => {
    memory.delete(storageKey);
    resetColumnPrefs(listKey, userId);
    notify();
  }, [listKey, userId, storageKey]);

  return { prefs, isDefault: raw === null, setPrefs, reset };
}
