"use client";

import React, { createContext, useContext } from "react";

const CountTeamContext = createContext(false);

/** Carries COUNT_TEAM (server env, INV-4) to the inventory count screens. */
export function CountTeamProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <CountTeamContext.Provider value={enabled}>{children}</CountTeamContext.Provider>;
}

/** COUNT_TEAM is on: counts pick their responsible people from the employee list. */
export function useCountTeam(): boolean {
  return useContext(CountTeamContext);
}
