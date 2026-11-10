"use client";

import React, { createContext, useContext } from "react";

const InvoiceToolsContext = createContext(false);

/** Carries INVOICE_TOOLS (server env, INV-1) to the sales and purchase invoice forms. */
export function InvoiceToolsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <InvoiceToolsContext.Provider value={enabled}>{children}</InvoiceToolsContext.Provider>;
}

/** INVOICE_TOOLS is on: the invoice forms show the new tools ("New product", INV-2, INV-3). */
export function useInvoiceTools(): boolean {
  return useContext(InvoiceToolsContext);
}
