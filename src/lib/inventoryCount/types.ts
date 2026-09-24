export type InventoryCountStatus = "draft" | "in_progress" | "review" | "posted";

export const INVENTORY_COUNT_STATUSES: InventoryCountStatus[] = ["draft", "in_progress", "review", "posted"];

export interface InventoryCountDocument {
  id: string;
  document_number: string;
  count_date: string;
  warehouse_id: string;
  warehouse_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  status: InventoryCountStatus;
  responsible_name: string | null;
  notes: string | null;
  line_count: number;
  counted_count: number;
  total_surplus_value: number;
  total_shortage_value: number;
  total_variance_value: number;
  journal_entry_id: string | null;
  created_by_name: string | null;
  started_at: string | null;
  submitted_at: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface InventoryCountLine {
  id: string;
  line_no: number;
  product_id: string;
  product_code: string | null;
  product_name: string;
  unit: string | null;
  barcode: string | null;
  is_metric: boolean;
  full_sheet_length_m: number | null;
  expected_qty: number;
  expected_full_sheets: number | null;
  expected_cut_pieces: number[] | null;
  /** `null` = not counted yet; uncounted lines are never adjusted. */
  actual_qty: number | null;
  actual_full_sheets: number | null;
  actual_cut_pieces: number[] | null;
  unit_cost: number;
  difference: number | null;
  variance_value: number | null;
  /** Book qty moved by this much between count start and review. */
  drift_qty: number;
  applied_qty: number | null;
  applied_value: number | null;
}

export interface InventoryCountDetail extends InventoryCountDocument {
  lines: InventoryCountLine[];
}

export interface CreateInventoryCountInput {
  count_date: string;
  warehouse_id: string;
  /** Empty = whole warehouse. */
  category_name?: string | null;
  /** Only valid together with category_name. */
  subcategory_name?: string | null;
  responsible_name?: string;
  notes?: string;
}

export interface InventoryCountOption {
  id: string;
  name: string;
}

/** One category/subcategory with stock in a warehouse (subcategory null = no subcategory). */
export interface WarehouseCategoryPath {
  category_name: string;
  subcategory_name: string | null;
  product_count: number;
}
