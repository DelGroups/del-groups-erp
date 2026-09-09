"use client";

import { useEffect, useState } from "react";

export function useDocumentPrint<T>(delayMs = 150) {
  const [printData, setPrintData] = useState<T | null>(null);

  useEffect(() => {
    if (!printData) return;

    const timer = window.setTimeout(() => {
      window.print();
    }, delayMs);

    const onAfterPrint = () => setPrintData(null);
    window.addEventListener("afterprint", onAfterPrint);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [printData, delayMs]);

  return { printData, setPrintData };
}
