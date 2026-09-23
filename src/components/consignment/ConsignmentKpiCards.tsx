"use client";

import React from "react";
import { Boxes, Landmark, RotateCcw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface ConsignmentKpiCardsProps {
  totalStockValue: number;
  soldThisMonth: number;
  pendingReturnsCount: number;
  pendingReturnsValue: number;
}

export default function ConsignmentKpiCards({
  totalStockValue,
  soldThisMonth,
  pendingReturnsCount,
  pendingReturnsValue,
}: ConsignmentKpiCardsProps) {
  const { t } = useI18n();
  const currency = t("common.currency");

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="flex items-start gap-3 rounded-xl border border-app bg-app-surface p-4">
        <span className="rounded-lg bg-app-accent/10 p-2 text-app-accent">
          <Boxes className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs text-app-muted">{t("consignments.kpiStockValue")}</p>
          <p className="mt-1 text-lg font-bold">
            {totalStockValue.toFixed(2)} {currency}
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-app bg-app-surface p-4">
        <span className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600">
          <Landmark className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs text-app-muted">{t("consignments.kpiSoldThisMonth")}</p>
          <p className="mt-1 text-lg font-bold">
            {soldThisMonth.toFixed(2)} {currency}
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-app bg-app-surface p-4">
        <span className="rounded-lg bg-amber-500/10 p-2 text-amber-600">
          <RotateCcw className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs text-app-muted">{t("consignments.kpiPendingReturns")}</p>
          <p className="mt-1 text-lg font-bold">
            {pendingReturnsCount} · {pendingReturnsValue.toFixed(2)} {currency}
          </p>
        </div>
      </div>
    </div>
  );
}
