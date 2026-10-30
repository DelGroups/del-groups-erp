"use client";

import React, { createContext, useContext } from "react";

const UiStandardContext = createContext(false);

/** Carries UI_STANDARD (server env, UI-1) to client screens that switch to the new controls. */
export function UiStandardProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <UiStandardContext.Provider value={enabled}>{children}</UiStandardContext.Provider>;
}

/** UI_STANDARD is on: screens use DateField / Combobox instead of native date inputs and selects. */
export function useUiStandard(): boolean {
  return useContext(UiStandardContext);
}
