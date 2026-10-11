"use client";

import React from "react";
import InvoicePrintLayout from "@/components/print/InvoicePrintLayout";
import { mapSaleToInvoicePrint } from "@/lib/print/mapSaleToInvoicePrint";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import type { SaleRecord } from "@/lib/sales/fetchSales";

interface SalesPrintTemplateProps {
  sale: SaleRecord;
  companyName?: string;
}

/** @deprecated Use InvoicePrintLayout via InvoicePrintSystem instead. */
export default function SalesPrintTemplate({
  sale,
  companyName,
}: SalesPrintTemplateProps) {
  const branding = useCompanyBranding();
  return (
    <InvoicePrintLayout
      data={mapSaleToInvoicePrint(sale)}
      mode="official"
      branding={{ ...branding, companyName: companyName || branding.companyName }}
    />
  );
}
