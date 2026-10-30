"use client";

import React, { useMemo } from "react";
import { Td, Th } from "@/components/ui/table";
import { useI18n } from "@/i18n/I18nProvider";
import { useUiStandard } from "@/design-system/components";
import type { GridColumnType } from "@/design-system/grid";
import { columnLabelKey, columnsForFlag, type ColumnPrefs, type FlaggedColumnDef } from "@/lib/lists/columns";
import type { XlsxCellType, XlsxColumn } from "@/lib/export/exportXlsx";
import { ColumnPicker, ColumnPickerPanel } from "./ColumnPicker";
import { useColumnPrefs } from "./useColumnPrefs";
import { useListColumnsEnabled } from "./ListColumnsFlag";

/** A column of a classic list (prompt 24c): header, cell and Excel value from one place. */
export interface TableColumn<Row> extends FlaggedColumnDef {
  thClassName?: string;
  tdClassName?: string;
  cell: (row: Row) => React.ReactNode;
  /** Excel cell type (default text). */
  exportType?: XlsxCellType;
  /** Raw Excel value (numbers, ISO dates); default: the cell when it is plain text. */
  exportValue?: (row: Row) => unknown;
  /** Width class in DataGrid (UI-2); default from numeric / exportType / the key. */
  gridType?: GridColumnType;
  /** Texts a status column shows, so DataGrid sizes it to the longest one. */
  gridSamples?: readonly string[];
}

/** DataGrid width class of a classic column: explicit, else from its Excel type, numeric flag or key. */
export function classicGridType(c: Pick<TableColumn<unknown>, "gridType" | "numeric" | "exportType" | "key">): GridColumnType {
  if (c.gridType) return c.gridType;
  if (c.exportType === "date") return "date";
  if (c.exportType === "datetime") return "datetime";
  if (c.numeric) return c.exportType === "number" ? "number" : "money";
  if (/status/.test(c.key)) return "status";
  if (/^(doc_no|number|code|slip_no)$/.test(c.key)) return "code";
  return "text";
}

export interface ShownColumn<Row> extends TableColumn<Row> {
  /** Translated header. */
  label: string;
}

export interface TableColumnsApi<Row> {
  /** LIST_COLUMNS is on. */
  enabled: boolean;
  /** The columns to render, in order (today's set while the flag is off). */
  visible: ShownColumn<Row>[];
  /** The "Columns" button, or null while the flag is off. */
  picker: React.ReactNode;
  /** The same columns for the Excel export. */
  exportColumns: XlsxColumn<Row>[];
  /** UI_STANDARD is on: the page renders <ListGrid> (UI-2) instead of its table. */
  grid: boolean;
  /** The user's prefs (order, visibility, widths, density) and the picker panel for the grid toolbar. */
  prefs: ColumnPrefs;
  setPrefs: (next: ColumnPrefs) => void;
  pickerPanel: React.ReactNode;
}

const plainText = (node: React.ReactNode): unknown => (typeof node === "string" || typeof node === "number" ? node : null);

/**
 * Columns of a classic list with the user's choice. `columns` must be memoised by the page;
 * its keys and defaults are what the stored choice is checked against.
 */
export function useTableColumns<Row>(listKey: string, columns: readonly TableColumn<Row>[]): TableColumnsApi<Row> {
  const enabled = useListColumnsEnabled();
  const grid = useUiStandard();
  const { t } = useI18n();
  const { prefs, setPrefs, reset } = useColumnPrefs(listKey, columns);

  return useMemo(() => {
    const visible = columnsForFlag(columns, enabled, prefs).map((c) => ({ ...c, label: t(columnLabelKey(c, enabled)) }));
    const exportColumns: XlsxColumn<Row>[] = visible.map((c) => ({
      header: c.label,
      type: c.exportType ?? (c.numeric ? "money" : "text"),
      value: (row: Row) => (c.exportValue ? c.exportValue(row) : plainText(c.cell(row))),
    }));
    const pickerColumns = columns.map((c) => ({ key: c.key, label: t(c.labelKey), defaultVisible: c.defaultVisible, required: c.required }));
    // With the grid (UI-2) the picker lives in the grid toolbar, so the page's own slot is empty.
    const picker = enabled && !grid ? <ColumnPicker columns={pickerColumns} prefs={prefs} onChange={setPrefs} onReset={reset} /> : null;
    const pickerPanel = enabled ? (
      <ColumnPickerPanel variant="ds" columns={pickerColumns} prefs={prefs} onChange={(next) => setPrefs({ ...next, widths: prefs.widths, density: prefs.density })} onReset={reset} />
    ) : null;
    return { enabled, visible, picker, exportColumns, grid, prefs, setPrefs, pickerPanel };
  }, [columns, enabled, grid, prefs, setPrefs, reset, t]);
}

/** Header cells of the visible columns (between the select and the actions column). */
export function ListHeadCells<Row>({ columns }: { columns: readonly ShownColumn<Row>[] }) {
  return (
    <>
      {columns.map((c) => (
        <Th key={c.key} numeric={c.numeric} className={c.thClassName}>
          {c.label}
        </Th>
      ))}
    </>
  );
}

/** Body cells of one row for the visible columns. */
export function ListBodyCells<Row>({ columns, row }: { columns: readonly ShownColumn<Row>[]; row: Row }) {
  return (
    <>
      {columns.map((c) => (
        <Td key={c.key} numeric={c.numeric} className={c.tdClassName}>
          {c.cell(row)}
        </Td>
      ))}
    </>
  );
}

/** "—" for a missing name or value (never a raw id). */
export const dash = (value: string | null | undefined): string => (value && value.trim() ? value : "—");
