"use server";

import { ActionAuthError, mapRpcError, requirePermissionAction, type ActionAuthContext } from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { canViewFinancials } from "@/lib/auth/permissionMatrix";
import { isLotTrackingEnabled, lotTrackingActive, lotTrackingAudience } from "@/lib/features/lotTracking";
import { fetchProfileDisplayNames, type ProfileNamesClient } from "@/lib/profiles/displayNames";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { isAdminRole } from "@/types/database.types";
import {
  gateLotCard,
  lotKpis,
  lotRowRefs,
  lotSearchTerm,
  materialLotsOf,
  movementFromRpc,
  MOVEMENTS_PAGE,
  traceRowFromRpc,
  type LotCardData,
  type LotMovementRow,
  type LotOriginType,
  type TraceRow,
} from "../lib/lotScreens";
import type { LotStatus } from "../lib/lotPicker";

/**
 * LOT-4: reads and actions of the lot screens. Every call needs LOT_TRACKING on for this user
 * (its audience) and lots.view (can_view_lots); edits need lots.manage. Lot data is read with the
 * user's session, so row-level security (lots_can) applies; only the names of linked records
 * (warehouses, suppliers, customers, partners, shipments) come from the service client.
 */

export type LotActionResult<T> = { success: true; data: T } | { success: false; error: string };

type Q = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> & {
  eq: (c: string, v: unknown) => Q;
  neq: (c: string, v: unknown) => Q;
  in: (c: string, v: unknown[]) => Q;
  or: (f: string) => Q;
  order: (c: string, o?: { ascending?: boolean }) => Q;
  limit: (n: number) => Q;
  range: (a: number, b: number) => Q;
  maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
type Db = {
  from: (t: string) => { select: (c: string) => Q };
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

const rows = (d: unknown) => (Array.isArray(d) ? (d as Record<string, unknown>[]) : []);
const LIST_LIMIT = 5000;

async function requireLots(action: "view" | "manage" = "view"): Promise<ActionAuthContext> {
  if (!isLotTrackingEnabled()) throw new ActionAuthError("lots.screens.errors.disabled");
  const ctx = await requirePermissionAction(action === "manage" ? "can_manage_lots" : "can_view_lots");
  if (!lotTrackingActive({ enabled: true, audience: lotTrackingAudience(), isAdmin: isAdminRole(ctx.profile?.role) })) {
    throw new ActionAuthError("lots.screens.errors.disabled");
  }
  return ctx;
}

function fail(err: unknown): { success: false; error: string } {
  if (err instanceof ActionAuthError) return { success: false, error: err.message };
  return { success: false, error: err instanceof Error ? mapRpcError(err.message) : "Failed" };
}

async function userDb(): Promise<Db> {
  return (await createSupabaseServerClient()) as unknown as Db;
}
async function adminDb(): Promise<Db> {
  return (await createSupabaseAdminClient()) as unknown as Db;
}

/** Names of records by id (id → label), empty when the table is missing (module off). */
async function names(db: Db, table: string, ids: readonly string[], cols: string, label: (r: Record<string, unknown>) => string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(isValidUuid))];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await db.from(table).select(`id, ${cols}`).in("id", unique.slice(i, i + 200));
    if (error) break;
    for (const r of rows(data)) {
      const l = label(r);
      if (l) out.set(String(r.id), l);
    }
  }
  return out;
}

async function warehouseNames(db: Db): Promise<Map<string, string>> {
  const { data } = await db.from("warehouses").select("id, name").limit(1000);
  return new Map(rows(data).map((w) => [String(w.id), String(w.name ?? "")]));
}

// ── List ─────────────────────────────────────────────────────────────────────

/** The warehouses (id, name) for the list's warehouse filters. */
export async function lotWarehousesAction(): Promise<LotActionResult<{ id: string; name: string }[]>> {
  try {
    await requireLots();
    const wh = await warehouseNames(await adminDb());
    return { success: true, data: [...wh.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The lots for the list (newest first, at most 5000), each with its product, balances per
 * warehouse (with names), supplier name and import shipment number. `productId` limits it to
 * one product (products row menu "Lots").
 */
export async function listLotsAction(productId?: string | null): Promise<LotActionResult<{ rows: Record<string, unknown>[]; warehouses: { id: string; name: string }[] }>> {
  try {
    await requireLots();
    const db = await userDb();
    let query = db
      .from("stock_lots")
      .select(
        "id, lot_no, supplier_batch_no, product_id, status, origin_type, origin_doc_type, origin_doc_id, origin_doc_no, supplier_id, import_shipment_id, customs_declaration_no, mfg_date, exp_date, received_date, qty_received, created_at, products(name, code, barcode, unit), stock_lot_balances(warehouse_id, qty)",
      )
      .in("origin_type", ["import", "purchase", "opening", "production", "count_surplus", "return", "manual"]);
    if (productId && isValidUuid(productId)) query = query.eq("product_id", productId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(LIST_LIMIT);
    if (error) throw new Error(error.message);
    const list = rows(data);
    const admin = await adminDb();
    const refs = lotRowRefs(list);
    const [wh, suppliers, shipments] = await Promise.all([
      warehouseNames(admin),
      names(admin, "suppliers", refs.supplierIds, "full_name, company_name", (r) => (r.company_name as string) || (r.full_name as string) || null),
      names(admin, "import_shipments", refs.shipmentIds, "number", (r) => (r.number as string) || null),
    ]);
    return {
      success: true,
      data: {
        rows: list.map((r) => ({
          ...r,
          supplier_name: r.supplier_id ? (suppliers.get(String(r.supplier_id)) ?? null) : null,
          import_shipment_no: r.import_shipment_id ? (shipments.get(String(r.import_shipment_id)) ?? null) : null,
          stock_lot_balances: rows(r.stock_lot_balances).map((b) => ({ ...b, warehouse_name: wh.get(String(b.warehouse_id)) ?? null })),
        })),
        warehouses: [...wh.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  } catch (err) {
    return fail(err);
  }
}

// ── Card ─────────────────────────────────────────────────────────────────────

/** The lot card: header, origin links, balances per warehouse, key figures (unit cost only with financial figures). */
export async function getLotCardAction(lotId: string): Promise<LotActionResult<LotCardData & { canManage: boolean; isAdmin: boolean }>> {
  try {
    const ctx = await requireLots();
    if (!isValidUuid(lotId)) return { success: false, error: "lots.screens.errors.notFound" };
    const db = await userDb();
    const { data: lotRow, error } = await db
      .from("stock_lots")
      .select("*, products(id, name, code, barcode, unit), stock_lot_balances(warehouse_id, qty)")
      .eq("id", lotId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lotRow) return { success: false, error: "lots.screens.errors.notFound" };
    const lot = lotRow as Record<string, unknown>;
    const product = (lot.products ?? {}) as Record<string, unknown>;
    const summary = await db.rpc("lot_card_summary", { p_lot: lotId });
    if (summary.error) throw new Error(summary.error.message);

    const admin = await adminDb();
    const supplierId = typeof lot.supplier_id === "string" ? lot.supplier_id : null;
    const shipmentId = typeof lot.import_shipment_id === "string" ? lot.import_shipment_id : null;
    const [wh, suppliers, shipment, purchase] = await Promise.all([
      warehouseNames(admin),
      supplierId ? names(admin, "suppliers", [supplierId], "full_name, company_name", (r) => (r.company_name as string) || (r.full_name as string) || null) : Promise.resolve(new Map<string, string>()),
      shipmentId ? admin.from("import_shipments").select("number, invoice_no").eq("id", shipmentId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      lot.origin_doc_type === "purchase" && typeof lot.origin_doc_id === "string"
        ? admin.from("purchases").select("invoice_number").eq("id", lot.origin_doc_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const ship = (shipment.data ?? null) as Record<string, unknown> | null;
    const pur = (purchase.data ?? null) as Record<string, unknown> | null;

    const financials = isAdminRole(ctx.profile?.role) || canViewFinancials(ctx.profile);
    let unitCost: number | null = null;
    if (financials && typeof lot.inventory_batch_id === "string") {
      const { data: batch } = await admin.from("inventory_batches").select("unit_cost").eq("id", lot.inventory_batch_id).maybeSingle();
      const c = Number((batch as Record<string, unknown> | null)?.unit_cost);
      unitCost = Number.isFinite(c) ? c : null;
    }

    const card: LotCardData = {
      id: String(lot.id),
      lotNo: String(lot.lot_no ?? ""),
      supplierBatchNo: (lot.supplier_batch_no as string) || null,
      status: (["active", "quarantine", "closed"].includes(String(lot.status)) ? lot.status : "active") as LotStatus,
      originType: String(lot.origin_type) as LotOriginType,
      originDocType: (lot.origin_doc_type as string) || null,
      originDocId: (lot.origin_doc_id as string) || null,
      originDocNo: (lot.origin_doc_no as string) || null,
      product: {
        id: String(lot.product_id),
        name: String(product.name ?? ""),
        code: (product.code as string) || null,
        barcode: (product.barcode as string) || null,
        unit: (product.unit as string) || null,
      },
      supplier: supplierId ? { id: supplierId, name: suppliers.get(supplierId) ?? null } : null,
      importShipment: shipmentId ? { id: shipmentId, number: (ship?.number as string) || null } : null,
      invoiceNo: (ship?.invoice_no as string) || (pur?.invoice_number as string) || null,
      customsDeclarationNo: (lot.customs_declaration_no as string) || null,
      mfgDate: (lot.mfg_date as string) || null,
      expDate: (lot.exp_date as string) || null,
      receivedDate: (lot.received_date as string) || null,
      notes: (lot.notes as string) || null,
      isSystem: lot.origin_type === "unassigned",
      materialLots: materialLotsOf(lot.custom_fields),
      balances: rows(lot.stock_lot_balances)
        .filter((b) => Math.abs(Number(b.qty) || 0) > 0.0005)
        .map((b) => ({ warehouseId: String(b.warehouse_id), warehouseName: wh.get(String(b.warehouse_id)) ?? "—", qty: Math.round((Number(b.qty) || 0) * 1000) / 1000 }))
        .sort((a, b) => b.qty - a.qty),
      kpis: lotKpis(summary.data),
      unitCost,
    };
    const manage = await db.rpc("lots_can", { p_action: "manage" });
    return { success: true, data: { ...gateLotCard(card, financials), canManage: manage.data === true, isAdmin: isAdminRole(ctx.profile?.role) } };
  } catch (err) {
    return fail(err);
  }
}

/** One page of the lot's movements (newest first) with running balance, users and counterparties. */
export async function lotMovementsAction(lotId: string, offset = 0): Promise<LotActionResult<{ rows: LotMovementRow[]; total: number; counterparties: Record<string, string> }>> {
  try {
    await requireLots();
    if (!isValidUuid(lotId)) return { success: false, error: "lots.screens.errors.notFound" };
    const db = await userDb();
    const { data, error } = await db.rpc("lot_movements_page", { p_lot: lotId, p_limit: MOVEMENTS_PAGE, p_offset: Math.max(0, Math.floor(offset)) });
    if (error) throw new Error(error.message);
    const raw = rows(data);
    const admin = await adminDb();
    const wh = await warehouseNames(admin);
    const list = raw.map((r) => movementFromRpc(r, wh));
    const [users, counterparties] = await Promise.all([
      fetchProfileDisplayNames(admin as unknown as ProfileNamesClient, list.map((m) => m.createdBy).filter((x): x is string => !!x)),
      counterpartyNames(admin, list.map((m) => ({ type: m.counterpartyType, id: m.counterpartyId }))),
    ]);
    for (const m of list) m.userName = m.createdBy ? (users.get(m.createdBy.toLowerCase()) ?? users.get(m.createdBy) ?? null) : null;
    return { success: true, data: { rows: list, total: Number(raw[0]?.total_count ?? 0), counterparties: Object.fromEntries(counterparties) } };
  } catch (err) {
    return fail(err);
  }
}

async function counterpartyNames(admin: Db, refs: readonly { type: string; id: string | null }[]): Promise<Map<string, string>> {
  const ids = (type: string) => refs.filter((r) => r.type === type && r.id).map((r) => r.id as string);
  const [customers, partners, suppliers, warehouses] = await Promise.all([
    names(admin, "customers", ids("customer"), "full_name, company_name", (r) => (r.company_name as string) || (r.full_name as string) || null),
    names(admin, "consignment_partners", ids("partner"), "name, company_name", (r) => (r.company_name as string) || (r.name as string) || null),
    names(admin, "suppliers", ids("supplier"), "full_name, company_name", (r) => (r.company_name as string) || (r.full_name as string) || null),
    names(admin, "warehouses", ids("warehouse"), "name", (r) => (r.name as string) || null),
  ]);
  return new Map([...customers, ...partners, ...suppliers, ...warehouses]);
}

/** Forward trace: customers and partners that got the lot, per document, with names. */
export async function lotTraceAction(lotId: string): Promise<LotActionResult<{ rows: TraceRow[]; names: Record<string, string> }>> {
  try {
    await requireLots();
    if (!isValidUuid(lotId)) return { success: false, error: "lots.screens.errors.notFound" };
    const db = await userDb();
    const { data, error } = await db.rpc("lot_trace_forward", { p_lot: lotId });
    if (error) throw new Error(error.message);
    const list = rows(data).map(traceRowFromRpc);
    const found = await counterpartyNames(await adminDb(), list.map((r) => ({ type: r.counterpartyType, id: r.counterpartyId })));
    return { success: true, data: { rows: list, names: Object.fromEntries(found) } };
  } catch (err) {
    return fail(err);
  }
}

export interface LotEventRow {
  id: string;
  event: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
  userName: string | null;
}

/** The lot's history (stock_lot_events), newest first. */
export async function lotEventsAction(lotId: string): Promise<LotActionResult<LotEventRow[]>> {
  try {
    await requireLots();
    if (!isValidUuid(lotId)) return { success: false, error: "lots.screens.errors.notFound" };
    const db = await userDb();
    const { data, error } = await db.from("stock_lot_events").select("id, event, old_values, new_values, reason, created_by, created_at").eq("lot_id", lotId).order("created_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    const list = rows(data);
    const users = await fetchProfileDisplayNames((await adminDb()) as unknown as ProfileNamesClient, list.map((r) => String(r.created_by ?? "")));
    return {
      success: true,
      data: list.map((r) => ({
        id: String(r.id),
        event: String(r.event),
        oldValues: (r.old_values as Record<string, unknown>) ?? null,
        newValues: (r.new_values as Record<string, unknown>) ?? null,
        reason: (r.reason as string) || null,
        createdAt: String(r.created_at ?? ""),
        userName: r.created_by ? (users.get(String(r.created_by).toLowerCase()) ?? null) : null,
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

// ── Edits (lots.manage) ──────────────────────────────────────────────────────

export interface LotEditInput {
  lotNo?: string;
  supplierBatchNo?: string | null;
  mfgDate?: string | null;
  expDate?: string | null;
  notes?: string | null;
}

/** lot_update with a reason (the database logs it in stock_lot_events and audit_logs). */
export async function updateLotAction(lotId: string, input: LotEditInput, reason: string): Promise<LotActionResult<{ lotNo: string }>> {
  try {
    await requireLots("manage");
    if (!isValidUuid(lotId)) return { success: false, error: "lots.screens.errors.notFound" };
    const why = (reason ?? "").trim();
    if (!why) return { success: false, error: "lots.screens.errors.reasonRequired" };
    const fields: Record<string, unknown> = {};
    if (input.lotNo !== undefined) fields.lot_no = input.lotNo;
    if (input.supplierBatchNo !== undefined) fields.supplier_batch_no = input.supplierBatchNo;
    if (input.mfgDate !== undefined) fields.mfg_date = input.mfgDate;
    if (input.expDate !== undefined) fields.exp_date = input.expDate;
    if (input.notes !== undefined) fields.notes = input.notes;
    const db = await userDb();
    const { data, error } = await db.rpc("lot_update", { p_lot_id: lotId, p_fields: fields, p_reason: why });
    if (error) return { success: false, error: error.message };
    return { success: true, data: { lotNo: String((data as Record<string, unknown> | null)?.lot_no ?? "") } };
  } catch (err) {
    return fail(err);
  }
}

/** Quarantine / release / close a lot (lot_set_status, with a reason). */
export async function setLotStatusAction(lotId: string, status: LotStatus, reason: string): Promise<LotActionResult<{ status: LotStatus }>> {
  try {
    await requireLots("manage");
    if (!isValidUuid(lotId)) return { success: false, error: "lots.screens.errors.notFound" };
    if (!["active", "quarantine", "closed"].includes(status)) return { success: false, error: "lots.screens.errors.badStatus" };
    const db = await userDb();
    const { error } = await db.rpc("lot_set_status", { p_lot_id: lotId, p_status: status, p_reason: (reason ?? "").trim() || null });
    if (error) return { success: false, error: error.message };
    return { success: true, data: { status } };
  } catch (err) {
    return fail(err);
  }
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface FoundLot {
  id: string;
  lot_no: string;
  supplier_batch_no: string | null;
  product_name: string;
  status: LotStatus;
}

/** Lots whose number or supplier batch starts with the code (palette, barcode scan); [] when not allowed. */
export async function findLotsAction(code: string): Promise<FoundLot[]> {
  const term = lotSearchTerm(code);
  if (!term) return [];
  try {
    await requireLots();
  } catch {
    return [];
  }
  const db = await userDb();
  const { data, error } = await db
    .from("stock_lots")
    .select("id, lot_no, supplier_batch_no, status, products(name)")
    .or(`lot_no.ilike.${term}%,supplier_batch_no.ilike.${term}%`)
    .neq("origin_type", "unassigned")
    .limit(8);
  if (error) return [];
  return rows(data).map((r) => ({
    id: String(r.id),
    lot_no: String(r.lot_no ?? ""),
    supplier_batch_no: (r.supplier_batch_no as string) || null,
    product_name: String(((r.products ?? {}) as Record<string, unknown>).name ?? ""),
    status: String(r.status) as LotStatus,
  }));
}
