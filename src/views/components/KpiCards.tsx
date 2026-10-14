"use client";

import React from "react";
import { MetricCard } from "@/design-system/components";

export interface Kpi {
  key: string;
  label: string;
  /** Already formatted figure. */
  value: string;
  hint?: string;
  /** Recent periods for a sparkline (the last one is the current period). */
  series?: readonly number[];
  seriesLabel?: string;
  delta?: number | null;
  deltaLabel?: string;
  /** Search panel filters the card applies to the list when pressed. */
  filters?: readonly string[];
  /** Accessible name of the card when it filters ("Show overdue invoices"). */
  filterLabel?: string;
  tone?: "attention" | "good";
}

/**
 * Dashboard cards of a module (design-system metric cards): with a series a sparkline card,
 * otherwise a figure with a hint. Cards with filters are buttons that filter the list below.
 */
export function KpiCards({ kpis, onFilter, label }: { kpis: readonly Kpi[]; onFilter?: (filters: string[]) => void; label: string }) {
  if (!kpis.length) return null;
  return (
    <section aria-label={label} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => {
        const card = k.series?.length ? (
          <MetricCard label={k.label} value={k.value} delta={k.delta} deltaLabel={k.deltaLabel} series={k.series} seriesLabel={k.seriesLabel ?? k.label} />
        ) : (
          <div className="ds-card ds-card-pad flex h-full flex-col gap-3">
            <span className="ds-muted">{k.label}</span>
            <span
              className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono"
              style={k.tone === "attention" ? { color: "var(--ds-warning)" } : k.tone === "good" ? { color: "var(--ds-success)" } : undefined}
            >
              {k.value}
            </span>
            {k.hint ? <span className="mt-auto ds-subtle text-[length:var(--ds-text-xs)]">{k.hint}</span> : null}
          </div>
        );
        if (!k.filters || !onFilter) return <div key={k.key}>{card}</div>;
        return (
          <button
            key={k.key}
            type="button"
            onClick={() => onFilter([...k.filters!])}
            aria-label={k.filterLabel ?? k.label}
            className="rounded-[var(--ds-radius-xl)] text-left outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2"
          >
            {card}
          </button>
        );
      })}
    </section>
  );
}
