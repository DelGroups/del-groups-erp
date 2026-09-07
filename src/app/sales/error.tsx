"use client";

import React, { useEffect } from "react";
import Link from "next/link";

export default function SalesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/sales] Runtime error:", error.message, error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="app-card max-w-md space-y-4 p-6 text-center">
        <h1 className="text-base font-bold text-app">Satış səhifəsi yüklənmədi</h1>
        <p className="text-xs text-app-muted">
          {error.message || "Naməlum xəta baş verdi. Konsolda ətraflı məlumat var."}
        </p>
        {error.digest && (
          <p className="text-[10px] text-app-muted">Digest: {error.digest}</p>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" onClick={reset} className="btn-primary w-full justify-center">
            Yenidən cəhd et
          </button>
          <Link href="/" className="text-xs font-semibold text-app-accent hover:underline">
            Ana səhifəyə qayıt
          </Link>
        </div>
      </div>
    </div>
  );
}
