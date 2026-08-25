"use client";

import React, { useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";

interface BarcodeScanFieldProps {
  onScan: (barcode: string) => void | Promise<void>;
  disabled?: boolean;
  autoFocus?: boolean;
}

export default function BarcodeScanField({
  onScan,
  disabled,
  autoFocus,
}: BarcodeScanFieldProps) {
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [scanning, setScanning] = useState(false);

  const refocusBarcodeInput = () => {
    if (disabled) return;
    window.setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 10);
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();

    const code = value.trim();
    if (!code || scanning) return;

    setScanning(true);
    try {
      await onScan(code);
      setValue("");
    } finally {
      setScanning(false);
      refocusBarcodeInput();
    }
  };

  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">
        <ScanBarcode className="h-4 w-4" />
        Barkod oxut
      </span>
      <input
        ref={barcodeInputRef}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Barkodu skan edin və ya daxil edin, Enter basın..."
        className="app-input w-full border-2 border-amber-500/40 px-4 py-3 font-mono text-sm shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30 disabled:opacity-60"
        autoComplete="off"
        autoFocus={autoFocus}
      />
    </label>
  );
}
