"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { OfficialVatBreakdown } from "@/lib/finance/vatEngine";

interface OfficialTotalsBreakdownProps {
  amounts: OfficialVatBreakdown;
  isOfficial: boolean;
  className?: string;
  dark?: boolean;
}

export default function OfficialTotalsBreakdown({
  amounts,
  isOfficial,
  className = "",
  dark = false,
}: OfficialTotalsBreakdownProps) {
  const { t } = useI18n();

  if (!isOfficial) return null;

  const labelClass = dark ? "text-slate-300" : "text-app-muted";
  const valueClass = dark ? "font-mono text-white" : "font-mono text-app";
  const vatClass = dark ? "font-mono text-amber-300" : "font-mono text-amber-600";
  const grandClass = dark
    ? "font-mono text-lg text-emerald-400"
    : "font-mono text-lg font-bold text-emerald-600";

  return (
    <div className={`space-y-1.5 text-xs ${className}`}>
      <div className={`flex justify-between ${labelClass}`}>
        <span>{t("official.subtotalBase")}</span>
        <span className={valueClass}>{amounts.subtotal_amount.toFixed(2)}</span>
      </div>
      <div className={`flex justify-between ${labelClass}`}>
        <span>{t("official.vatAmount", { rate: amounts.vat_rate })}</span>
        <span className={vatClass}>{amounts.vat_amount.toFixed(2)}</span>
      </div>
      <div className={`flex items-center justify-between border-t pt-2 ${dark ? "border-white/20" : "border-app"}`}>
        <span className={dark ? "text-sm font-bold text-white" : "text-sm font-bold text-app"}>
          {t("official.grandTotal")}
        </span>
        <span className={grandClass}>{amounts.grand_total.toFixed(2)}</span>
      </div>
    </div>
  );
}
