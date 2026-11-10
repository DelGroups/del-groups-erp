"use client";

import { useCallback, useState } from "react";
import { sameValue } from "@/lib/settings/form";

/**
 * Last saved value of a settings form next to the one being edited (SETTINGS_V2): `dirty` drives
 * the save bar and the unsaved-changes warning; `discard` gives the saved value back. Call
 * `markSaved` after loading and after a successful save.
 */
export function useSettingsDraft<T>(initial: T) {
  const [saved, setSaved] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const markSaved = useCallback((value: T) => {
    setSaved(value);
    setReady(true);
  }, []);
  return {
    saved,
    ready,
    markSaved,
    isDirty: (current: T) => ready && !sameValue(current, saved),
  };
}
