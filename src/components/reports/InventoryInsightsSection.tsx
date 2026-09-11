"use client";

import React from "react";
import { AlertTriangle, Archive, Package } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { MaterialUsageRow } from "@/types/database.types";

interface InventoryInsightsSectionProps {
  topMaterials: MaterialUsageRow[];
  deficitAlerts: MaterialUsageRow[];
  deadstock: MaterialUsageRow[];
}

export default function InventoryInsightsSection({
  topMaterials,
  deficitAlerts,
  deadstock,
}: InventoryInsightsSectionProps) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="app-card app-card-elevated p-5">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-app">
            <Package className="h-4 w-4 text-app-accent" />
            {t("reports.executive.topMaterialsTitle")}
          </h3>
          <p className="text-[11px] text-app-muted">{t("reports.executive.topMaterialsSubtitle")}</p>
        </div>
        {topMaterials.length === 0 ? (
          <p className="py-6 text-center text-xs text-app-muted">{t("reports.executive.noMaterials")}</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="font-bold uppercase text-app-muted">
              <tr>
                <th className="pb-2">{t("common.code")}</th>
                <th className="pb-2">{t("reports.executive.productName")}</th>
                <th className="pb-2 text-right">{t("reports.executive.usageQty")}</th>
                <th className="pb-2 text-right">{t("reports.executive.stock")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app">
              {topMaterials.map((row) => (
                <tr key={row.productId}>
                  <td className="py-2 font-mono font-bold">{row.code}</td>
                  <td className="py-2">{row.name}</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {row.totalUsed.toFixed(2)} {row.unit}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{row.stock.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="app-card app-card-elevated p-5">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-app">
            <Archive className="h-4 w-4 text-sky-500" />
            {t("reports.executive.deadstockTitle")}
          </h3>
          <p className="text-[11px] text-app-muted">{t("reports.executive.deadstockSubtitle")}</p>
        </div>
        {deadstock.length === 0 ? (
          <p className="py-6 text-center text-xs text-emerald-600">{t("reports.executive.noDeadstock")}</p>
        ) : (
          <div className="space-y-2">
            {deadstock.map((row) => (
              <div
                key={row.productId}
                className="flex items-center justify-between rounded-lg border border-sky-200 bg-sky-500/10 px-3 py-2.5"
              >
                <div>
                  <p className="font-mono text-[11px] font-bold text-sky-800">{row.code}</p>
                  <p className="text-sm font-semibold text-app">{row.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-app">
                    {row.stock.toFixed(2)} {row.unit}
                  </p>
                  <p className="text-[10px] text-app-muted">
                    {t("reports.executive.daysIdle")}: {row.daysIdle ?? 90}+
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="app-card app-card-elevated p-5">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-app">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t("reports.executive.deficitTitle")}
          </h3>
          <p className="text-[11px] text-app-muted">{t("reports.executive.deficitSubtitle")}</p>
        </div>
        {deficitAlerts.length === 0 ? (
          <p className="py-6 text-center text-xs text-emerald-600">{t("reports.executive.noDeficits")}</p>
        ) : (
          <div className="space-y-2">
            {deficitAlerts.map((row) => (
              <div
                key={row.productId}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-500/10 px-3 py-2.5"
              >
                <div>
                  <p className="font-mono text-[11px] font-bold text-amber-800">{row.code}</p>
                  <p className="text-sm font-semibold text-app">{row.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-rose-600">
                    {row.stock.toFixed(2)} / {row.minStock.toFixed(2)} {row.unit}
                  </p>
                  <p className="text-[10px] text-app-muted">{t("reports.executive.belowMin")}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
