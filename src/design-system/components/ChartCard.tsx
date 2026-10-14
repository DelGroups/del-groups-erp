"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { scaleStacked, type StackedColumn } from "../logic";
import { transitions } from "../motion";
import { DeltaChip } from "./Stats";

export interface ChartRange<R extends string> {
  id: R;
  label: string;
}

export interface ChartCardProps<R extends string> {
  title: string;
  /** Formatted total of the shown range. */
  total: string;
  delta?: number | null;
  ranges: readonly ChartRange<R>[];
  range: R;
  onRangeChange: (range: R) => void;
  /** Two series per column (e.g. new and returning). */
  columns: readonly StackedColumn[];
  series: readonly [string, string];
  formatValue: (n: number) => string;
  /** Label of the range picker for screen readers. */
  rangeLabel: string;
}

const COLORS = ["var(--ds-chart-1)", "var(--ds-chart-2)"] as const;

/**
 * Chart card with legend (dashboards/dashboards-chart-card-with-legend): stacked bars scaled
 * to the tallest column, x labels, legend, and a 7d / 30d / 90d picker built as a radio group
 * (arrow keys move between options). Each column has a tooltip with its exact figures.
 */
export function ChartCard<R extends string>({ title, total, delta, ranges, range, onRangeChange, columns, series, formatValue, rangeLabel }: ChartCardProps<R>) {
  const scaled = scaleStacked(columns);
  const reduced = useReducedMotion();
  const move = (dir: 1 | -1) => {
    const i = ranges.findIndex((r) => r.id === range);
    onRangeChange(ranges[(i + dir + ranges.length) % ranges.length].id);
  };

  return (
    <div className="ds-card ds-card-pad flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-0.5 flex items-center gap-2">
            <span className="text-[length:var(--ds-text-xl)] font-semibold ds-mono">{total}</span>
            {delta !== undefined && delta !== null ? <DeltaChip delta={delta} /> : null}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label={rangeLabel}
          className="inline-flex gap-0.5 p-0.5"
          style={{ background: "var(--ds-surface-sunken)", borderRadius: "var(--ds-radius-md)" }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {ranges.map((r) => {
            const active = r.id === range;
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => onRangeChange(r.id)}
                className="ds-btn ds-btn-sm"
                style={active ? { background: "var(--ds-surface)", boxShadow: "var(--ds-elevation-1)" } : { background: "transparent", borderColor: "transparent" }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex h-44 items-end gap-2" role="img" aria-label={`${title}: ${scaled.map((c) => `${c.label} ${formatValue(c.total)}`).join(", ")}`}>
        {scaled.map((c, i) => (
          <div key={c.label} className="flex h-full flex-1 flex-col justify-end" title={`${c.label}: ${columns[i].values.map((v, s) => `${series[s]} ${formatValue(v)}`).join(", ")}`}>
            <div className="flex flex-col-reverse overflow-hidden" style={{ borderRadius: "var(--ds-radius-sm)" }}>
              {c.heights.map((h, s) => (
                <motion.div
                  key={s}
                  style={{ background: COLORS[s % COLORS.length] }}
                  initial={reduced ? false : { height: 0 }}
                  animate={{ height: `calc(11rem * ${h / 100})` }}
                  transition={transitions.base}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 text-[length:var(--ds-text-xs)] ds-muted" aria-hidden>
        {scaled.map((c) => (
          <span key={c.label} className="flex-1 truncate text-center">
            {c.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-[length:var(--ds-text-xs)]">
        {series.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i] }} aria-hidden />
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
