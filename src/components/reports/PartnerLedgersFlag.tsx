"use client";

import React, { createContext, useContext } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { partnerLedgersActive, type PartnerLedgersAudience } from "@/lib/features/partnerLedgers";

interface PartnerLedgersValue {
  enabled: boolean;
  audience: PartnerLedgersAudience;
}

const PartnerLedgersContext = createContext<PartnerLedgersValue>({ enabled: false, audience: "admins" });

/** Carries PARTNER_LEDGERS and PARTNER_LEDGERS_AUDIENCE (server env, LED-3) to the client. */
export function PartnerLedgersProvider({ value, children }: { value: PartnerLedgersValue; children: React.ReactNode }) {
  return <PartnerLedgersContext.Provider value={value}>{children}</PartnerLedgersContext.Provider>;
}

/** This user gets the partner ledger pages (flag on, audience, can_view_financial_reports). */
export function usePartnerLedgers(): boolean {
  const { enabled, audience } = useContext(PartnerLedgersContext);
  const { isAdmin, can } = useAuth();
  return partnerLedgersActive({ enabled, audience, isAdmin, canViewFinancialReports: isAdmin || can("can_view_financial_reports") });
}
