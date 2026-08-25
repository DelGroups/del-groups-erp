"use client";

import { useEffect, useState } from "react";

export function useDocumentPrint<T>() {
  const [printData, setPrintData] = useState<T | null>(null);

  useEffect(() => {
    if (!printData) return;

    const timer = window.setTimeout(() => {
      window.print();
    }, 150);

    const onAfterPrint = () => setPrintData(null);
    window.addEventListener("afterprint", onAfterPrint);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [printData]);

  return { printData, setPrintData };
}
