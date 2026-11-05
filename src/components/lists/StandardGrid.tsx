"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { DataGrid, DesignScope, type GridColumn, type GridSelection } from "@/design-system/components";
import type { GridDensity } from "@/design-system/grid";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { dataGridLabels } from "@/i18n/uiStandardLabels";
import { clearColumnWidths, setColumnWidth } from "@/lib/lists/columns";
import { useTheme } from "@/theme/ThemeProvider";
import { sortRows, standardGridKey, toggleSort, type GridSort, type SortValue } from "./standardGridLogic";
import { useColumnPrefs } from "./useColumnPrefs";

/** A column of StandardGrid: a DataGrid column plus the value it sorts by. */
export interface StandardColumn<R> extends GridColumn<R> {
  /** The column sorts by this value (header click); no value: the column does not sort. */
  sortValue?: (row: R) => SortValue;
}

export interface StandardGridProps<R> {
  /** Stable id of the table: the user's widths and density are stored under it. */
  id: string;
  columns: readonly StandardColumn<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  /** Accessible name (the table's title). */
  label: string;
  rowActions?: (row: R) => React.ReactNode;
  actionsWidth?: number;
  onOpen?: (row: R) => void;
  /** The first column links to the record. */
  rowHref?: (row: R) => string;
  selection?: GridSelection<R>;
  /** Totals by column key in the sticky bottom row (only where the old table had totals). */
  totals?: Readonly<Record<string, React.ReactNode>> | null;
  loading?: boolean;
  /** Text (or node) of the empty state; default "No records". */
  empty?: React.ReactNode;
  toolbarStart?: React.ReactNode;
  /** Show the record count in the toolbar (lists); off for small tables inside a card. */
  showCount?: boolean;
  /** Replaces the count text. */
  countText?: string;
  onExport?: () => void;
  footer?: React.ReactNode;
  /** Density before the user picks one; reports and cards default to compact. */
  defaultDensity?: GridDensity;
  /** Sort controlled by the page (server-side sorting); else the grid sorts the rows itself. */
  sort?: GridSort | null;
  onSort?: (key: string) => void;
  className?: string;
}

/**
 * Every list, report and read-only line table outside the view engine and ListGrid (UI-6,
 * docs/ui-standard.md "Lists"): one DataGrid with one-line rows, sticky header and totals, the row
 * menu in a pinned column, the design-system empty state and skeleton, and the user's widths and
 * density per table. Sorting by the columns' `sortValue` (or by the page through `sort`/`onSort`).
 * Wrapped in the design scope in the user's theme, so it looks the same on classic pages.
 */
export function StandardGrid<R>(props: StandardGridProps<R>) {
  const {
    id,
    columns,
    rows,
    rowKey,
    label,
    rowActions,
    actionsWidth,
    onOpen,
    rowHref,
    selection,
    totals,
    loading,
    empty,
    toolbarStart,
    showCount = false,
    countText,
    onExport,
    footer,
    defaultDensity = "compact",
    sort: controlledSort,
    onSort: controlledOnSort,
    className,
  } = props;
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const { brand } = useNewUi();
  const defs = useMemo(() => columns.map((c) => ({ key: c.key, defaultVisible: true, required: true })), [columns]);
  const { prefs, setPrefs } = useColumnPrefs(standardGridKey(id), defs);
  const [ownSort, setOwnSort] = useState<GridSort | null>(null);

  const controlled = controlledOnSort !== undefined;
  const sort = controlled ? controlledSort ?? null : ownSort;
  const sortable = useMemo(() => new Set(columns.filter((c) => c.sortValue || (controlled && c.sortable)).map((c) => c.key)), [columns, controlled]);
  const gridColumns = useMemo<GridColumn<R>[]>(() => columns.map((c) => ({ ...c, sortable: sortable.has(c.key) })), [columns, sortable]);
  const shown = useMemo(() => {
    if (controlled) return rows;
    const byKey = new Map(columns.map((c) => [c.key, c.sortValue]));
    return sortRows(rows, ownSort, (row, key) => byKey.get(key)?.(row), locale);
  }, [controlled, rows, columns, ownSort, locale]);

  const emptyNode = typeof empty === "string" || empty === undefined ? <span className="ds-muted">{empty ?? t("uiStandard.grid.empty")}</span> : empty;

  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="ds-scope-transparent">
      <DataGrid<R>
        className={className}
        columns={gridColumns}
        rows={shown}
        rowKey={rowKey}
        label={label}
        labels={dataGridLabels(t)}
        selection={selection}
        rowActions={rowActions}
        actionsWidth={actionsWidth}
        onOpen={onOpen}
        rowHref={rowHref}
        linkAs={Link}
        totals={totals}
        loading={loading}
        empty={emptyNode}
        toolbarStart={toolbarStart}
        count={showCount && !loading ? countText ?? t("uiStandard.grid.count", { count: rows.length }) : undefined}
        onExport={onExport}
        footer={footer}
        sort={sort}
        onSort={sortable.size ? (key) => (controlled ? controlledOnSort!(key) : setOwnSort((s) => toggleSort(s, key))) : undefined}
        widths={prefs.widths}
        onWidthChange={(key, width) => setPrefs(width === null ? clearColumnWidths(prefs) : setColumnWidth(prefs, key, width))}
        density={prefs.density ?? defaultDensity}
      />
    </DesignScope>
  );
}
