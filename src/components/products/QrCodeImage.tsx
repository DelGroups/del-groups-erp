"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeImageProps {
  value: string | null | undefined;
  size?: number;
  className?: string;
}

export default function QrCodeImage({ value, size = 88, className = "" }: QrCodeImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const code = (value || "").trim();

  useEffect(() => {
    if (!code) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(code, {
      width: size * 2,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, size]);

  if (!code) return <span className="text-xs text-app-muted">—</span>;
  if (!src) return <div className="bg-slate-100" style={{ width: size, height: size }} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={code}
      width={size}
      height={size}
      className={`bg-white ${className}`}
    />
  );
}
