"use client";

import React from "react";
import Link from "next/link";
import { Factory } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { ProjectProfitabilityRow } from "@/types/database.types";

interface ProjectProfitabilitySectionProps {
  rows: ProjectProfitabilityRow[];
}

function marginBarColor(margin: number): string {
  if (margin < 0) return "bg-rose-500";
  if (margin < 15) return "bg-amber-500";
  return "bg-emerald-500";
}

export default function ProjectProfitabilitySection({ rows }: ProjectProfitabilitySectionProps) {
  const { t } = useI18n();

  return (
    <div className="app-card app-card-elevated p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-app">
            <Factory className="h-4 w-4 text-app-accent" />
            {t("reports.executive.profitabilityTitle")}
          </h3>
          <p className="text-[11px] text-app-muted">{t("reports.executive.profitabilitySubtitle")}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-app-muted">{t("reports.executive.noProjects")}</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 12).map((row) => {
            const clampedMargin = Math.max(-100, Math.min(100, row.marginPercent));
            const barWidth = Math.abs(clampedMargin);

            return (
              <div
                key={row.orderId}
                className="rounded-xl border border-app bg-app-card-hover p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/production/${row.orderId}`}
                      className="font-mono text-xs font-bold text-app-accent hover:underline"
                    >
                      {row.orderNo}
                    </Link>
                    <p className="mt-0.5 text-sm font-semibold text-app">{row.customerName}</p>
                    <p className="text-[10px] text-app-muted">{row.status}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase text-app-muted">
                      {t("reports.executive.grossMargin")}
                    </p>
                    <p
                      className={`font-mono text-lg font-bold ${
                        row.marginPercent < 0 ? "text-rose-600" : "text-emerald-600"
                      }`}
                    >
                      {row.marginPercent.toFixed(1)}%
                    </p>
                    <p className="font-mono text-xs text-app-muted">
                      {row.grossProfit.toFixed(2)} {t("common.currency")}
                    </p>
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-app-card">
                  <div
                    className={`h-full rounded-full transition-all ${marginBarColor(row.marginPercent)}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] md:grid-cols-4">
                  <CostCell label={t("reports.executive.netRevenue")} value={row.netRevenue} />
                  <CostCell label={t("reports.executive.rawMaterial")} value={row.rawMaterialCost} negative />
                  <CostCell label={t("reports.executive.labor")} value={row.laborCost} negative />
                  <CostCell label={t("reports.executive.generalExpenses")} value={row.generalExpenses} negative />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CostCell({
  label,
  value,
  negative,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div>
      <p className="font-bold uppercase text-app-muted">{label}</p>
      <p className={`font-mono font-semibold ${negative ? "text-rose-600" : "text-app"}`}>
        {negative ? "−" : ""}
        {value.toFixed(2)}
      </p>
    </div>
  );
}
