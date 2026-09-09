"use client";

import React from "react";
import Barcode from "react-barcode";
import { isEan13Payload } from "@/lib/barcode/labelConfig";

interface BarcodeDisplayProps {
  /** Barcode value (numeric or alphanumeric string). */
  value: string | null | undefined;
  width?: number;
  height?: number;
  fontSize?: number;
  className?: string;
  showValue?: boolean;
  format?: "CODE128" | "EAN13";
}

export default function BarcodeDisplay({
  value,
  width = 1.4,
  height = 36,
  fontSize = 11,
  className = "",
  showValue = true,
  format = "CODE128",
}: BarcodeDisplayProps) {
  const code = (value || "").trim();

  if (!code) {
    return <span className="text-xs text-app-muted">—</span>;
  }

  const resolvedFormat = format === "EAN13" && isEan13Payload(code) ? "EAN13" : "CODE128";

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <Barcode
        value={code}
        format={resolvedFormat}
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
