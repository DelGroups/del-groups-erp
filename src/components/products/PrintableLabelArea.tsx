"use client";

import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

interface PrintableLabelAreaProps {
  children: React.ReactNode;
}

/** Renders barcode print markup as a direct child of `body` for reliable @media print isolation. */
export default function PrintableLabelArea({ children }: PrintableLabelAreaProps) {
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div id="thermal-label-print-area" className="printable-label-area thermal-label-print-area">
      {children}
    </div>,
    document.body
  );
}
