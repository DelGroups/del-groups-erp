"use client";

import React from "react";
import Barcode from "react-barcode";

interface BarcodeDisplayProps {
  /** Barcode value (numeric or alphanumeric string). */
  value: string | null | undefined;
  width?: number;
  height?: number;
  fontSize?: number;
  className?: string;
  showValue?: boolean;
}

export default function BarcodeDisplay({
  value,
  width = 1.4,
  height = 36,
  fontSize = 11,
  className = "",
  showValue = true,
}: BarcodeDisplayProps) {
  const code = (value || "").trim();

  if (!code) {
    return <span className="text-xs text-app-muted">—</span>;
  }

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <Barcode
        value={code}
        width={width}
        height={height}
        fontSize={fontSize}
        displayValue={showValue}
        margin={2}
        background="#ffffff"
      />
    </div>
  );
}
