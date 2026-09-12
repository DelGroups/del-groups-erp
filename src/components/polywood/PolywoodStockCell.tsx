"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatPieceBreakdown } from "@/lib/polywood/smartCut";
import type { PolywoodInventorySummary } from "@/lib/polywood/types";
import { useI18n } from "@/i18n/I18nProvider";

interface PolywoodStockCellProps {
  stock: number;
  unit: string;
  summary?: PolywoodInventorySummary | null;
}

export default function PolywoodStockCell({ stock, unit, summary }: PolywoodStockCellProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!summary) {
    return (
      <span className="font-mono tabular-nums">
        {stock} {unit}
      </span>
    );
  }

  const breakdown = formatPieceBreakdown(
    summary.full_sheet_count,
    summary.full_sheet_length_m,
    summary.cut_pieces
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end gap-1.5">
        <span className="font-mono font-bold tabular-nums text-app">
          {summary.total_length_m.toFixed(2)} m
        </span>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
          title={t("polywood.viewPieces")}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t("polywood.viewPieces")}
        </button>
      </div>
      {open ? (
        <p className="text-right text-[10px] leading-relaxed text-app-muted">{breakdown}</p>
      ) : null}
    </div>
  );
}
