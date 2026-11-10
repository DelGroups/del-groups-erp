"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { NEW_UI_COOKIE, NEW_UI_COOKIE_MAX_AGE, newShellActive, newShellCanToggle, type NewUiAudience } from "@/lib/shell/shell";
import { newHomeActive, type NewHomeAudience } from "@/lib/features/newHome";
import { uiUnifiedActive, type UiUnifiedAudience } from "@/lib/features/uiUnified";

export interface NewUiServerValue {
  /** NEW_UI is on for this deployment (server env). */
  available: boolean;
  /** The user chose the new shell (cookie, read only while NEW_UI is on). */
  preferred: boolean;
  /** Tenant brand colour for the new UI (system_settings.ui_brand), or null. */
  brand: string | null;
  /** Who gets the new shell (NEW_UI_AUDIENCE): admins who opt in, or everyone by default. */
  audience?: NewUiAudience;
  /** NEW_CRM is on (server env): the new CRM pipeline replaces the deals screens in the new shell. */
  newCrm?: boolean;
  /** NEW_IMPORTS is on (server env): the Imports module (IMP-1) in the new shell. */
  newImports?: boolean;
  /** SETTINGS_V2 is on (server env): the new Settings layout (SET-1) in the new shell. */
  settingsV2?: boolean;
  /** NEW_HOME (server env) and NEW_HOME_AUDIENCE: the widget home page (prompt 24b). */
  newHome?: { enabled: boolean; audience: NewHomeAudience };
  /** UI_UNIFIED (server env) and UI_UNIFIED_AUDIENCE: the UI rulebook's shared parts (UI-7). */
  uiUnified?: { enabled: boolean; audience: UiUnifiedAudience };
}

interface NewUiValue {
  available: boolean;
  preferred: boolean;
  brand: string | null;
  audience: NewUiAudience;
  /** The new shell is shown to this user right now. */
  active: boolean;
  /** This user may switch (NEW_UI on and admin; every signed-in user with audience "all"). */
  canToggle: boolean;
  /** NEW_CRM is on; only matters while `active`. */
  newCrm: boolean;
  /** NEW_IMPORTS is on; only matters while `active`. */
  newImports: boolean;
  /** SETTINGS_V2 is on; only matters while `active` (useSettingsItems combines both). */
  settingsV2: boolean;
  /** This user gets the widget home (NEW_HOME on, audience admins/all); only while `active`. */
  newHome: boolean;
  /** This user gets the unified UI (UI_UNIFIED on, audience admins/all); only while `active`. */
  uiUnified: boolean;
  setPreferred: (on: boolean) => void;
}

const OFF: NewUiValue = { available: false, preferred: false, brand: null, audience: "admins", active: false, canToggle: false, newCrm: false, newImports: false, settingsV2: false, newHome: false, uiUnified: false, setPreferred: () => undefined };
const NewUiContext = createContext<NewUiValue>(OFF);

/**
 * The new shell switch (prompt 16). With NEW_UI off (the default) `available` is false and
 * nothing anywhere changes. With it on, an admin can switch their own interface; the choice
 * is a cookie, so the first paint already has the right shell. Must sit inside AuthProvider.
 */
export function NewUiProvider({ value, children }: { value: NewUiServerValue; children: React.ReactNode }) {
  const { ready, loading, isAdmin, user } = useAuth();
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
    const audience = value.audience ?? "admins";
    const signedIn = !!user;
    const authReady = ready && !loading;
    const active = newShellActive({ available: true, preferred, authReady, isAdmin, audience, signedIn });
    return {
      available: true,
      preferred,
      brand: value.brand,
      audience,
      active,
      canToggle: newShellCanToggle({ available: true, isAdmin, audience, signedIn }),
      newCrm: value.newCrm === true,
      newImports: value.newImports === true,
      settingsV2: value.settingsV2 === true,
      newHome: newHomeActive({ enabled: value.newHome?.enabled === true, audience: value.newHome?.audience ?? "admins", isAdmin }),
      uiUnified: uiUnifiedActive({ enabled: value.uiUnified?.enabled === true, audience: value.uiUnified?.audience ?? "admins", shellActive: active, isAdmin, authReady }),
      setPreferred,
    };
  }, [value.available, value.brand, value.audience, value.newCrm, value.newImports, value.settingsV2, value.newHome?.enabled, value.newHome?.audience, value.uiUnified?.enabled, value.uiUnified?.audience, preferred, ready, loading, isAdmin, user, setPreferred]);

  return <NewUiContext.Provider value={ctx}>{children}</NewUiContext.Provider>;
}

export function useNewUi(): NewUiValue {
  return useContext(NewUiContext);
}

/** True while the unified UI (UI_UNIFIED, UI-7) is on for this user. */
export function useUiUnified(): boolean {
  return useContext(NewUiContext).uiUnified;
}
