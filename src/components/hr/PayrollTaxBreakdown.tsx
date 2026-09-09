"use client";

import React from "react";
import type { AzPayrollBreakdown } from "@/lib/tax/azPayroll";
import { useI18n } from "@/i18n/I18nProvider";

interface PayrollTaxBreakdownProps {
  breakdown: AzPayrollBreakdown;
  advancesDeducted?: number;
  otherDeductions?: number;
  compact?: boolean;
}

export default function PayrollTaxBreakdown({
  breakdown,
  advancesDeducted = 0,
  otherDeductions = 0,
  compact = false,
}: PayrollTaxBreakdownProps) {
  const { t } = useI18n();
  const currency = t("common.currency");

  const rows = [
    { label: t("tax.grossSalary"), value: breakdown.grossSalary, tone: "neutral" as const },
    { label: t("tax.dsmfEmployee"), value: -breakdown.dsmfEmployee, tone: "danger" as const },
    { label: t("tax.itsEmployee"), value: -breakdown.itsEmployee, tone: "danger" as const },
    { label: t("tax.incomeTax"), value: -breakdown.incomeTax, tone: "danger" as const },
    ...(advancesDeducted > 0
      ? [{ label: t("employees.advance.deducted"), value: -advancesDeducted, tone: "danger" as const }]
      : []),
    ...(otherDeductions > 0
      ? [{ label: t("employees.deduction"), value: -otherDeductions, tone: "danger" as const }]
      : []),
    { label: t("tax.netSalary"), value: breakdown.netSalary, tone: "success" as const },
  ];

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
        {rows.map((row) => (
          <div key={row.label} className="rounded-xl border border-app bg-app-card-hover p-3">
            <p className="text-[10px] font-bold uppercase text-app-muted">{row.label}</p>
            <p
              className={`font-mono text-sm font-bold ${
                row.tone === "danger"
                  ? "text-rose-600"
                  : row.tone === "success"
                    ? "text-emerald-600"
                    : "text-app"
              }`}
            >
              {row.value.toFixed(2)} {currency}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-app-muted">
        {t("tax.employerNote", {
          dsmf: breakdown.dsmfEmployer.toFixed(2),
          its: breakdown.itsEmployer.toFixed(2),
          total: breakdown.employerCost.toFixed(2),
        })}
      </p>
    </div>
  );
}
