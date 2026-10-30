/**
 * Settings > Stock integrity (fix F2): the issues stock_integrity_report() returns,
 * grouped for the page. Same checks as supabase/scripts/product_integrity_check.sql.
 */

export const STOCK_ISSUE_KINDS = [
  "null_warehouse_row",
  "total_mismatch",
  "stock_only_in_list",
  "subcategory_lost",
  "polywood_mismatch",
  "polywood_no_pieces",
  "null_row_no_default",
  "no_stock_row",
  "duplicate_code",
  "duplicate_barcode",
  "duplicate_name",
  "no_category",
  "category_text_differs",
  "service_or_composite",
] as const;

export type StockIssueKind = (typeof STOCK_ISSUE_KINDS)[number];

/** Kinds stock_integrity_fix() corrects; every other kind needs a person. */
export const AUTO_FIX_KINDS: readonly StockIssueKind[] = [
  "null_warehouse_row",
  "total_mismatch",
  "stock_only_in_list",
  "subcategory_lost",
];

/** Shown for completeness only: nothing to do. */
export const INFO_KINDS: readonly StockIssueKind[] = ["service_or_composite", "no_stock_row"];

export interface StockIssue {
  issue: StockIssueKind;
  product_id: string;
  product_code: string | null;
  product_name: string;
  details: string;
  fixable: boolean;
  stock_before: number | null;
  stock_after: number | null;
}

export interface StockIssueGroup {
  kind: StockIssueKind;
  autoFix: boolean;
  info: boolean;
  rows: StockIssue[];
  /** Rows the fix RPC would correct (a null row without a default warehouse is not). */
  fixableCount: number;
}

export function isStockIssueKind(value: unknown): value is StockIssueKind {
  return typeof value === "string" && (STOCK_ISSUE_KINDS as readonly string[]).includes(value);
}

/** Groups in display order: auto-fixable first, then the ones to review, then information. */
export function groupStockIssues(rows: readonly StockIssue[]): StockIssueGroup[] {
  const byKind = new Map<StockIssueKind, StockIssue[]>();
  for (const row of rows) {
    const list = byKind.get(row.issue) ?? [];
    list.push(row);
    byKind.set(row.issue, list);
  }
  return STOCK_ISSUE_KINDS.filter((kind) => byKind.has(kind)).map((kind) => {
    const list = byKind.get(kind) as StockIssue[];
    const autoFix = AUTO_FIX_KINDS.includes(kind);
    return {
      kind,
      autoFix,
      info: INFO_KINDS.includes(kind),
      rows: list,
      fixableCount: autoFix ? list.filter((row) => row.fixable).length : 0,
    };
  });
}

/** duplicate_name (fix F4): one group per normalised name, from the report's `name = <name>` details. */
export interface DuplicateNameGroup {
  key: string;
  rows: StockIssue[];
}

export function groupDuplicateNames(rows: readonly StockIssue[]): DuplicateNameGroup[] {
  const byKey = new Map<string, StockIssue[]>();
  for (const row of rows) {
    if (row.issue !== "duplicate_name") continue;
    const key = row.details.startsWith("name = ") ? row.details.slice("name = ".length) : row.details;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  return [...byKey.entries()].map(([key, list]) => ({ key, rows: list }));
}

/** Number of rows "Fix all" would still correct; 0 means the page is clean. */
export function remainingAutoFixable(rows: readonly StockIssue[]): number {
  return rows.filter((row) => row.fixable && AUTO_FIX_KINDS.includes(row.issue)).length;
}
