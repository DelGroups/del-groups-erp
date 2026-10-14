"use client";

import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import { transitions } from "@/design-system/motion";
import { graphSeries, type Formatter, type GraphPoint } from "../logic";
import type { GraphViewDef, ViewDefinition, ViewRecord } from "../types";
import { groupByLabel } from "./SearchPanel";
import { formatMeasure, measureOptions, Select } from "./PivotView";

const color = (p: GraphPoint, i: number) => p.color ?? `color-mix(in oklab, var(--ds-chart-1) ${Math.max(25, 100 - i * 15)}%, var(--ds-chart-2))`;

/**
 * Graph: bar, line or pie of a measure per group. Drawn with plain HTML/SVG on the design
 * tokens; every chart has the same figures as a table for screen readers.
 */
export function GraphView<R extends ViewRecord>({ definition: def, records, fmt }: { definition: ViewDefinition<R>; records: readonly R[]; fmt: Formatter }) {
  const graph = def.graph!;
  const [groupBy, setGroupBy] = useState(graph.groupBy);
  const [measure, setMeasure] = useState(graph.measure);
  const [type, setType] = useState<GraphViewDef["type"]>(graph.type);
  const points = useMemo(() => graphSeries(records, def, groupBy, measure, fmt), [records, def, groupBy, measure, fmt]);
  const show = (n: number) => formatMeasure(def, measure, n, fmt);
  const max = Math.max(0, ...points.map((p) => p.value));
  const total = points.reduce((s, p) => s + Math.max(0, p.value), 0);
  const title = `${measureOptions(def, fmt).find((m) => m.value === measure)?.label} · ${groupByLabel(def, groupBy, fmt)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select label={fmt.t("views.groupBy")} value={groupBy} options={(def.groupBys ?? []).map((g) => ({ value: g, label: groupByLabel(def, g, fmt) }))} onChange={setGroupBy} />
        <Select label={fmt.t("views.measure")} value={measure} options={measureOptions(def, fmt)} onChange={setMeasure} />
        <Select label={fmt.t("views.graph.type")} value={type} options={(["bar", "line", "pie"] as const).map((v) => ({ value: v, label: fmt.t(`views.graph.${v}`) }))} onChange={(v) => setType(v as GraphViewDef["type"])} />
      </div>
      <figure className="ds-card ds-card-pad">
        <figcaption className="mb-4 font-semibold">{title}</figcaption>
        <div aria-hidden>
          {type === "bar" ? (
            <ul className="flex flex-col gap-2">
              {points.map((p, i) => (
                <li key={p.key} className="grid grid-cols-[minmax(6rem,12rem)_1fr_auto] items-center gap-3">
                  <span className="truncate">{p.label}</span>
                  <span className="h-6 overflow-hidden rounded-[var(--ds-radius-sm)]" style={{ background: "var(--ds-track)" }}>
                    <motion.span className="block h-full" style={{ background: color(p, i) }} initial={{ width: 0 }} animate={{ width: `${max > 0 ? (Math.max(0, p.value) / max) * 100 : 0}%` }} transition={transitions.slow} />
                  </span>
                  <span className="ds-mono">{show(p.value)}</span>
                </li>
              ))}
            </ul>
          ) : type === "line" ? (
            <LineChart points={points} max={max} />
          ) : (
            <PieChart points={points} total={total} show={show} />
          )}
        </div>
        <table className="sr-only">
          <caption>{title}</caption>
          <tbody>
            {points.map((p) => (
              <tr key={p.key}>
                <th scope="row">{p.label}</th>
                <td>{show(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </div>
  );
}

function LineChart({ points, max }: { points: GraphPoint[]; max: number }) {
  const w = 600;
  const h = 220;
  const pad = 24;
  const x = (i: number) => (points.length <= 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (points.length - 1));
  const y = (v: number) => h - pad - (max > 0 ? (Math.max(0, v) / max) * (h - 2 * pad) : 0);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full" preserveAspectRatio="none">
        <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} style={{ stroke: "var(--ds-border)" }} />
        <motion.path d={d} fill="none" style={{ stroke: "var(--ds-chart-1)", strokeWidth: 2.5 }} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={transitions.slow} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle key={p.key} cx={x(i)} cy={y(p.value)} r={4} style={{ fill: "var(--ds-chart-1)" }} />
        ))}
      </svg>
      <div className="mt-1 flex justify-between gap-2 text-[length:var(--ds-text-xs)] ds-muted">
        {points.map((p) => (
          <span key={p.key} className="truncate">
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function PieChart({ points, total, show }: { points: GraphPoint[]; total: number; show: (n: number) => string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const lengths = points.map((p) => (total > 0 ? (Math.max(0, p.value) / total) * c : 0));
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 200 200" className="h-48 w-48 -rotate-90">
        <circle cx={100} cy={100} r={r} fill="none" style={{ stroke: "var(--ds-track)", strokeWidth: 36 }} />
        {points.map((p, i) => (
            <motion.circle
              key={p.key}
              cx={100}
              cy={100}
              r={r}
              fill="none"
              style={{ stroke: color(p, i), strokeWidth: 36 }}
              strokeDasharray={`${lengths[i]} ${c - lengths[i]}`}
              strokeDashoffset={-offsets[i]}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={transitions.base}
            />
        ))}
      </svg>
      <ul className="flex flex-col gap-1.5">
        {points.map((p, i) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="ds-dot" style={{ background: color(p, i) }} />
            <span>{p.label}</span>
            <span className="ds-mono ds-muted">{show(p.value)}</span>
            <span className="ds-mono ds-subtle">{total > 0 ? `${Math.round((Math.max(0, p.value) / total) * 100)} %` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
