"use client";

import { useEffect, useRef } from "react";

interface BarcodeScannerOptions {
  enabled?: boolean;
  minLength?: number;
  maxKeyDelayMs?: number;
}

/**
 * Captures keyboard-wedge scanners globally. Normal human typing in form
 * controls is ignored unless it arrives at scanner speed and ends with Enter.
 */
export function useBarcodeScanner(
  onScan: (barcode: string) => void,
  options: BarcodeScannerOptions = {}
) {
  const callbackRef = useRef(onScan);
  const bufferRef = useRef("");
  const lastKeyAtRef = useRef(0);
  const startedInEditableRef = useRef(false);

  useEffect(() => {
    callbackRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (options.enabled === false) return;
    const minLength = options.minLength ?? 3;
    const maxDelay = options.maxKeyDelayMs ?? 70;

    const reset = () => {
      bufferRef.current = "";
      lastKeyAtRef.current = 0;
      startedInEditableRef.current = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const editable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      const now = performance.now();

      if (event.key === "Enter") {
        const barcode = bufferRef.current.trim();
        const scannerSpeed = now - lastKeyAtRef.current <= maxDelay * 2;
        if (barcode.length >= minLength && scannerSpeed) {
          if (!startedInEditableRef.current) event.preventDefault();
          callbackRef.current(barcode);
        }
        reset();
        return;
      }

      if (event.key.length !== 1) return;
      if (lastKeyAtRef.current && now - lastKeyAtRef.current > maxDelay) reset();
      if (!bufferRef.current) startedInEditableRef.current = Boolean(editable);
      bufferRef.current += event.key;
      lastKeyAtRef.current = now;
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [options.enabled, options.maxKeyDelayMs, options.minLength]);
}
