export {
  formatProductionDbError,
  isProductionSchemaColumnError,
  productionSchemaColumnFromError,
  PRODUCTION_MATERIAL_INSERT_KEYS as PRODUCTION_MATERIAL_DB_INSERT_KEYS,
  PRODUCTION_MATERIAL_LIVE_COLUMNS as PRODUCTION_MATERIAL_INSERT_SELECT_COLUMNS,
  PRODUCTION_MATERIAL_LIVE_COLUMNS as PRODUCTION_MATERIAL_LIVE_SELECT_COLUMNS,
  type ProductionMaterialInsertPayload as ProductionMaterialDbInsert,
} from "@/lib/production/payloads";

import {
  formatProductionDbError,
  PRODUCTION_MATERIAL_INSERT_KEYS,
  productionSchemaColumnFromError,
  type ProductionMaterialInsertPayload,
} from "@/lib/production/payloads";
import { missingColumnFromError } from "@/lib/production/safeQuery";

/** Allowed columns on production_materials INSERT (live Supabase schema). */
export const PRODUCTION_MATERIAL_DB_INSERT_COLUMNS = PRODUCTION_MATERIAL_INSERT_KEYS;

/**
 * Transient UI / form fields — never pass to supabase.from("production_materials").insert().
 * `warehouse_name` is display-only; persist `warehouse_id` and resolve the label in UI joins.
 */
export const PRODUCTION_MATERIAL_UI_ONLY_KEYS = [
  "product_code",
  "product_name",
  "warehouse_name",
  "unit_cost",
  "line_cost",
  "qty",
  "maya",
  "cemi",
  "inventory_mode",
  "polywood_sale_mode",
  "polywood_length_m",
  "polywood_cut_details",
  "stage_no",
  "stage_label",
  "issued",
  "issued_at",
  "created_by",
  "created_by_name",
  "issue_now",
  "id",
  "temp_id",
] as const;

const UI_ONLY_KEY_SET = new Set<string>(PRODUCTION_MATERIAL_UI_ONLY_KEYS);

export interface AddProductionMaterialInput {
  product_id: string;
  warehouse_id?: string | null;
  /** Display label only — never written to production_materials. */
  warehouse_name?: string | null;
  quantity: number;
  polywood_sale_mode?: "linear_m" | "full_sheet" | null;
  stage_no?: number;
  stage_label?: string | null;
  notes?: string | null;
  issue_now?: boolean;
}

/** Remove leaked UI keys from a raw object (e.g. after `{ ...formRow }` spreads). */
export function stripUiOnlyMaterialFields(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };
  for (const key of UI_ONLY_KEY_SET) {
    delete next[key];
  }
  return next;
}

/** Copy only whitelisted DB columns — blocks spread/leaked UI keys from reaching Supabase. */
export function pickMaterialInsertPayload(
  row: ProductionMaterialInsertPayload
): ProductionMaterialInsertPayload {
  return {
    production_order_id: row.production_order_id,
    product_id: row.product_id,
    warehouse_id: row.warehouse_id ?? null,
    quantity: Number(row.quantity) || 0,
    unit: row.unit || null,
    unit_price: Number(row.unit_price) || 0,
    total_price: Number(row.total_price) || 0,
    notes: row.notes ?? null,
  };
}

/**
 * Strict whitelist for production_materials insert/upsert.
 * Maps form aliases (qty, maya, cemi) to DB columns. Omits warehouse_name and all UI fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeMaterialPayload(item: any): ProductionMaterialInsertPayload {
  const source =
    item && typeof item === "object"
      ? stripUiOnlyMaterialFields(item as Record<string, unknown>)
      : {};

  const quantity = Number(source.quantity ?? source.qty ?? 1) || 0;
  const unitPrice = Number(source.unit_price ?? source.maya ?? source.unit_cost ?? 0) || 0;
  const totalPrice =
    Number(source.total_price ?? source.cemi ?? source.line_cost ?? quantity * unitPrice) || 0;

  return pickMaterialInsertPayload({
    production_order_id: String(source.production_order_id ?? ""),
    product_id: String(source.product_id ?? ""),
    warehouse_id: (source.warehouse_id as string | null | undefined) || null,
    quantity,
    unit: (source.unit as string | null | undefined) || null,
    unit_price: unitPrice,
    total_price: totalPrice,
    notes:
      typeof source.notes === "string"
        ? source.notes.trim() || null
        : (source.notes as string | null | undefined) || null,
  });
}

/** Build insert body with exactly INSERT_KEYS — safe for Supabase .insert([payload]). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildStrictMaterialInsertPayload(item: any): Record<string, unknown> {
  const sanitized = sanitizeMaterialPayload(item);
  const record: Record<string, unknown> = {};
  for (const key of PRODUCTION_MATERIAL_INSERT_KEYS) {
    record[key] = sanitized[key];
  }
  return record;
}

/** Sanitize a batch — use instead of `.map((row) => ({ ...row }))` before insert. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeMaterialPayloadList(items: any[]): ProductionMaterialInsertPayload[] {
  return items.map((item) => sanitizeMaterialPayload(item));
}

/** Insert with column-drop retry when PostgREST schema cache lacks optional columns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function insertSanitizedMaterialRow(
  admin: { from: (table: string) => any },
  item: any
): Promise<{ data: { id: string } | null; error: string | null }> {
  let payload = buildStrictMaterialInsertPayload(item);

  for (let attempt = 0; attempt < 8; attempt++) {
    for (const uiKey of UI_ONLY_KEY_SET) {
      delete payload[uiKey];
    }

    const { data, error } = await admin
      .from("production_materials")
      .insert([payload])
      .select("id")
      .single();

    if (!error && data) {
      return { data: data as { id: string }, error: null };
    }

    const blocked =
      productionSchemaColumnFromError(error) || missingColumnFromError(error);

    if (blocked) {
      if (UI_ONLY_KEY_SET.has(blocked)) {
        payload = buildStrictMaterialInsertPayload(item);
        continue;
      }
      if (blocked in payload) {
        delete payload[blocked];
        continue;
      }
    }

    return {
      data: null,
      error: formatProductionDbError(error?.message || "Material əlavə edilmədi"),
    };
  }

  return { data: null, error: "production_materials schema mismatch" };
}

/** Strip UI-only fields from action input (kept for display / issue logic, not DB insert). */
export function sanitizeAddProductionMaterialInput(input: AddProductionMaterialInput): AddProductionMaterialInput {
  const quantity = Number(input.quantity ?? (input as { qty?: number }).qty ?? 1) || 0;
  return {
    product_id: String(input.product_id),
    warehouse_id: input.warehouse_id ?? null,
    warehouse_name: input.warehouse_name ?? null,
    quantity,
    polywood_sale_mode: input.polywood_sale_mode ?? null,
    stage_no: Number(input.stage_no) || 1,
    stage_label: input.stage_label?.trim() || null,
    notes: input.notes?.trim() || null,
    issue_now: Boolean(input.issue_now),
  };
}

/** @deprecated Use sanitizeMaterialPayload */
export const sanitizeProductionMaterialDbInsert = sanitizeMaterialPayload;

/** Build insert row from add-material action input + order id. */
export function toProductionMaterialInsertPayload(
  orderId: string,
  input: AddProductionMaterialInput & { unit?: string | null; unit_cost?: number; maya?: number }
): ProductionMaterialInsertPayload {
  const safe = sanitizeAddProductionMaterialInput(input);
  return sanitizeMaterialPayload({
    production_order_id: orderId,
    product_id: safe.product_id,
    warehouse_id: safe.warehouse_id ?? null,
    quantity: safe.quantity,
    unit: input.unit ?? null,
    maya: input.maya ?? input.unit_cost,
    unit_cost: input.unit_cost,
    notes: safe.notes ?? null,
  });
}

/** @deprecated Use sanitizeMaterialPayload */
export const createProductionMaterialDbInsertPayload = sanitizeMaterialPayload;
