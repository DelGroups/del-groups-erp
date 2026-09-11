"use client";

import React from "react";
import type { InvoiceDebtBreakdown } from "@/lib/finance/invoiceRemainingBalance";

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

  return (
    <div className="min-w-[9rem]" title={tooltip}>
      <p className="text-[10px] leading-tight text-app-muted">{splitLabel}</p>
      <p className={`${totalClass} text-right leading-tight`}>
        {totalRemainingLabel}: {breakdown.totalRemaining.toFixed(2)} {currencyLabel}
      </p>
    </div>
  );
}
