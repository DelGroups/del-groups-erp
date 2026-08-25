"use client";

import React from "react";

interface ToastMessageProps {
  message: string | null;
}

export default function ToastMessage({ message }: ToastMessageProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[100] rounded-xl bg-rose-600 px-4 py-3 text-xs font-semibold text-white shadow-lg"
    >
      {message}
    </div>
  );
}
