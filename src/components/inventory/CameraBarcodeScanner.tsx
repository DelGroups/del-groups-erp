"use client";

import React, { useEffect, useId, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface CameraBarcodeScannerProps {
  open: boolean;
  onDetected: (code: string) => void;
  onClose: () => void;
}

export default function CameraBarcodeScanner({
  open,
  onDetected,
  onClose,
}: CameraBarcodeScannerProps) {
  const { t } = useI18n();
  const regionId = `inventory-camera-scanner-${useId().replace(/:/g, "")}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const detectedRef = useRef(onDetected);

  useEffect(() => {
    detectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;
    const scanner = new Html5Qrcode(regionId);
    scannerRef.current = scanner;

    void scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          const code = decoded.trim();
          if (!code) return;
          void scanner.stop().catch(() => undefined);
          detectedRef.current(code);
        },
        () => undefined
      )
      .catch(() => undefined);

    return () => {
      void scanner.stop().catch(() => undefined);
      scanner.clear().catch(() => undefined);
      scannerRef.current = null;
    };
  }, [open, regionId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl app-card shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <h3 className="text-sm font-bold text-app">{t("inventory.scan.cameraTitle")}</h3>
          <button type="button" onClick={onClose} className="text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <div id={regionId} className="overflow-hidden rounded-xl bg-black" />
          <p className="mt-3 text-center text-xs text-app-muted">{t("inventory.scan.cameraHint")}</p>
        </div>
      </div>
    </div>
  );
}
