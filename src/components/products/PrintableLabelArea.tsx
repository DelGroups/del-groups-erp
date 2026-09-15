"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface PrintableLabelAreaProps {
  children: React.ReactNode;
}

/** Renders barcode print markup as a direct child of `body` for reliable @media print isolation. */
export default function PrintableLabelArea({ children }: PrintableLabelAreaProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(<div className="printable-label-area">{children}</div>, document.body);
}
