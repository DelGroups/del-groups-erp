"use client";

import React, { useId, useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { COUNT_MEASURE, fieldLabel, fieldMap, formatNumber, isNumericField, pivotTable, type Formatter } from "../logic";
import type { ViewDefinition, ViewRecord } from "../types";
import { groupByLabel } from "./SearchPanel";

/** Measures a pivot or graph can show: the record count and every numeric field. */
export function measureOptions(def: ViewDefinition, fmt: Formatter): { value: string; label: string }[] {
  return [{ value: COUNT_MEASURE, label: fmt.t("views.count") }, ...def.fields.filter(isNumericField).map((f) => ({ value: f.name, label: fieldLabel(f, fmt) }))];
}

export function formatMeasure(def: ViewDefinition, measure: string, value: number, fmt: Formatter): string {
  if (measure === COUNT_MEASURE) return formatNumber(value, 0, fmt.locale);
  const f = fieldMap(def).get(measure);
  return formatNumber(value, f?.type === "integer" ? 0 : 2, fmt.locale);
}

export function Select({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <span className="flex items-center gap-2">
      <label htmlFor={id} className="ds-label">
        {label}
      </label>
      <select id={id} className="ds-input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Pivot: rows × columns (any Group by choice) of a measure, with row, column and grand totals. */
export function PivotView<R extends ViewRecord>({ definition: def, records, fmt }: { definition: ViewDefinition<R>; records: readonly R[]; fmt: Formatter }) {
  const pivot = def.pivot!;
  const groupBys = def.groupBys ?? [];
  const [rows, setRows] = useState(pivot.rows);
  const [cols, setCols] = useState<string>(pivot.cols ?? "");
  const [measure, setMeasure] = useState(pivot.measure);
  const table = useMemo(() => pivotTable(records, def, rows, cols || null, measure, fmt), [records, def, rows, cols, measure, fmt]);
  const axisOptions = groupBys.map((g) => ({ value: g, label: groupByLabel(def, g, fmt) }));
  const show = (n: number | null) => (n === null ? "" : formatMeasure(def, measure, n, fmt));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select label={fmt.t("views.pivot.rows")} value={rows} options={axisOptions} onChange={setRows} />
        <Select label={fmt.t("views.pivot.cols")} value={cols} options={[{ value: "", label: "—" }, ...axisOptions]} onChange={setCols} />
        <Select label={fmt.t("views.measure")} value={measure} options={measureOptions(def, fmt)} onChange={setMeasure} />
        <button
          type="button"
          className="ds-btn ds-btn-sm"
          disabled={!cols}
          onClick={() => {
            setRows(cols);
            setCols(rows);
          }}
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden />
          {fmt.t("views.pivot.flip")}
        </button>
      </div>
      <div className="ds-card overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">{`${groupByLabel(def, rows, fmt)}${cols ? ` × ${groupByLabel(def, cols, fmt)}` : ""}`}</caption>
          <thead>
            <tr style={{ background: "var(--ds-surface-sunken)" }}>
              <th scope="col" className="px-3 py-2 text-left ds-label">
                {groupByLabel(def, rows, fmt)}
              </th>
              {table.cols.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2 text-right ds-label">
                  {c.label}
                </th>
              ))}
              {cols ? (
                <th scope="col" className="px-3 py-2 text-right ds-label">
                  {fmt.t("views.total")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, ri) => (
              <tr key={r.key} style={{ borderTop: "1px solid var(--ds-border)" }}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium">
                  {r.label}
                </th>
                {table.cells[ri].map((v, ci) => (
                  <td key={table.cols[ci].key} className="px-3 py-1.5 text-right ds-mono">
                    {show(v)}
                  </td>
                ))}
                {cols ? <td className="px-3 py-1.5 text-right ds-mono font-semibold">{show(table.rowTotals[ri])}</td> : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--ds-border-strong)" }}>
              <th scope="row" className="px-3 py-2 text-left">
                {fmt.t("views.total")}
              </th>
              {table.colTotals.map((v, ci) => (
                <td key={table.cols[ci].key} className="px-3 py-2 text-right ds-mono font-semibold">
                  {show(v)}
                </td>
              ))}
              {cols ? <td className="px-3 py-2 text-right ds-mono font-semibold">{show(table.total)}</td> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
