"use server";

import { getServerAuthContext, createSupabaseServerClient } from "@/lib/supabaseServer";
import { isValidUuid } from "@/lib/auth/validate";
import { ActionAuthError, mapRpcError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isAdminRole } from "@/types/database.types";
import { isLotTrackingEnabled } from "@/lib/features/lotTracking";
import type { DocumentLotRow, LotOption, LotStatus } from "../lib/lotPicker";

/**
 * LOT-3: what the LotPicker and the lot chips read. Row-level security of the lot tables lets a
 * user see lots only with lots.view (lots_can), so a user without it gets no lots (the picker
 * then stays on automatic). With LOT_TRACKING off nothing is read.
 */

/** stock_lots / stock_lot_balances are newer than the generated Database types. */
type Db = {
  from: (table: string) => {
    select: (cols: string) => Query;
  };
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
type Query = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  eq: (col: string, value: unknown) => Query;
  in: (col: string, values: unknown[]) => Query;
  gt: (col: string, value: unknown) => Query;
  order: (col: string, opts?: { ascending?: boolean }) => Query;
  limit: (n: number) => Query;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

async function client(): Promise<Db | null> {
  if (!isLotTrackingEnabled()) return null;
  const { user } = await getServerAuthContext();
  if (!user) return null;
  return (await createSupabaseServerClient()) as unknown as Db;
}

export interface ProductLotsResult {
  lots: LotOption[];
  /** lots.manage: may choose an expired lot (with a warning). */
  canManage: boolean;
}

/** A product's lots with stock in one warehouse (for the LotPicker). */
export async function listProductLots(productId: string, warehouseId: string): Promise<ProductLotsResult> {
  const empty: ProductLotsResult = { lots: [], canManage: false };
  if (!isValidUuid(productId) || !isValidUuid(warehouseId)) return empty;
  const db = await client();
  if (!db) return empty;

  const [{ data: balances, error }, manage] = await Promise.all([
    db.from("stock_lot_balances").select("lot_id, qty").eq("product_id", productId).eq("warehouse_id", warehouseId).eq("is_unassigned", false).gt("qty", 0),
    db.rpc("lots_can", { p_action: "manage" }),
  ]);
  if (error || !balances?.length) return { ...empty, canManage: manage.data === true };

  const qtyById = new Map((balances as { lot_id: string; qty: unknown }[]).map((b) => [b.lot_id, num(b.qty)]));
  const { data: lots } = await db
    .from("stock_lots")
    .select("id, lot_no, supplier_batch_no, exp_date, received_date, status")
    .in("id", [...qtyById.keys()]);

  return {
    canManage: manage.data === true,
    lots: ((lots ?? []) as Record<string, unknown>[]).map((l) => ({
      id: String(l.id),
      lotNo: String(l.lot_no),
      supplierBatchNo: str(l.supplier_batch_no),
      expDate: str(l.exp_date)?.slice(0, 10) ?? null,
      receivedDate: str(l.received_date)?.slice(0, 10) ?? null,
      status: (["active", "quarantine", "closed"].includes(String(l.status)) ? l.status : "active") as LotStatus,
      qty: qtyById.get(String(l.id)) ?? 0,
    })),
  };
}

/**
 * The lots a posted document took or received (stock_lot_movements of the document, net of its
 * reversals), for the read-only chips on its view. docType: 'sale', 'inventory_writeoff',
 * 'stock_transfer', 'production_order', 'consignment_dispatch', ...
 */
export async function listDocumentLots(docType: string, docId: string, direction: "out" | "in" = "out"): Promise<DocumentLotRow[]> {
  if (!isValidUuid(docId) || !/^[a-z_]{2,40}$/.test(docType)) return [];
  const db = await client();
  if (!db) return [];
  const { data: moves, error } = await db
    .from("stock_lot_movements")
    .select("lot_id, product_id, doc_line_id, qty_delta, kind")
    .eq("doc_type", docType)
    .eq("doc_id", docId)
    .limit(2000);
  if (error || !moves?.length) return [];

  const rows = moves as { lot_id: string; product_id: string; doc_line_id: string | null; qty_delta: unknown; kind: string }[];
  const { data: lots } = await db.from("stock_lots").select("id, lot_no, origin_type").in("id", [...new Set(rows.map((m) => m.lot_id))]);
  const lotNo = new Map(
    ((lots ?? []) as { id: string; lot_no: string; origin_type: string }[]).filter((l) => l.origin_type !== "unassigned").map((l) => [l.id, l.lot_no]),
  );
  // Out documents: what left (out / transfer_out) minus what came back (reverse_in); in: the opposite.
  const sign = direction === "out" ? -1 : 1;
  const out: DocumentLotRow[] = [];
  for (const m of rows) {
    const no = lotNo.get(m.lot_id);
    if (!no) continue;
    const q = num(m.qty_delta) * sign;
    const counts = direction === "out" ? ["out", "transfer_out", "reverse_in"].includes(m.kind) : ["in", "transfer_in", "reverse_out"].includes(m.kind);
    if (!counts) continue;
    out.push({ lineId: m.doc_line_id, productId: m.product_id, lotId: m.lot_id, lotNo: no, qty: q });
  }
  return out;
}

/** Settings: lot numbers under each line of the sales invoice print (lot_tracking.print_on_invoice). */
export async function getLotPrintOnInvoice(): Promise<boolean> {
  const db = await client();
  if (!db) return false;
  const { data } = await db.from("system_settings").select("value").eq("key", "lot_tracking").limit(1);
  const value = (data?.[0] as { value?: Record<string, unknown> } | undefined)?.value;
  return value?.print_on_invoice === true;
}

/** Settings: turn the lot numbers on the sales invoice print on or off (admins, LOT_TRACKING on). */
export async function saveLotPrintOnInvoice(value: boolean): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (!isLotTrackingEnabled()) return { success: false, error: "lot_tracking_off" };
    const ctx = await requirePermissionAction("can_manage_settings");
    if (!isAdminRole(ctx.profile?.role)) throw new ActionAuthError("İcazəniz yoxdur");
    const admin = (await createSupabaseAdminClient()) as unknown as {
      from: (t: string) => {
        select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { value?: Record<string, unknown> } | null }> } };
        upsert: (row: Record<string, unknown>, o: { onConflict: string }) => PromiseLike<{ error: { message: string } | null }>;
      };
    };
    const { data } = await admin.from("system_settings").select("value").eq("key", "lot_tracking").maybeSingle();
    const { error } = await admin.from("system_settings").upsert(
      { key: "lot_tracking", value: { ...(data?.value ?? {}), print_on_invoice: value === true }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? mapRpcError(err.message) : "Failed" };
  }
}
