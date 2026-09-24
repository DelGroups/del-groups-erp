"use client";

import React from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { useI18n } from "@/i18n/I18nProvider";
import type { InventoryCountStatus } from "@/lib/inventoryCount/types";

const VARIANT: Record<InventoryCountStatus, BadgeVariant> = {
  draft: "neutral",
  in_progress: "info",
  review: "warning",
  posted: "success",
};

export function InventoryCountStatusBadge({ status }: { status: InventoryCountStatus }) {
  const { t } = useI18n();
  return <Badge variant={VARIANT[status]}>{t(`inventoryCount.status_${status}`)}</Badge>;
}

/** Signed AZN amount, green for surplus and red for shortage. */
export function VarianceAmount({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className="text-app-muted">—</span>;
  const tone = value > 0.004 ? "text-emerald-600" : value < -0.004 ? "text-rose-600" : "text-app-muted";
  return (
    <span className={`font-mono tabular-nums ${tone} ${className ?? ""}`}>
      {value > 0.004 ? "+" : ""}
      {value.toFixed(2)}
    </span>
  );
}
