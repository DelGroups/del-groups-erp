"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { OfficialVatBreakdown } from "@/lib/finance/vatEngine";

interface OfficialPaymentSplitBannerProps {
  amounts: OfficialVatBreakdown;
  isOfficial: boolean;
  className?: string;
}

export default function OfficialPaymentSplitBanner({
  amounts,
  isOfficial,
  className = "",
}: OfficialPaymentSplitBannerProps) {
  const { t } = useI18n();

  if (!isOfficial || amounts.vat_amount <= 0) return null;

  const baseAmount = Math.max(0, amounts.grand_total - amounts.vat_amount);

  return (
    <div
      className={`rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] font-semibold text-app ${className}`}
    >
      {t("official.paymentSplitBanner", {
        base: baseAmount.toFixed(2),
        vat: amounts.vat_amount.toFixed(2),
      })}
    </div>
  );
}
