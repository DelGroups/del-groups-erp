"use client";

import { useCallback, useEffect, useState } from "react";
import { parseLimitStatus, type TenantLimitStatus } from "@/lib/limits/limits";

/** Limits of the current tenant from /api/limits; null until loaded or when unavailable. */
export function useLimitStatus(enabled = true): { status: TenantLimitStatus | null; reload: () => void } {
  const [status, setStatus] = useState<TenantLimitStatus | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/limits", { credentials: "same-origin" })
      .then(async (response) => (response.ok ? parseLimitStatus(await response.json()) : null))
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  return { status, reload };
}
