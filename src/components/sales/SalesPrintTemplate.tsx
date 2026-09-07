"use client";

import React from "react";
import InvoicePrintLayout from "@/components/print/InvoicePrintLayout";
import { mapSaleToInvoicePrint } from "@/lib/print/mapSaleToInvoicePrint";
import { DEFAULT_COMPANY_BRANDING } from "@/lib/print/types";
import type { SaleRecord } from "@/lib/sales/fetchSales";

interface SalesPrintTemplateProps {
  sale: SaleRecord;
  companyName?: string;
}

/** @deprecated Use InvoicePrintLayout via InvoicePrintSystem instead. */
export default function SalesPrintTemplate({
  sale,
  companyName = DEFAULT_COMPANY_BRANDING.companyName,
}: SalesPrintTemplateProps) {
  return (
    <InvoicePrintLayout
      data={mapSaleToInvoicePrint(sale)}
      mode="official"
      branding={{ ...DEFAULT_COMPANY_BRANDING, companyName }}
    />
  );
}
