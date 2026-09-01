"use client";

import { useCallback, useRef, useState } from "react";

export type ToastVariant = "error" | "success";

export function useToast(durationMs = 3000) {
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null);
  const timerRef = useRef<number | null>(null);

  const show = useCallback(
    (text: string, variant: ToastVariant) => {
      setToast({ message: text, variant });
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setToast(null), durationMs);
    },
    [durationMs]
  );

  const showError = useCallback((text: string) => show(text, "error"), [show]);
  const showSuccess = useCallback((text: string) => show(text, "success"), [show]);

  const clear = useCallback(() => {
    setToast(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return {
    message: toast?.message ?? null,
    variant: toast?.variant ?? "error",
    showError,
    showSuccess,
    clear,
  };
}
