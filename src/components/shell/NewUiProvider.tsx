"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { NEW_UI_COOKIE, NEW_UI_COOKIE_MAX_AGE, newShellActive } from "@/lib/shell/shell";

export interface NewUiServerValue {
  /** NEW_UI is on for this deployment (server env). */
  available: boolean;
  /** The user chose the new shell (cookie, read only while NEW_UI is on). */
  preferred: boolean;
  /** Tenant brand colour for the new UI (system_settings.ui_brand), or null. */
  brand: string | null;
}

interface NewUiValue {
  available: boolean;
  preferred: boolean;
  brand: string | null;
  /** The new shell is shown to this user right now. */
  active: boolean;
  /** This user may switch (NEW_UI on and admin). */
  canToggle: boolean;
  setPreferred: (on: boolean) => void;
}

const OFF: NewUiValue = { available: false, preferred: false, brand: null, active: false, canToggle: false, setPreferred: () => undefined };
const NewUiContext = createContext<NewUiValue>(OFF);

/**
 * The new shell switch (prompt 16). With NEW_UI off (the default) `available` is false and
 * nothing anywhere changes. With it on, an admin can switch their own interface; the choice
 * is a cookie, so the first paint already has the right shell. Must sit inside AuthProvider.
 */
export function NewUiProvider({ value, children }: { value: NewUiServerValue; children: React.ReactNode }) {
  const { ready, loading, isAdmin } = useAuth();
  const router = useRouter();
  const [preferred, setPreferredState] = useState(value.available && value.preferred);

  const setPreferred = useCallback(
    (on: boolean) => {
      if (!value.available) return;
      document.cookie = `${NEW_UI_COOKIE}=${on ? "1" : "0"}; path=/; max-age=${NEW_UI_COOKIE_MAX_AGE}; samesite=lax`;
      setPreferredState(on);
      router.refresh();
    },
    [router, value.available]
  );

  const ctx = useMemo<NewUiValue>(() => {
    if (!value.available) return OFF;
    return {
      available: true,
      preferred,
      brand: value.brand,
      active: newShellActive({ available: true, preferred, authReady: ready && !loading, isAdmin }),
      canToggle: isAdmin,
      setPreferred,
    };
  }, [value.available, value.brand, preferred, ready, loading, isAdmin, setPreferred]);

  return <NewUiContext.Provider value={ctx}>{children}</NewUiContext.Provider>;
}

export function useNewUi(): NewUiValue {
  return useContext(NewUiContext);
}
