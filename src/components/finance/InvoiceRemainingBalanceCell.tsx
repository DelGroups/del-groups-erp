"use client";

import React from "react";
import type { InvoiceDebtBreakdown } from "@/lib/finance/invoiceRemainingBalance";
import { useUiStandard } from "@/design-system/components";

interface InvoiceRemainingBalanceCellProps {
  breakdown: InvoiceDebtBreakdown;
  currencyLabel: string;
  splitLabel: string;
  totalRemainingLabel: string;
}

export default function InvoiceRemainingBalanceCell({
  breakdown,
  currencyLabel,
  splitLabel,
  totalRemainingLabel,
}: InvoiceRemainingBalanceCellProps) {
  const standard = useUiStandard();
  const totalClass =
    breakdown.totalRemaining > 0
      ? "font-mono font-bold tabular-nums text-rose-600"
      : "font-mono font-bold tabular-nums text-app-muted";

  if (!breakdown.showSplit) {
    return (
      <span className={`${totalClass} text-right`}>
        {breakdown.totalRemaining.toFixed(2)} {currencyLabel}
      </span>
    );
  }

  const tooltip = splitLabel;

  // UI_STANDARD (UI-2): list rows are one line; the split moves into the tooltip.
  if (standard) {
    return (
      <span className={`${totalClass} text-right`} title={tooltip}>
        {breakdown.totalRemaining.toFixed(2)} {currencyLabel}
      </span>
    );
  }

  return (
    <div className="min-w-[9rem]" title={tooltip}>
      <p className="text-[10px] leading-tight text-app-muted">{splitLabel}</p>
      <p className={`${totalClass} text-right leading-tight`}>
        {totalRemainingLabel}: {breakdown.totalRemaining.toFixed(2)} {currencyLabel}
      </p>
    </div>
  );
}
