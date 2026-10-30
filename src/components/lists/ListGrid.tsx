"use client";

import React, { useMemo } from "react";
import { DataGrid, DesignScope, type GridColumn, type GridSelection } from "@/design-system/components";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { dataGridLabels } from "@/i18n/uiStandardLabels";
import { formatGridDate, formatGridDateTime } from "@/lib/dates/localeDate";
import { clearColumnWidths, setColumnWidth } from "@/lib/lists/columns";
import { useTheme } from "@/theme/ThemeProvider";
import { classicGridType, type TableColumnsApi } from "./listTable";

export interface ListGridProps<Row> {
  /** The page's useTableColumns result: the visible columns and the user's prefs. */
  columns: TableColumnsApi<Row>;
  rows: readonly Row[];
  /** Records in the whole list when `rows` is one page (the toolbar count). */
  total?: number;
  rowKey: (row: Row) => string;
  /** Accessible name (the page title). */
  label: string;
  selection?: GridSelection<Row>;
  rowActions?: (row: Row) => React.ReactNode;
  actionsWidth?: number;
  onOpen?: (row: Row) => void;
  loading?: boolean;
  empty?: React.ReactNode;
  /** Pagination or "load more". */
  footer?: React.ReactNode;
  onExport?: () => void;
  totals?: Readonly<Record<string, React.ReactNode>> | null;
  toolbarStart?: React.ReactNode;
}

/**
 * A classic list page through DataGrid (UI-2, UI_STANDARD on): the page's own columns (prompt
 * 24c), selection, row actions and pagination; widths, order, visibility and density from the
 * user's column prefs. Wrapped in the design scope in the user's theme, so the grid's tokens
 * apply on classic pages too.
 */
export function ListGrid<Row>({ columns, rows, total, rowKey, label, selection, rowActions, actionsWidth, onOpen, loading, empty, footer, onExport, totals, toolbarStart }: ListGridProps<Row>) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { brand } = useNewUi();
  const { prefs, setPrefs } = columns;

  const gridColumns = useMemo<GridColumn<Row>[]>(
    () =>
      columns.visible.map((c) => {
        const type = classicGridType(c);
        // Dates from their raw value through the one formatting module: dd.mm.yyyy (HH:mm).
        const raw = c.exportValue;
        const cell =
          raw && type === "date"
            ? (row: Row) => formatGridDate(raw(row) as string | null)
            : raw && type === "datetime"
              ? (row: Row) => formatGridDateTime(raw(row) as string | null)
              : c.cell;
        return { key: c.key, header: c.label, type, samples: c.gridSamples, cell };
      }),
    [columns.visible]
  );

  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className="ds-scope-transparent">
      <DataGrid<Row>
        columns={gridColumns}
        rows={rows}
        rowKey={rowKey}
        label={label}
        labels={dataGridLabels(t)}
        selection={selection}
        rowActions={rowActions}
        actionsWidth={actionsWidth}
        onOpen={onOpen}
        loading={loading}
        empty={empty}
        footer={footer}
        onExport={onExport}
        totals={totals}
        toolbarStart={toolbarStart}
        count={loading ? undefined : t("uiStandard.grid.count", { count: total ?? rows.length })}
        columnsMenu={columns.pickerPanel ?? undefined}
        widths={prefs.widths}
        onWidthChange={(key, width) => setPrefs(width === null ? clearColumnWidths(prefs) : setColumnWidth(prefs, key, width))}
        density={prefs.density ?? "comfortable"}
        onDensityChange={(density) => setPrefs({ ...prefs, density })}
      />
    </DesignScope>
  );
}
