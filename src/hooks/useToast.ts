"use client";

import { useCallback, useRef, useState } from "react";

export function useToast(durationMs = 3000) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const showError = useCallback(
    (text: string) => {
      setMessage(text);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs]
  );

  const clear = useCallback(() => {
    setMessage(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return { message, showError, clear };
}
