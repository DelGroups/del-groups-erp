"use client";

import React from "react";

export default function LoginError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="app-card max-w-md space-y-4 p-6 text-center">
        <h1 className="text-base font-bold text-app">Səhifə yüklənmədi</h1>
        <p className="text-xs text-app-muted">{error.message || "Naməlum xəta"}</p>
        {error.digest && (
          <p className="text-[10px] text-app-muted">Digest: {error.digest}</p>
        )}
        <button type="button" onClick={reset} className="btn-primary w-full justify-center">
          Yenidən cəhd et
        </button>
      </div>
    </div>
  );
}
