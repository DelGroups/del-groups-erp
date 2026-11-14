"use client";

import React, { createContext, useContext } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { accountingGuardActive } from "@/lib/features/accountingGuard";

const AccountingGuardContext = createContext<{ enabled: boolean; ai: boolean }>({ enabled: false, ai: false });

/** Carries ACCOUNTING_GUARD and ACCOUNTING_GUARD_AI (server env) to the client; the buttons of the guard read them. */
export function AccountingGuardProvider({ enabled, ai = false, children }: { enabled: boolean; ai?: boolean; children: React.ReactNode }) {
  return <AccountingGuardContext.Provider value={{ enabled, ai }}>{children}</AccountingGuardContext.Provider>;
}

/** The Accounting Guard is shown: the flag is on and the user is an admin. */
export function useAccountingGuard(): boolean {
  const { enabled } = useContext(AccountingGuardContext);
  const { isAdmin } = useAuth();
  return accountingGuardActive({ enabled, isAdmin });
}

/** The accountant agent's screens are shown (GUARD-5): the guard is shown and ACCOUNTING_GUARD_AI is on. */
export function useGuardAgent(): boolean {
  const { ai } = useContext(AccountingGuardContext);
  return useAccountingGuard() && ai;
}
