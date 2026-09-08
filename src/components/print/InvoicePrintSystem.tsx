"use client";

import React from "react";
import InvoicePrintLayout from "@/components/print/InvoicePrintLayout";
import PrintInvoiceModal from "@/components/print/PrintInvoiceModal";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useInvoicePrint } from "@/hooks/useInvoicePrint";

export function useInvoicePrintSystem() {
  const branding = useCompanyBranding();
  const invoicePrint = useInvoicePrint();
  return { branding, ...invoicePrint };
}

interface InvoicePrintSystemProps {
  branding: ReturnType<typeof useCompanyBranding>;
  modalOpen: boolean;
  pendingData: import("@/lib/print/types").InvoicePrintData | null;
  printPayload: ReturnType<typeof useInvoicePrint>["printPayload"];
  closeModal: () => void;
  confirmPrint: ReturnType<typeof useInvoicePrint>["confirmPrint"];
}

export function InvoicePrintSystem({
  branding,
  modalOpen,
  pendingData,
  printPayload,
  closeModal,
  confirmPrint,
}: InvoicePrintSystemProps) {
  return (
    <>
      <PrintInvoiceModal
        open={modalOpen}
        docNo={pendingData?.docNo}
        officialOnly={pendingData?.isOfficial === true}
        onClose={closeModal}
        onSelect={confirmPrint}
      />

      {printPayload ? (
        <div className="print-area">
          <InvoicePrintLayout
            data={printPayload.data}
            mode={printPayload.data.isOfficial ? "official" : printPayload.mode}
            branding={branding}
          />
        </div>
      ) : null}
    </>
  );
}
