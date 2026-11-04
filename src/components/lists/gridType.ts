/**
 * Grid column type of a classic list column (UI-2, UI-5): pure, so `node --test` covers it.
 */
import type { GridColumnType } from "@/design-system/grid";
import type { XlsxCellType } from "@/lib/export/exportXlsx";

export interface GridTypeColumn {
  key: string;
  gridType?: GridColumnType;
  numeric?: boolean;
  exportType?: XlsxCellType;
}

/** DataGrid width class of a classic column: explicit, else from its Excel type, numeric flag or key. */
export function classicGridType(c: GridTypeColumn): GridColumnType {
  if (c.gridType) return c.gridType;
  if (c.exportType === "date") return "date";
  if (c.exportType === "datetime") return "datetime";
  // UI-5: a column that exports as an amount or a count is one, whether or not the page also set
  // `numeric` (purchases' totals, count variances and percentages were left-aligned without it).
  if (c.exportType === "money") return "money";
  if (c.exportType === "number" || c.exportType === "integer") return "number";
  if (c.numeric) return "money";
  if (/status/.test(c.key)) return "status";
  if (/^(doc_no|number|code|slip_no)$/.test(c.key)) return "code";
  return "text";
}
