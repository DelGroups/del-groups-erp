"use client";

import React, { createContext, useContext } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { accountingGuardActive } from "@/lib/features/accountingGuard";

const AccountingGuardContext = createContext<{ enabled: boolean }>({ enabled: false });

/** Carries ACCOUNTING_GUARD (server env) to the client; the buttons of the guard read it. */
export function AccountingGuardProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <AccountingGuardContext.Provider value={{ enabled }}>{children}</AccountingGuardContext.Provider>;
}

/** The Accounting Guard is shown: the flag is on and the user is an admin. */
export function useAccountingGuard(): boolean {
  const { enabled } = useContext(AccountingGuardContext);
  const { isAdmin } = useAuth();
  return accountingGuardActive({ enabled, isAdmin });
}
