"use client";

import React, { createContext, useContext } from "react";

const DeliveryActContext = createContext(false);

/** Carries DELIVERY_ACT (server env) to the sales list and the sales invoice. */
export function DeliveryActProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <DeliveryActContext.Provider value={enabled}>{children}</DeliveryActContext.Provider>;
}

/** DELIVERY_ACT is on: "Təhvil-təslim aktı" is offered for sales invoices. */
export function useDeliveryActEnabled(): boolean {
  return useContext(DeliveryActContext);
}
