"use client";

import { useCallback, useEffect, useState } from "react";
import type { InvoicePrintData, PrintMode } from "@/lib/print/types";

export interface InvoicePrintPayload {
  data: InvoicePrintData;
  mode: PrintMode;
}

export function useInvoicePrint() {
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingData, setPendingData] = useState<InvoicePrintData | null>(null);
  const [printPayload, setPrintPayload] = useState<InvoicePrintPayload | null>(null);

  const requestPrint = useCallback((data: InvoicePrintData) => {
    if (data.isOfficial) {
      setPrintPayload({ data, mode: "official" });
      return;
    }
    setPendingData(data);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setPendingData(null);
  }, []);

  const confirmPrint = useCallback(
    (mode: PrintMode) => {
      if (!pendingData) return;
      const effectiveMode: PrintMode = pendingData.isOfficial ? "official" : mode;
      setPrintPayload({ data: pendingData, mode: effectiveMode });
      setModalOpen(false);
      setPendingData(null);
    },
    [pendingData]
  );

  useEffect(() => {
    if (!printPayload) return;

    const timer = window.setTimeout(() => {
      window.print();
    }, 200);

    const onAfterPrint = () => setPrintPayload(null);
    window.addEventListener("afterprint", onAfterPrint);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [printPayload]);

  return {
    modalOpen,
    pendingData,
    printPayload,
    requestPrint,
    closeModal,
    confirmPrint,
  };
}
