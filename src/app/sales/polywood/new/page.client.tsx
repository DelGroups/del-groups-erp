"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import PageLayout from "@/components/layout/PageLayout";
import MixedDimensionalInvoiceForm from "@/components/polywood/MixedDimensionalInvoiceForm";
import { InvoicePrintSystem, useInvoicePrintSystem } from "@/components/print/InvoicePrintSystem";
import { fetchSaleById } from "@/lib/sales/fetchSales";
import { mapSaleToInvoicePrint } from "@/lib/print/mapSaleToInvoicePrint";

export default function PolywoodSalePageClient() {
  const router = useRouter();
  const invoicePrint = useInvoicePrintSystem();
  const returnAfterPrintRef = useRef(false);
  const goToSales = () => router.push("/sales");

  const handleSuccess = async (saleId?: string) => {
    if (saleId) {
      const sale = await fetchSaleById(saleId);
      if (sale) {
        returnAfterPrintRef.current = true;
        invoicePrint.requestPrint(
          mapSaleToInvoicePrint(sale, { variant: "polywood" })
        );
        return;
      }
    }
    goToSales();
  };

  const handleCloseModal = () => {
    invoicePrint.closeModal();
    if (returnAfterPrintRef.current) {
      returnAfterPrintRef.current = false;
      goToSales();
    }
  };

  useEffect(() => {
    if (!returnAfterPrintRef.current) return;
    if (!invoicePrint.printPayload && !invoicePrint.modalOpen) {
      returnAfterPrintRef.current = false;
      goToSales();
    }
  }, [invoicePrint.printPayload, invoicePrint.modalOpen]);

  return (
    <PageLayout>
      <MixedDimensionalInvoiceForm onClose={goToSales} onSuccess={handleSuccess} />
      <InvoicePrintSystem
        branding={invoicePrint.branding}
        modalOpen={invoicePrint.modalOpen}
        pendingData={invoicePrint.pendingData}
        printPayload={invoicePrint.printPayload}
        closeModal={handleCloseModal}
        confirmPrint={invoicePrint.confirmPrint}
      />
    </PageLayout>
  );
}
