"use client";

import React, { createContext, useContext } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

const DocDateChangeContext = createContext(false);

/** Carries DOC_DATE_CHANGE (server env, DATE-1) to the invoice lists and forms. */
export function DocDateChangeProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <DocDateChangeContext.Provider value={enabled}>{children}</DocDateChangeContext.Provider>;
}

/** DOC_DATE_CHANGE is on (whoever the user is). */
export function useDocDateChangeFlag(): boolean {
  return useContext(DocDateChangeContext);
}

/** The date change is offered: the flag is on AND the user is an admin (the server checks too). */
export function useDocDateChangeAllowed(): boolean {
  const flag = useContext(DocDateChangeContext);
  const { isAdmin } = useAuth();
  return flag && isAdmin;
}
