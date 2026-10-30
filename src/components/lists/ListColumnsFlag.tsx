"use client";

import React, { createContext, useContext } from "react";

const ListColumnsFlagContext = createContext(false);

/** Carries LIST_COLUMNS (server env, prompt 24c) to the classic and the new UI lists. */
export function ListColumnsFlagProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <ListColumnsFlagContext.Provider value={enabled}>{children}</ListColumnsFlagContext.Provider>;
}

/** LIST_COLUMNS is on: lists show the column picker and the standard columns. */
export function useListColumnsEnabled(): boolean {
  return useContext(ListColumnsFlagContext);
}
