import { missingColumnFromError } from "@/lib/production/safeQuery";

/** Live production_materials columns — price pair + workflow fields used by RPC and UI. */
export const PRODUCTION_MATERIAL_LIVE_COLUMNS = [
  "id",
  "production_order_id",
  "product_id",
  "warehouse_id",
  "quantity",
  "unit",
  "unit_price",
  "total_price",
  "unit_cost",
  "line_cost",
  "stage_no",
  "stage_label",
  "issued",
  "issued_at",
  "notes",
] as const;

/** @deprecated Not used on live DB — product_code/name come from products join in app code. */
export const PRODUCTION_MATERIAL_EXTENDED_COLUMNS = [] as const;

export const PRODUCTION_MATERIAL_INSERT_KEYS = [
  "production_order_id",
  "product_id",
  "warehouse_id",
  "quantity",
  "unit",
  "unit_price",
  "total_price",
  "notes",
] as const;

export type ProductionMaterialInsertPayload = {
  production_order_id: string;
  product_id: string;
  warehouse_id: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total_price: number;
  notes: string | null;
};

export type ProductionMaterialInsertSource = {
  production_order_id: string;
  product_id: string;
  warehouse_id?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price?: number;
  unit_cost?: number;
  total_price?: number;
  line_cost?: number;
  notes?: string | null;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Map app unit_cost / line_cost to live DB unit_price / total_price — never sends line_cost. */
export function buildProductionMaterialInsertPayload(
  source: ProductionMaterialInsertSource
): ProductionMaterialInsertPayload {
  const quantity = toNumber(source.quantity);
  const unitPrice = toNumber(source.unit_price ?? source.unit_cost);
  const totalPrice = toNumber(source.total_price ?? source.line_cost ?? quantity * unitPrice);

  const payload: ProductionMaterialInsertPayload = {
    production_order_id: String(source.production_order_id),
    product_id: String(source.product_id),
    warehouse_id: source.warehouse_id ?? null,
    quantity,
    unit: source.unit?.trim() || null,
    unit_price: unitPrice,
    total_price: totalPrice,
    notes: typeof source.notes === "string" ? source.notes.trim() || null : null,
  };

  // Hard allowlist — strip any accidental UI keys (line_cost, inventory_mode, temp_id, …).
  const safe: ProductionMaterialInsertPayload = {
    production_order_id: payload.production_order_id,
    product_id: payload.product_id,
    warehouse_id: payload.warehouse_id,
    quantity: payload.quantity,
    unit: payload.unit,
    unit_price: payload.unit_price,
    total_price: payload.total_price,
    notes: payload.notes,
  };

  return safe;
}

/** Hard whitelist — only the seven columns that exist on the live DB. */
export function pickProductionMaterialInsertPayload(
  source: ProductionMaterialInsertSource
): ProductionMaterialInsertPayload {
  const built = buildProductionMaterialInsertPayload(source);
  return {
    production_order_id: built.production_order_id,
    product_id: built.product_id,
    warehouse_id: built.warehouse_id ?? null,
    quantity: Number(built.quantity) || 0,
    unit: built.unit ?? null,
    unit_price: Number(built.unit_price) || 0,
    total_price: Number(built.total_price) || 0,
    notes: built.notes ?? null,
  };
}

export const OUTSOURCING_INSERT_KEYS = [
  "production_order_id",
  "supplier_id",
  "supplier_name",
  "material_description",
  "description",
  "notes",
  "sqm_quantity",
  "price_per_sqm",
] as const;

export type ProductionOutsourcingInsertSource = {
  production_order_id: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  material_description: string;
  notes?: string | null;
  sqm_quantity: number;
  price_per_sqm: number;
};

export function buildProductionOutsourcingInsertPayload(
  source: ProductionOutsourcingInsertSource
): Record<string, unknown> {
  const materialText = source.material_description.trim();
  const noteText = source.notes?.trim() || materialText;
  const descriptionText = materialText || noteText;
  const supplierName = source.supplier_name?.trim();

  const payload: Record<string, unknown> = {
    production_order_id: source.production_order_id,
    sqm_quantity: toNumber(source.sqm_quantity),
    price_per_sqm: toNumber(source.price_per_sqm),
    material_description: materialText,
    description: descriptionText,
    notes: noteText,
  };
  if (source.supplier_id) payload.supplier_id = source.supplier_id;
  if (supplierName) payload.supplier_name = supplierName;
  return payload;
}

export const EXPENSE_INSERT_KEYS = [
  "production_order_id",
  "category",
  "description",
  "amount",
  "expense_date",
  "account_id",
  "account_name",
  "finance_expense_id",
  "notes",
  "created_by",
  "created_by_name",
] as const;

export type ProductionExpenseInsertSource = {
  production_order_id: string;
  category: string;
  description: string;
  amount: number;
  expense_date?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  finance_expense_id?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
};

export function buildProductionExpenseInsertPayload(
  source: ProductionExpenseInsertSource
): Record<string, unknown> {
  return {
    production_order_id: source.production_order_id,
    category: source.category,
    description: source.description.trim(),
    amount: toNumber(source.amount),
    expense_date: source.expense_date || new Date().toISOString().slice(0, 10),
    account_id: source.account_id || null,
    account_name: source.account_name?.trim() || null,
    finance_expense_id: source.finance_expense_id ?? null,
    notes: source.notes?.trim() || null,
    created_by: source.created_by || null,
    created_by_name: source.created_by_name?.trim() || null,
  };
}

export function productionSchemaColumnFromError(
  error?: { message?: string; code?: string } | null
): string | null {
  return missingColumnFromError(error);
}

export function isProductionSchemaColumnError(message?: string | null): boolean {
  if (!message) return false;
  return /schema cache|Could not find the '[^']+' column/i.test(message);
}

export function formatProductionDbError(message?: string | null): string {
  if (!message) return "Əməliyyat alınmadı";
  const missing = message.match(/Could not find the '([^']+)' column/i);
  if (missing?.[1]) {
    const column = missing[1];
    return `Verilənlər bazası sxemi uyğun deyil («${column}» sütunu mövcud deyil). Material/xərc məlumatları yalnız mövcud sütunlarla yazılır — administratora miqrasiya skriptini yoxlatın.`;
  }
  return message;
}

/** Drop missing columns from a select list until the query succeeds or no columns remain. */
export async function selectProductionMaterialsWithFallback<T>(
  run: (columns: string) => Promise<{ data: T | null; error: { message?: string } | null }>,
  options?: { maxAttempts?: number }
): Promise<{ data: T | null; error: string | null }> {
  const maxAttempts = options?.maxAttempts ?? 24;
  let columns = [...PRODUCTION_MATERIAL_LIVE_COLUMNS];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await run(columns.join(","));
    if (!result.error) return { data: result.data, error: null };

    const blocked = productionSchemaColumnFromError(result.error);
    if (!blocked) {
      return { data: null, error: formatProductionDbError(result.error?.message) };
    }
    if ((columns as readonly string[]).includes(blocked)) {
      columns = columns.filter((column) => column !== blocked);
    } else {
      columns = [...PRODUCTION_MATERIAL_LIVE_COLUMNS];
    }
    if (!columns.length) {
      return { data: null, error: formatProductionDbError(result.error?.message) };
    }
  }

  return { data: null, error: "production_materials schema mismatch" };
}
