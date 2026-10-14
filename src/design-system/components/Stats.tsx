"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { deltaKind, funnelRows, funnelSummary, goalProgress, heatCell, ringDash, sparklineHeights, type FunnelStep } from "../logic";
import { transitions } from "../motion";

// ── Metric cards with sparkline bars (stats/stats-metric-cards-with-sparkline-bars) ──

export interface MetricCardProps {
  label: string;
  /** Already formatted figure, e.g. "12 480 AZN". */
  value: string;
  /** Change in percent; sign picks the chip colour. */
  delta?: number | null;
  deltaLabel?: string;
  /** Eight or so recent periods; the last one is the current period. */
  series: readonly number[];
  /** Read to screen readers for the sparkline, e.g. "Last 8 weeks". */
  seriesLabel: string;
}

export function DeltaChip({ delta, label }: { delta: number; label?: string }) {
  const kind = deltaKind(delta);
  const Icon = kind === "up" ? ArrowUpRight : kind === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span className={`ds-chip ds-chip-${kind === "flat" ? "flat" : kind}`}>
      <Icon className="h-3 w-3" aria-hidden />
      <span className="ds-mono">
        {delta > 0 ? "+" : ""}
        {delta}%
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export function MetricCard({ label, value, delta, deltaLabel, series, seriesLabel }: MetricCardProps) {
  const heights = sparklineHeights(series);
  const reduced = useReducedMotion();
  return (
    <div className="ds-card ds-card-pad flex flex-col gap-3">
      <span className="ds-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono">{value}</span>
        {delta !== undefined && delta !== null ? <DeltaChip delta={delta} label={deltaLabel} /> : null}
      </div>
      <div className="flex h-10 items-end justify-between gap-1" role="img" aria-label={`${seriesLabel}: ${series.join(", ")}`}>
        {heights.map((h, i) => (
          <motion.span
            key={i}
            className="w-1.5 rounded-full"
            style={{ background: i === heights.length - 1 ? "var(--ds-text)" : "var(--ds-border-strong)", height: `${h}%`, transformOrigin: "bottom" }}
            initial={reduced ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ ...transitions.base, delay: reduced ? 0 : i * 0.015 }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Ring gauges (stats/stats-ring-gauge-trio) ──

export type GaugeTone = "good" | "attention" | "neutral";
const TONE: Record<GaugeTone, string> = { good: "var(--ds-success)", attention: "var(--ds-warning)", neutral: "var(--ds-text)" };

export interface RingGaugeProps {
  title: string;
  percent: number;
  caption: string;
  explanation?: string;
  footer?: React.ReactNode;
  tone?: GaugeTone;
}

export function RingGauge({ title, percent, caption, explanation, footer, tone = "neutral" }: RingGaugeProps) {
  const r = 42;
  const { circumference, offset, percent: p } = ringDash(percent, r);
  const reduced = useReducedMotion();
  return (
    <div className="ds-card ds-card-pad flex flex-col items-center gap-3 text-center">
      <span className="font-medium">{title}</span>
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={`${title}: ${Math.round(p)}%`}>
          <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" style={{ stroke: "var(--ds-track)" }} />
          <motion.circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ stroke: TONE[tone] }}
            strokeDasharray={circumference}
            initial={reduced ? false : { strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={transitions.slow}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center" aria-hidden>
          <span className="text-[length:var(--ds-text-xl)] font-medium ds-mono">{Math.round(p)}%</span>
          <span className="text-[length:var(--ds-text-xs)] ds-muted">{caption}</span>
        </div>
      </div>
      {explanation ? <p className="ds-muted">{explanation}</p> : null}
      {footer ? <div className="w-full border-t pt-2 text-[length:var(--ds-text-xs)] ds-muted ds-mono" style={{ borderColor: "var(--ds-border)" }}>{footer}</div> : null}
    </div>
  );
}

// ── Conversion funnel (stats/stats-conversion-funnel-steps) ──

export interface FunnelLabels {
  dropped: (count: string, percent: string) => string;
  entered: string;
  completed: string;
  conversion: string;
}

export function FunnelSteps({ title, subtitle, steps, labels, formatCount, action }: { title: string; subtitle?: string; steps: readonly FunnelStep[]; labels: FunnelLabels; formatCount: (n: number) => string; action?: React.ReactNode }) {
  const rows = funnelRows(steps);
  const sum = funnelSummary(steps);
  return (
    <div className="ds-card ds-card-pad flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {subtitle ? <p className="text-[length:var(--ds-text-xs)] ds-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <ol className="flex flex-col gap-1">
        {rows.map((row, i) => (
          <li key={row.label}>
            {i > 0 && row.dropped > 0 ? (
              <p className="py-0.5 pl-36 text-[length:var(--ds-text-xs)] ds-mono" style={{ color: "var(--ds-danger)" }}>
                {labels.dropped(formatCount(row.dropped), `${row.droppedPercent}%`)}
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <div className="flex w-32 shrink-0 flex-col">
                <span className="truncate">{row.label}</span>
                <span className="text-[length:var(--ds-text-xs)] ds-muted ds-mono">{formatCount(row.count)}</span>
              </div>
              <div className="ds-track relative h-7 flex-1" style={{ borderRadius: "var(--ds-radius-sm)" }}>
                <div className="flex h-full items-center justify-end px-2" style={{ width: `${row.percentOfFirst}%`, background: "var(--ds-text)", borderRadius: "var(--ds-radius-sm)" }}>
                  {row.labelInside ? <span className="text-[length:var(--ds-text-xs)] ds-mono" style={{ color: "var(--ds-surface)" }}>{row.percentOfFirst}%</span> : null}
                </div>
                {!row.labelInside ? (
                  <span className="absolute top-1/2 -translate-y-1/2 pl-2 text-[length:var(--ds-text-xs)] ds-mono" style={{ left: `${row.percentOfFirst}%` }}>
                    {row.percentOfFirst}%
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <dl className="grid grid-cols-3 divide-x border-t pt-3 text-center" style={{ borderColor: "var(--ds-border)" }}>
        {[
          [labels.entered, formatCount(sum.entered)],
          [labels.completed, formatCount(sum.completed)],
          [labels.conversion, `${sum.conversion}%`],
        ].map(([k, v]) => (
          <div key={k} className="px-2" style={{ borderColor: "var(--ds-border)" }}>
            <dt className="text-[length:var(--ds-text-xs)] ds-muted">{k}</dt>
            <dd className="font-semibold ds-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── Goal progress (stats/stats-goal-progress-bars) ──

export interface Goal {
  label: string;
  current: number;
  target: number;
}

export function GoalProgress({ title, note, goals, periodElapsed, formatValue, statusLabels }: { title: string; note?: string; goals: readonly Goal[]; periodElapsed: number; formatValue: (n: number) => string; statusLabels: Record<"done" | "onTrack" | "behind", string> }) {
  const reduced = useReducedMotion();
  return (
    <div className="ds-card ds-card-pad flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {note ? <span className="text-[length:var(--ds-text-xs)] ds-muted">{note}</span> : null}
      </div>
      <ul className="flex flex-col gap-4">
        {goals.map((g) => {
          const p = goalProgress(g.current, g.target, periodElapsed);
          const behind = p.status === "behind";
          return (
            <li key={g.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span>{g.label}</span>
                <span className="text-[length:var(--ds-text-xs)] ds-muted ds-mono">
                  {formatValue(g.current)} / {formatValue(g.target)}
                </span>
              </div>
              <div className="ds-track h-2" role="progressbar" aria-label={g.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.bar)}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: behind ? "var(--ds-warning)" : "var(--ds-text)" }}
                  initial={reduced ? false : { width: 0 }}
                  animate={{ width: `${p.bar}%` }}
                  transition={transitions.slow}
                />
              </div>
              <span className="text-[length:var(--ds-text-xs)]" style={{ color: behind ? "var(--ds-warning)" : "var(--ds-text-muted)" }}>
                {statusLabels[p.status]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Cohort retention heatmap (stats/stats-cohort-retention-heatmap) ──

export interface Cohort {
  label: string;
  users: number;
  /** Retention per week in percent; missing weeks are in the future. */
  retention: readonly number[];
}

export function CohortHeatmap({
  title,
  subtitle,
  cohorts,
  weeks,
  labels,
  footnote,
}: {
  title: string;
  subtitle?: string;
  cohorts: readonly Cohort[];
  weeks: number;
  labels: { cohort: string; users: string; week: (n: number) => string; low: string; high: string; cellTitle: (percent: number, users: number) => string };
  footnote?: string;
}) {
  return (
    <div className="ds-card ds-card-pad flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {subtitle ? <p className="text-[length:var(--ds-text-xs)] ds-muted">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-1.5 text-[length:var(--ds-text-xs)] ds-muted" aria-hidden>
          {labels.low}
          {[0.12, 0.3, 0.5, 0.7, 0.92].map((a) => (
            <span key={a} className="h-3 w-3 rounded-[3px]" style={{ background: `rgb(var(--ds-heat) / ${a})` }} />
          ))}
          {labels.high}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate text-[length:var(--ds-text-xs)]" style={{ borderSpacing: 3 }}>
          <thead>
            <tr className="ds-muted">
              <th scope="col" className="px-2 py-1 text-left font-medium">{labels.cohort}</th>
              <th scope="col" className="px-2 py-1 text-right font-medium">{labels.users}</th>
              {Array.from({ length: weeks }, (_, w) => (
                <th key={w} scope="col" className="px-2 py-1 text-center font-medium">{labels.week(w)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.label}>
                <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-medium">{c.label}</th>
                <td className="px-2 py-1 text-right ds-mono">{c.users}</td>
                {Array.from({ length: weeks }, (_, w) => {
                  const pct = w < c.retention.length ? c.retention[w] : null;
                  const cell = heatCell(pct);
                  return cell.empty ? (
                    <td key={w} className="h-8 min-w-12" style={{ border: "1px dashed var(--ds-border)", borderRadius: 4 }} />
                  ) : (
                    <td
                      key={w}
                      className="h-8 min-w-12 text-center ds-mono"
                      title={labels.cellTitle(pct as number, Math.round((c.users * (pct as number)) / 100))}
                      style={{ background: `rgb(var(--ds-heat) / ${cell.alpha})`, color: cell.darkText ? "var(--ds-text)" : "#fff", borderRadius: 4 }}
                    >
                      {Math.round(pct as number)}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footnote ? <p className="text-[length:var(--ds-text-xs)] ds-subtle">{footnote}</p> : null}
    </div>
  );
}
