"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { DataGrid, useUiStandard, type GridColumn, type GridItem } from "@/design-system/components";
import type { GridDensity } from "@/design-system/grid";
import { dataGridLabels } from "@/i18n/uiStandardLabels";
import { displayValue, fieldMap, flattenGroups, formatNumber, gridColumnType, groupRecords, isNumericField, listFieldLabel, nextSort, optionLabel, sumBy, type Formatter, type RecordGroup } from "../logic";
import type { FieldDef, SortSpec, ViewDefinition, ViewRecord } from "../types";

export interface ListViewProps<R extends ViewRecord> {
  definition: ViewDefinition<R>;
  /** Already searched, filtered and sorted. */
  records: readonly R[];
  groupBy: readonly string[];
  sort: SortSpec | null;
  onSort: (sort: SortSpec | null) => void;
  /** Where a row opens; without it rows are plain (report lines). */
  openHref?: (record: R) => string;
  fmt: Formatter;
  /** Visible columns in order (prompt 24c); default: the definition's list columns. */
  columns?: readonly string[];
  /** The column picker, shown at the end of the header row. */
  picker?: React.ReactNode;
  /** LIST_COLUMNS is on (list-specific headers such as "Invoice date"). */
  listColumns?: boolean;
  /** UI_STANDARD (UI-2): the grid's user settings and its toolbar. */
  grid?: ListGridSettings;
}

export interface ListGridSettings {
  widths?: Readonly<Record<string, number>>;
  onWidthChange: (key: string, width: number | null) => void;
  density: GridDensity;
  onDensityChange: (density: GridDensity) => void;
  /** The column picker panel for the toolbar's "Columns" button. */
  columnsMenu?: React.ReactNode;
  /** "125 records". */
  count?: string;
}

/**
 * List view: sortable columns (click again for descending, a third time for the default),
 * nested collapsible groups with counts and sums, and a totals row. Each row opens the record;
 * its first cell is a real link, so keyboard and middle-click work.
 */
export function ListView<R extends ViewRecord>(props: ListViewProps<R>) {
  // UI_STANDARD: the one DataGrid; otherwise today's table, unchanged.
  return useUiStandard() ? <GridListView {...props} /> : <ClassicListView {...props} />;
}

function ClassicListView<R extends ViewRecord>({ definition: def, records, groupBy, sort, onSort, openHref, fmt, columns: shown, picker, listColumns = false }: ListViewProps<R>) {
  const router = useRouter();
  const fields = useMemo(() => fieldMap(def), [def]);
  const columns = (shown ?? def.list.columns).map((c) => fields.get(c)).filter((f): f is FieldDef => !!f);
  // The picker cell closes every row, so header, body, group and total rows keep one width.
  const endCell = picker ? <td aria-hidden className="w-10" /> : null;
  const sums = useMemo(() => (def.list.sums ?? []).filter((s) => fields.has(s)), [def.list.sums, fields]);
  const groups = useMemo(() => groupRecords(records, def, groupBy, sums, fmt), [records, def, groupBy, sums, fmt]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const sumCell = (f: FieldDef, value: number) => (f.type === "monetary" ? formatNumber(value, 2, fmt.locale) : f.type === "integer" ? formatNumber(value, 0, fmt.locale) : formatNumber(value, 2, fmt.locale));

  const row = (r: R, depth: number) => (
    <tr
      key={r.id}
      className={openHref ? "cursor-pointer transition-colors hover:bg-[var(--ds-brand-soft)]" : undefined}
      style={{ borderTop: "1px solid var(--ds-border)", height: "var(--ds-row-h)" }}
      onClick={(e) => {
        if (!openHref || (e.target as HTMLElement).closest("a")) return;
        router.push(openHref(r));
      }}
    >
      {columns.map((f, i) => (
        <td key={f.name} className={["px-3 py-1.5", isNumericField(f) ? "text-right ds-mono" : "", i === 0 ? "font-medium" : ""].join(" ")} style={i === 0 && depth ? { paddingLeft: `${0.75 + depth * 1.25}rem` } : undefined}>
          {i === 0 && openHref ? (
            <Link href={openHref(r)} className="hover:underline focus-visible:underline">
              {displayValue(f, r, fmt) || "—"}
            </Link>
          ) : (
            <Cell field={f} record={r} fmt={fmt} />
          )}
        </td>
      ))}
      {endCell}
    </tr>
  );

  const groupRows = (list: RecordGroup<R>[], depth: number): React.ReactNode[] =>
    list.flatMap((g) => {
      const expanded = open.has(g.path);
      return [
        <tr key={g.path} style={{ borderTop: "1px solid var(--ds-border)", background: "var(--ds-surface-sunken)" }}>
          <th scope="rowgroup" colSpan={1} className="px-3 py-1.5 text-left font-semibold" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
            <button type="button" aria-expanded={expanded} onClick={() => toggle(g.path)} className="inline-flex items-center gap-1.5">
              <ChevronRight className="h-4 w-4 transition-transform" style={{ transform: expanded ? "rotate(90deg)" : undefined }} aria-hidden />
              {g.color ? <span className="ds-dot" style={{ background: g.color }} aria-hidden /> : null}
              <span>{g.label}</span>
              <span className="ds-muted font-normal">({g.count})</span>
            </button>
          </th>
          {columns.slice(1).map((f) => (
            <td key={f.name} className={["px-3 py-1.5 font-semibold", isNumericField(f) ? "text-right ds-mono" : ""].join(" ")}>
              {sums.includes(f.name) ? sumCell(f, g.sums[f.name] ?? 0) : null}
            </td>
          ))}
          {endCell}
        </tr>,
        ...(expanded ? (g.children.length ? groupRows(g.children, depth + 1) : g.records.map((r) => row(r, depth + 1))) : []),
      ];
    });

  return (
    <div className="ds-card overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <thead>
          <tr>
            {columns.map((f) => {
              const sortable = f.sortable ?? f.type !== "text";
              const active = sort?.field === f.name ? sort.dir : null;
              return (
                <th key={f.name} scope="col" aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined} className={["px-3 py-2 ds-label font-semibold", isNumericField(f) ? "text-right" : ""].join(" ")}>
                  {sortable ? (
                    <button type="button" onClick={() => onSort(nextSort(sort, f.name))} className={["inline-flex items-center gap-1 uppercase", isNumericField(f) ? "flex-row-reverse" : ""].join(" ")}>
                      {listFieldLabel(f, def, listColumns, fmt)}
                      {active === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : active === "desc" ? <ArrowDown className="h-3 w-3" aria-hidden /> : null}
                    </button>
                  ) : (
                    listFieldLabel(f, def, listColumns, fmt)
                  )}
                </th>
              );
            })}
            {picker ? (
              <th scope="col" className="w-10 px-2 py-1 text-right">
                {picker}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>{groupBy.length ? groupRows(groups, 0) : records.map((r) => row(r, 0))}</tbody>
        {sums.length && records.length ? (
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--ds-border-strong)" }}>
              {columns.map((f, i) => (
                <td key={f.name} className={["px-3 py-2 font-semibold", isNumericField(f) ? "text-right ds-mono" : ""].join(" ")}>
                  {i === 0 ? fmt.t("views.total") : sums.includes(f.name) ? sumCell(f, sumBy(records, f.name)) : null}
                </td>
              ))}
              {endCell}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/**
 * The list through DataGrid (UI-2): one-line rows, sticky header / first column / totals,
 * resizable columns, group rows with their sums, keyboard rows. The column picker sits in the
 * grid's toolbar ("Columns"), never in a header cell.
 */
function GridListView<R extends ViewRecord>({ definition: def, records, groupBy, sort, onSort, openHref, fmt, columns: shown, listColumns = false, grid }: ListViewProps<R>) {
  const router = useRouter();
  const fields = useMemo(() => fieldMap(def), [def]);
  const columns = useMemo(() => (shown ?? def.list.columns).map((c) => fields.get(c)).filter((f): f is FieldDef => !!f), [shown, def.list.columns, fields]);
  const sums = useMemo(() => (def.list.sums ?? []).filter((s) => fields.has(s)), [def.list.sums, fields]);
  const groups = useMemo(() => groupRecords(records, def, groupBy, sums, fmt), [records, def, groupBy, sums, fmt]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (path: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    []
  );
  const sumText = useCallback((f: FieldDef, value: number) => formatNumber(value, f.type === "integer" ? 0 : 2, fmt.locale), [fmt.locale]);

  const gridColumns = useMemo<GridColumn<R>[]>(
    () =>
      columns.map((f, i) => ({
        key: f.name,
        header: listFieldLabel(f, def, listColumns, fmt),
        type: gridColumnType(f),
        sortable: f.sortable ?? f.type !== "text",
        // A status column is as wide as its longest label.
        samples: f.type === "selection" ? (f.options ?? []).map((o) => optionLabel(f, o.value, fmt) ?? o.value) : undefined,
        className: i === 0 ? "font-medium" : undefined,
        cell: (r: R) => (i === 0 ? displayValue(f, r, fmt) || "—" : <Cell field={f} record={r} fmt={fmt} />),
      })),
    [columns, def, listColumns, fmt]
  );

  const items = useMemo<GridItem<R>[]>(() => {
    if (!groupBy.length) return records.map((row) => ({ kind: "row", row }));
    return flattenGroups(groups, open).map((it): GridItem<R> => {
      if (it.kind === "row") return { kind: "row", row: it.record, depth: it.depth };
      const g = it.group;
      return {
        kind: "group",
        key: g.path,
        depth: it.depth,
        expanded: open.has(g.path),
        onToggle: () => toggle(g.path),
        label: `${g.label} (${g.count})`,
        cells: Object.fromEntries(columns.filter((f) => sums.includes(f.name)).map((f) => [f.name, sumText(f, g.sums[f.name] ?? 0)])),
      };
    });
  }, [groupBy.length, records, groups, open, columns, sums, toggle, sumText]);

  const totals = sums.length && records.length ? Object.fromEntries(columns.filter((f) => sums.includes(f.name)).map((f) => [f.name, sumText(f, sumBy(records, f.name))])) : null;

  return (
    <DataGrid<R>
      columns={gridColumns}
      items={items}
      rowKey={(r) => String(r.id)}
      label={def.model.key}
      labels={dataGridLabels(fmt.t)}
      sort={sort ? { key: sort.field, dir: sort.dir } : null}
      onSort={(key) => onSort(nextSort(sort, key))}
      onOpen={openHref ? (r) => router.push(openHref(r)) : undefined}
      rowHref={openHref}
      linkAs={Link}
      totals={totals}
      widths={grid?.widths}
      onWidthChange={grid?.onWidthChange}
      density={grid?.density}
      onDensityChange={grid?.onDensityChange}
      columnsMenu={grid?.columnsMenu}
      count={grid?.count}
    />
  );
}

/** One cell: selections as coloured chips, everything else as text. */
export function Cell({ field, record, fmt }: { field: FieldDef; record: ViewRecord; fmt: Formatter }) {
  const text = displayValue(field, record, fmt);
  if (field.type === "selection" && text) {
    const color = field.options?.find((o) => o.value === record[field.name])?.color;
    return (
      <span className="ds-chip" title={text} style={{ background: color ? `color-mix(in srgb, ${color} 18%, transparent)` : "var(--ds-surface-sunken)", color: "var(--ds-text)" }}>
        {color ? <span className="ds-dot" style={{ background: color }} aria-hidden /> : null}
        <span className="ds-chip-text">{text}</span>
      </span>
    );
  }
  if (field.type === "url" && text) {
    return (
      <a href={text} target="_blank" rel="noreferrer noopener" className="underline" onClick={(e) => e.stopPropagation()}>
        {text}
      </a>
    );
  }
  return <>{text || <span className="ds-subtle">—</span>}</>;
}
