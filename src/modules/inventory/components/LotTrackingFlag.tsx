"use client";

import React, { createContext, useContext } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { lotTrackingActive, type LotTrackingAudience } from "@/lib/features/lotTracking";

const LotTrackingContext = createContext<{ enabled: boolean; audience: LotTrackingAudience }>({ enabled: false, audience: "admins" });

/** Carries LOT_TRACKING and LOT_TRACKING_AUDIENCE (server env) to the inbound forms (LOT-2). */
export function LotTrackingProvider({ enabled, audience, children }: { enabled: boolean; audience: LotTrackingAudience; children: React.ReactNode }) {
  return <LotTrackingContext.Provider value={{ enabled, audience }}>{children}</LotTrackingContext.Provider>;
}

/** The lot fields are shown: the flag is on and the user is in its audience (admins unless "all"). */
export function useLotTracking(): boolean {
  const { enabled, audience } = useContext(LotTrackingContext);
  const { isAdmin } = useAuth();
  return lotTrackingActive({ enabled, audience, isAdmin });
}
