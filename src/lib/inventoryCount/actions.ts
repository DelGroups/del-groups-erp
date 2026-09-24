"use server";

import { ActionAuthError, mapRpcError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type {
  CreateInventoryCountInput,
  InventoryCountDetail,
  InventoryCountDocument,
  InventoryCountLine,
  InventoryCountOption,
  InventoryCountStatus,
  WarehouseCategoryPath,
} from "@/lib/inventoryCount/types";

export type InventoryCountActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

/** inventory_counts is newer than the generated Database types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

function db(): LooseClient {
  return createSupabaseAdminClient() as unknown as LooseClient;
}

function fail(err: unknown): { success: false; error: string } {
  if (err instanceof ActionAuthError) return { success: false, error: err.message };
  return { success: false, error: err instanceof Error ? mapRpcError(err.message) : "Failed" };
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

function numArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(num).filter((n) => n > 0);
}

function mapDocument(row: Record<string, unknown>): InventoryCountDocument {
  return {
    id: row.id as string,
    document_number: row.document_number as string,
    count_date: row.count_date as string,
    warehouse_id: row.warehouse_id as string,
    warehouse_name: (row.warehouse_name as string) || null,
    category_name: (row.category_name as string) || null,
    subcategory_name: (row.subcategory_name as string) || null,
    status: row.status as InventoryCountStatus,
    responsible_name: (row.responsible_name as string) || null,
    notes: (row.notes as string) || null,
    line_count: num(row.line_count),
    counted_count: num(row.counted_count),
    total_surplus_value: num(row.total_surplus_value),
    total_shortage_value: num(row.total_shortage_value),
    total_variance_value: num(row.total_variance_value),
    journal_entry_id: (row.journal_entry_id as string) || null,
    created_by_name: (row.created_by_name as string) || null,
    started_at: (row.started_at as string) || null,
    submitted_at: (row.submitted_at as string) || null,
    posted_at: (row.posted_at as string) || null,
    created_at: row.created_at as string,
  };
}

function mapLine(row: Record<string, unknown>): InventoryCountLine {
  return {
    id: row.id as string,
    line_no: num(row.line_no),
    product_id: row.product_id as string,
    product_code: (row.product_code as string) || null,
    product_name: row.product_name as string,
    unit: (row.unit as string) || null,
    barcode: (row.barcode as string) || null,
    is_metric: Boolean(row.is_metric),
    full_sheet_length_m: numOrNull(row.full_sheet_length_m),
    expected_qty: num(row.expected_qty),
    expected_full_sheets: numOrNull(row.expected_full_sheets),
    expected_cut_pieces: numArray(row.expected_cut_pieces),
    actual_qty: numOrNull(row.actual_qty),
    actual_full_sheets: numOrNull(row.actual_full_sheets),
    actual_cut_pieces: numArray(row.actual_cut_pieces),
    unit_cost: num(row.unit_cost),
    difference: numOrNull(row.difference),
    variance_value: numOrNull(row.variance_value),
    drift_qty: num(row.drift_qty),
    applied_qty: numOrNull(row.applied_qty),
    applied_value: numOrNull(row.applied_value),
  };
}

async function requireStatus(countId: string, allowed: InventoryCountStatus[]): Promise<void> {
  const { data, error } = await db()
    .from("inventory_counts")
    .select("status")
    .eq("id", countId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("İnventarizasiya sənədi tapılmadı");
  if (!allowed.includes(data.status as InventoryCountStatus)) {
    throw new Error("Bu əməliyyat sənədin cari statusunda mümkün deyil");
  }
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(mapRpcError(error.message));
  return data as T;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function fetchInventoryCountsAction(): Promise<InventoryCountActionResult<InventoryCountDocument[]>> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const { data, error } = await db()
      .from("inventory_counts")
      .select("*")
      .order("count_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { success: false, error: error.message };
    return { success: true, data: ((data || []) as Record<string, unknown>[]).map(mapDocument) };
  } catch (err) {
    return fail(err);
  }
}

export async function fetchInventoryCountAction(
  countId: string
): Promise<InventoryCountActionResult<InventoryCountDetail>> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const client = db();
    const { data: header, error: headerError } = await client
      .from("inventory_counts")
      .select("*")
      .eq("id", countId)
      .maybeSingle();
    if (headerError) return { success: false, error: headerError.message };
    if (!header) return { success: false, error: "İnventarizasiya sənədi tapılmadı" };

    const { data: lines, error: linesError } = await client
      .from("inventory_count_items")
      .select("*")
      .eq("count_id", countId)
      .order("line_no", { ascending: true })
      .limit(20000);
    if (linesError) return { success: false, error: linesError.message };

    return {
      success: true,
      data: {
        ...mapDocument(header as Record<string, unknown>),
        lines: ((lines || []) as Record<string, unknown>[]).map(mapLine),
      },
    };
  } catch (err) {
    return fail(err);
  }
}

export async function fetchInventoryCountWarehousesAction(): Promise<
  InventoryCountActionResult<InventoryCountOption[]>
> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const { data, error } = await db().from("warehouses").select("id, name").order("name");
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data || []) as InventoryCountOption[] };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Category/subcategory paths that have stock in the warehouse, aggregated in
 * the database (get_warehouse_active_categories) — products never reach the client.
 */
export async function fetchWarehouseCategoriesAction(
  warehouseId: string
): Promise<InventoryCountActionResult<WarehouseCategoryPath[]>> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    if (!warehouseId) return { success: true, data: [] };
    const rows = await callRpc<Record<string, unknown>[]>("get_warehouse_active_categories", {
      p_warehouse_id: warehouseId,
    });
    return {
      success: true,
      data: (rows || []).map((row) => ({
        category_name: row.category_name as string,
        subcategory_name: (row.subcategory_name as string) || null,
        product_count: num(row.product_count),
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

// ─── Draft ──────────────────────────────────────────────────────────────────

export async function createInventoryCountAction(
  input: CreateInventoryCountInput
): Promise<InventoryCountActionResult<{ id: string }>> {
  try {
    const { user, profile } = await requirePermissionAction("can_writeoff_inventory");
    if (!input.warehouse_id) return { success: false, error: "Anbar seçilməyib" };
    const client = db();

    const categoryName = input.category_name?.trim() || null;
    const subcategoryName = categoryName ? input.subcategory_name?.trim() || null : null;

    const { data: warehouse } = await client
      .from("warehouses")
      .select("name")
      .eq("id", input.warehouse_id)
      .maybeSingle();
    if (!warehouse) return { success: false, error: "Anbar tapılmadı" };

    const documentNumber = await callRpc<string>("next_inventory_count_doc_no", {});
    const { data, error } = await client
      .from("inventory_counts")
      .insert([
        {
          document_number: documentNumber,
          count_date: input.count_date,
          warehouse_id: input.warehouse_id,
          warehouse_name: warehouse.name,
          category_name: categoryName,
          subcategory_name: subcategoryName,
          responsible_name: input.responsible_name?.trim() || null,
          notes: input.notes?.trim() || null,
          status: "draft",
          created_by: user.id,
          created_by_name: profile?.full_name || user.email || null,
        },
      ])
      .select("id")
      .single();
    if (error || !data) return { success: false, error: error?.message || "Sənəd yaradılmadı" };
    return { success: true, data: { id: data.id as string } };
  } catch (err) {
    return fail(err);
  }
}

/** Deletes a count that has not been posted. Nothing is booked before posting. */
export async function deleteInventoryCountAction(countId: string): Promise<InventoryCountActionResult> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    await requireStatus(countId, ["draft", "in_progress", "review"]);
    const { error } = await db().from("inventory_counts").delete().eq("id", countId).neq("status", "posted");
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return fail(err);
  }
}

// ─── Workflow ───────────────────────────────────────────────────────────────

export async function startInventoryCountAction(
  countId: string
): Promise<InventoryCountActionResult<{ lines: number }>> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const data = await callRpc<{ lines: number }>("inventory_count_start", { p_count_id: countId });
    return { success: true, data };
  } catch (err) {
    return fail(err);
  }
}

/** Returns the updated line so the grid can patch one row instead of reloading. */
export async function scanInventoryCountAction(
  countId: string,
  code: string
): Promise<InventoryCountActionResult<{ line: InventoryCountLine; piece_length: number | null }>> {
  try {
    const { user } = await requirePermissionAction("can_writeoff_inventory");
    const scan = await callRpc<{ line_id: string; piece_length: number | null }>("inventory_count_scan", {
      p_count_id: countId,
      p_code: code,
      p_actor: user.id,
    });
    const { data, error } = await db()
      .from("inventory_count_items")
      .select("*")
      .eq("id", scan.line_id)
      .single();
    if (error || !data) return { success: false, error: error?.message || "Sətir tapılmadı" };
    return {
      success: true,
      data: { line: mapLine(data as Record<string, unknown>), piece_length: numOrNull(scan.piece_length) },
    };
  } catch (err) {
    return fail(err);
  }
}

export type InventoryCountLineInput =
  | { kind: "qty"; actual_qty: number | null }
  | { kind: "pieces"; full_sheets: number | null; cut_pieces: number[] | null };

export type InventoryCountLineSave = InventoryCountLineInput & { line_id: string };

/**
 * "Yadda saxla" / auto-save: persists a batch of counted quantities while the
 * count stays in_progress. save_count_progress only updates count lines — no
 * stock, movement or ledger changes happen before posting.
 */
export async function saveInventoryCountProgressAction(
  countId: string,
  lines: InventoryCountLineSave[]
): Promise<InventoryCountActionResult<InventoryCountLine[]>> {
  try {
    const { user } = await requirePermissionAction("can_writeoff_inventory");
    if (lines.length === 0) return { success: true, data: [] };
    const rows = await callRpc<Record<string, unknown>[]>("save_count_progress", {
      p_count_id: countId,
      p_lines: lines,
      p_actor: user.id,
    });
    return { success: true, data: (rows || []).map(mapLine) };
  } catch (err) {
    return fail(err);
  }
}

/** Full count: every line nobody counted is recorded as zero on the shelf. */
export async function markUncountedAsZeroAction(countId: string): Promise<InventoryCountActionResult> {
  try {
    const { user } = await requirePermissionAction("can_writeoff_inventory");
    await requireStatus(countId, ["in_progress"]);
    const client = db();
    const now = new Date().toISOString();

    const standard = await client
      .from("inventory_count_items")
      .update({ actual_qty: 0, counted_at: now, counted_by: user.id })
      .eq("count_id", countId)
      .eq("is_metric", false)
      .is("actual_qty", null);
    if (standard.error) return { success: false, error: standard.error.message };

    const metric = await client
      .from("inventory_count_items")
      .update({ actual_full_sheets: 0, actual_cut_pieces: [], counted_at: now, counted_by: user.id })
      .eq("count_id", countId)
      .eq("is_metric", true)
      .is("actual_qty", null);
    if (metric.error) return { success: false, error: metric.error.message };

    await client.rpc("inventory_count_refresh_totals", { p_count_id: countId });
    return { success: true };
  } catch (err) {
    return fail(err);
  }
}

export async function resyncInventoryCountBookAction(countId: string): Promise<InventoryCountActionResult> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    await callRpc("inventory_count_resync_book", { p_count_id: countId });
    return { success: true };
  } catch (err) {
    return fail(err);
  }
}

export async function submitInventoryCountAction(
  countId: string
): Promise<InventoryCountActionResult<{ counted: number; drift_lines: number }>> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const data = await callRpc<{ counted: number; drift_lines: number }>("inventory_count_submit", {
      p_count_id: countId,
    });
    return { success: true, data };
  } catch (err) {
    return fail(err);
  }
}

export async function reopenInventoryCountAction(countId: string): Promise<InventoryCountActionResult> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    await callRpc("inventory_count_reopen", { p_count_id: countId });
    return { success: true };
  } catch (err) {
    return fail(err);
  }
}

export async function postInventoryCountAction(
  countId: string
): Promise<
  InventoryCountActionResult<{ document_number: string; movements: number; surplus_value: number; shortage_value: number }>
> {
  try {
    const { user } = await requirePermissionAction("can_post_inventory_count");
    const data = await callRpc<{
      document_number: string;
      movements: number;
      surplus_value: number;
      shortage_value: number;
    }>("inventory_count_post", { p_count_id: countId, p_actor: user.id });
    return { success: true, data };
  } catch (err) {
    return fail(err);
  }
}
