"use client";

import React from "react";
import type { ToastVariant } from "@/hooks/useToast";

interface ToastMessageProps {
  message: string | null;
  variant?: ToastVariant;
}

export default function ToastMessage({ message, variant = "error" }: ToastMessageProps) {
  if (!message) return null;

  const tone =
    variant === "success"
      ? "bg-emerald-600"
      : "bg-rose-600";

  return (
    <div
      role="alert"
      className={`fixed bottom-4 right-4 z-[100] rounded-xl px-4 py-3 text-xs font-semibold text-white shadow-lg ${tone}`}
    >
      {message}
    </div>
  );
}
