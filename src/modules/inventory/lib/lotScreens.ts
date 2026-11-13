/**
 * LOT-4: the pure parts of the lot screens (list rows, filters, card shaping, links, trace
 * grouping, search), so `node --test` covers them. The screens are in ../components/Lot*.tsx,
 * the reads in ../actions/lotScreens.ts and 20261115130000_lot_ui.sql.
 */
import { lotExpiry, type LotStatus } from "./lotPicker";

export type LotOriginType = "import" | "purchase" | "opening" | "production" | "count_surplus" | "return" | "manual" | "unassigned";
export const LOT_ORIGINS: readonly LotOriginType[] = ["import", "purchase", "opening", "production", "count_surplus", "return", "manual"];
export const LOT_STATUSES: readonly LotStatus[] = ["active", "quarantine", "closed"];

/** Expiry windows of the list filters. */
export const EXPIRY_WINDOWS = [
  { key: "expired", days: null },
  { key: "exp30", days: 30 },
  { key: "exp90", days: 90 },
] as const;
export type ExpiryWindow = (typeof EXPIRY_WINDOWS)[number]["key"];

/** One row of the lot list (a lot, with its balance per warehouse as `wh:<id>` keys). */
export interface LotListRecord {
  id: string;
  lot_no: string;
  supplier_batch_no: string | null;
  product_id: string;
  product_name: string;
  product_code: string | null;
  product_barcode: string | null;
  unit: string | null;
  status: LotStatus;
  origin_type: LotOriginType;
  origin_doc_no: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  import_shipment_id: string | null;
  import_shipment_no: string | null;
  customs_declaration_no: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  received_date: string | null;
  qty_received: number;
  on_hand: number;
  /** Warehouses where the lot has stock now ("A, B"). */
  warehouses: string;
  /** "expired" | "near" | null: the badge and the expiry filters. */
  expiry_state: "expired" | "near" | null;
  /** Days left until the expiry date (negative = expired), null without a date. */
  days_left: number | null;
  has_stock: "yes" | null;
  created_at: string | null;
  [warehouseKey: `wh:${string}`]: number;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const date10 = (v: unknown) => str(v)?.slice(0, 10) ?? null;

function dayNumber(iso: string): number {
  return Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);
}

/** Days from `today` to `iso` (negative when it is past). */
export function daysUntil(iso: string | null, today: string): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  return dayNumber(iso) - dayNumber(today);
}

export interface LotRowLookups {
  today: string;
  warehouseNames: ReadonlyMap<string, string>;
  supplierNames?: ReadonlyMap<string, string>;
  shipmentNumbers?: ReadonlyMap<string, string>;
}

/**
 * A stock_lots row (with products(name, code, barcode, unit) and stock_lot_balances(warehouse_id,
 * qty) embedded) → a list record.
 */
export function lotToListRecord(row: Record<string, unknown>, lk: LotRowLookups): LotListRecord {
  const product = (row.products ?? {}) as Record<string, unknown>;
  const balances = Array.isArray(row.stock_lot_balances) ? (row.stock_lot_balances as Record<string, unknown>[]) : [];
  const perWh: Record<string, number> = {};
  const whNames = new Map(lk.warehouseNames);
  for (const b of balances) {
    const wh = str(b.warehouse_id);
    if (!wh) continue;
    perWh[wh] = r3((perWh[wh] ?? 0) + num(b.qty));
    const name = str(b.warehouse_name);
    if (name && !whNames.has(wh)) whNames.set(wh, name);
  }
  const onHand = r3(Object.values(perWh).reduce((s, q) => s + q, 0));
  const exp = date10(row.exp_date);
  const state = lotExpiry(exp, lk.today);
  const status = (["active", "quarantine", "closed"].includes(String(row.status)) ? row.status : "active") as LotStatus;
  const supplierId = str(row.supplier_id);
  const shipmentId = str(row.import_shipment_id);
  const record: LotListRecord = {
    id: String(row.id),
    lot_no: String(row.lot_no ?? ""),
    supplier_batch_no: str(row.supplier_batch_no),
    product_id: String(row.product_id ?? ""),
    product_name: String(product.name ?? ""),
    product_code: str(product.code),
    product_barcode: str(product.barcode),
    unit: str(product.unit),
    status,
    origin_type: (LOT_ORIGINS as readonly string[]).includes(String(row.origin_type)) ? (row.origin_type as LotOriginType) : "manual",
    origin_doc_no: str(row.origin_doc_no),
    supplier_id: supplierId,
    supplier_name: supplierId ? (lk.supplierNames?.get(supplierId) ?? str(row.supplier_name)) : null,
    import_shipment_id: shipmentId,
    import_shipment_no: shipmentId ? (lk.shipmentNumbers?.get(shipmentId) ?? str(row.import_shipment_no)) : null,
    customs_declaration_no: str(row.customs_declaration_no),
    mfg_date: date10(row.mfg_date),
    exp_date: exp,
    received_date: date10(row.received_date),
    qty_received: num(row.qty_received),
    on_hand: onHand,
    warehouses: Object.entries(perWh)
      .filter(([, q]) => q > 0.0005)
      .map(([id]) => whNames.get(id) ?? "—")
      .sort((a, b) => a.localeCompare(b))
      .join(", "),
    expiry_state: state === "expired" ? "expired" : state === "near" ? "near" : null,
    days_left: daysUntil(exp, lk.today),
    has_stock: onHand > 0.0005 ? "yes" : null,
    created_at: str(row.created_at),
  };
  for (const [wh, q] of Object.entries(perWh)) record[`wh:${wh}`] = q;
  return record;
}

/** Ids the list rows point to (for the supplier / shipment name lookups). */
export function lotRowRefs(rows: readonly Record<string, unknown>[]): { supplierIds: string[]; shipmentIds: string[] } {
  const s = new Set<string>();
  const i = new Set<string>();
  for (const r of rows) {
    const sid = str(r.supplier_id);
    const iid = str(r.import_shipment_id);
    if (sid) s.add(sid);
    if (iid) i.add(iid);
  }
  return { supplierIds: [...s], shipmentIds: [...i] };
}

/** The conditions of an expiry window (on days_left; expired = below 0). */
export function expiryWindowConditions(key: ExpiryWindow): { field: "days_left"; op: "lt" | "gte" | "lte"; value: number }[] {
  if (key === "expired") return [{ field: "days_left", op: "lt", value: 0 }];
  const days = key === "exp30" ? 30 : 90;
  return [
    { field: "days_left", op: "gte", value: 0 },
    { field: "days_left", op: "lte", value: days },
  ];
}

// ── Links of documents ─────────────────────────────────────────────────────

/** Where a document of a lot movement or origin opens; null when it has no page. */
export function lotDocHref(docType: string | null | undefined, docId: string | null | undefined, extra: { importShipmentId?: string | null } = {}): string | null {
  if (!docType) return null;
  const id = docId ? encodeURIComponent(docId) : null;
  switch (docType) {
    case "sale":
      return id ? `/sales/${id}` : null;
    case "purchase":
      return id ? `/purchases?record=${id}` : null;
    case "import_receipt":
    case "import":
      return extra.importShipmentId ? `/imports/${encodeURIComponent(extra.importShipmentId)}` : "/imports";
    case "production_order":
    case "production_delivery":
      return id ? `/production/${id}` : null;
    case "inventory_count":
      return id ? `/inventory/counts/${id}` : null;
    case "inventory_writeoff":
      return "/products/damaged-goods";
    case "inventory_initial_balance":
      return "/warehouse/initial-balance";
    case "consignment_dispatch":
    case "consignment_settlement":
    case "consignment":
      return "/consignments";
    default:
      return null;
  }
}

/** The lot card route. */
export function lotCardHref(lotId: string): string {
  return `/inventory/lots/${encodeURIComponent(lotId)}`;
}

/** The lot list filtered by a product (products row menu "Lots"). */
export function lotsOfProductHref(productId: string): string {
  return `/inventory/lots?product=${encodeURIComponent(productId)}`;
}

// ── The card ─────────────────────────────────────────────────────────────────

export interface LotKpis {
  received: number;
  onHand: number;
  sold: number;
  writtenOff: number;
  atPartners: number;
  inProduction: number;
  movementCount: number;
}

/** lot_card_summary's JSON → the KPI tiles (rounded; never negative except on hand). */
export function lotKpis(raw: unknown): LotKpis {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pos = (x: unknown) => Math.max(0, r3(num(x)));
  return {
    received: pos(v.received),
    onHand: r3(num(v.on_hand)),
    sold: pos(v.sold),
    writtenOff: pos(v.written_off),
    atPartners: pos(v.at_partners),
    inProduction: pos(v.in_production),
    movementCount: Math.max(0, Math.round(num(v.movement_count))),
  };
}

export interface LotCardData {
  id: string;
  lotNo: string;
  supplierBatchNo: string | null;
  status: LotStatus;
  originType: LotOriginType;
  originDocType: string | null;
  originDocId: string | null;
  originDocNo: string | null;
  product: { id: string; name: string; code: string | null; barcode: string | null; unit: string | null };
  supplier: { id: string; name: string | null } | null;
  importShipment: { id: string; number: string | null } | null;
  invoiceNo: string | null;
  customsDeclarationNo: string | null;
  mfgDate: string | null;
  expDate: string | null;
  receivedDate: string | null;
  notes: string | null;
  isSystem: boolean;
  /** Material lots a production lot consumed (custom_fields.material_lots). */
  materialLots: { lotId: string; lotNo: string | null; qty: number | null }[];
  balances: { warehouseId: string; warehouseName: string; qty: number }[];
  kpis: LotKpis;
  /** Unit cost of the lot's FIFO layer: only for users who see financial figures (else undefined). */
  unitCost?: number | null;
}

/** The card data without what the user may not see (unit cost without the financial figures permission). */
export function gateLotCard(card: LotCardData, canViewFinancials: boolean): LotCardData {
  if (canViewFinancials) return card;
  const { unitCost: _hidden, ...rest } = card;
  void _hidden;
  return rest;
}

/** custom_fields.material_lots of a production lot → [{lotId, lotNo, qty}]. */
export function materialLotsOf(customFields: unknown): { lotId: string; lotNo: string | null; qty: number | null }[] {
  const cf = (customFields && typeof customFields === "object" ? customFields : {}) as Record<string, unknown>;
  const list = Array.isArray(cf.material_lots) ? (cf.material_lots as unknown[]) : [];
  return list
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((x): x is Record<string, unknown> => !!x && typeof x.lot_id === "string")
    .map((x) => ({ lotId: String(x.lot_id), lotNo: str(x.lot_no), qty: x.qty === undefined || x.qty === null ? null : r3(num(x.qty)) }));
}

// ── Trace and movements ──────────────────────────────────────────────────────

export interface TraceRow {
  counterpartyType: "customer" | "partner";
  counterpartyId: string | null;
  docType: string | null;
  docId: string | null;
  docNo: string | null;
  qty: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface TraceGroup {
  key: string;
  counterpartyType: "customer" | "partner";
  counterpartyId: string | null;
  name: string | null;
  qty: number;
  rows: TraceRow[];
}

export function traceRowFromRpc(row: Record<string, unknown>): TraceRow {
  return {
    counterpartyType: row.counterparty_type === "partner" ? "partner" : "customer",
    counterpartyId: str(row.counterparty_id),
    docType: str(row.doc_type),
    docId: str(row.doc_id),
    docNo: str(row.doc_no),
    qty: r3(num(row.qty)),
    firstDate: str(row.first_date),
    lastDate: str(row.last_date),
  };
}

/** Forward trace grouped by customer / partner, largest quantity first; documents by date. */
export function groupTrace(rows: readonly TraceRow[], names: ReadonlyMap<string, string>): TraceGroup[] {
  const groups = new Map<string, TraceGroup>();
  for (const r of rows) {
    const key = `${r.counterpartyType}:${r.counterpartyId ?? "-"}`;
    const g = groups.get(key) ?? { key, counterpartyType: r.counterpartyType, counterpartyId: r.counterpartyId, name: r.counterpartyId ? (names.get(r.counterpartyId) ?? null) : null, qty: 0, rows: [] };
    g.rows.push(r);
    g.qty = r3(g.qty + r.qty);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => String(a.firstDate ?? "").localeCompare(String(b.firstDate ?? ""))) }))
    .sort((a, b) => b.qty - a.qty || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

export type MovementKind = "in" | "out" | "transfer_in" | "transfer_out" | "reverse_in" | "reverse_out" | "correction";

export interface LotMovementRow {
  id: string;
  date: string;
  warehouseId: string;
  warehouseName: string;
  qty: number;
  balance: number;
  kind: MovementKind;
  docType: string | null;
  docId: string | null;
  docNo: string | null;
  counterpartyType: string;
  counterpartyId: string | null;
  pickMode: string;
  createdBy: string | null;
  userName: string | null;
}

export function movementFromRpc(row: Record<string, unknown>, warehouseNames: ReadonlyMap<string, string>): LotMovementRow {
  const wh = String(row.warehouse_id ?? "");
  return {
    id: String(row.id),
    date: String(row.movement_date ?? ""),
    warehouseId: wh,
    warehouseName: warehouseNames.get(wh) ?? "—",
    qty: r3(num(row.qty_delta)),
    balance: r3(num(row.running_balance)),
    kind: String(row.kind) as MovementKind,
    docType: str(row.doc_type),
    docId: str(row.doc_id),
    docNo: str(row.doc_no),
    counterpartyType: String(row.counterparty_type ?? "none"),
    counterpartyId: str(row.counterparty_id),
    pickMode: String(row.pick_mode ?? ""),
    createdBy: str(row.created_by),
    userName: null,
  };
}

/** Page size of the movements tab and the next offset (null when everything is loaded). */
export const MOVEMENTS_PAGE = 50;
export function nextMovementsOffset(loaded: number, total: number): number | null {
  return loaded < total ? loaded : null;
}

// ── Search (palette, barcode) ────────────────────────────────────────────────

/** A code worth searching lots for: 3..80 characters, no wildcards of PostgREST filters. */
export function lotSearchTerm(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (t.length < 3 || t.length > 80) return null;
  return t.replace(/[%_,()*\\]/g, "");
}

/** Of found lots, the one a scanned code means: exact lot number, else exact supplier batch when unique. */
export function exactLotMatch<L extends { id: string; lot_no: string; supplier_batch_no: string | null }>(code: string, lots: readonly L[]): L | null {
  const c = code.trim().toLowerCase();
  const byNo = lots.find((l) => l.lot_no.toLowerCase() === c);
  if (byNo) return byNo;
  const byBatch = lots.filter((l) => (l.supplier_batch_no ?? "").toLowerCase() === c);
  return byBatch.length === 1 ? byBatch[0] : null;
}

/** Where a customer / partner / supplier of a movement or trace row opens; null without a page. */
export function counterpartyHref(type: string | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  const q = encodeURIComponent(id);
  switch (type) {
    case "customer":
      return `/customers?record=${q}`;
    case "supplier":
      return `/suppliers?record=${q}`;
    case "partner":
      return "/consignments";
    default:
      return null;
  }
}

/** The product record in the products list. */
export function productHref(productId: string): string {
  return `/products?record=${encodeURIComponent(productId)}`;
}

/** Which status actions a lot offers: quarantine an active lot, release (reactivate) a quarantined or closed one, close an empty one. */
export function lotStatusActions(status: LotStatus, onHand: number): ("quarantine" | "release" | "close")[] {
  const out: ("quarantine" | "release" | "close")[] = [];
  if (status === "active") out.push("quarantine");
  if (status === "quarantine" || status === "closed") out.push("release");
  if (status !== "closed" && Math.abs(onHand) < 0.0005) out.push("close");
  return out;
}

/** The status a status action sets. */
export function statusOfAction(action: "quarantine" | "release" | "close"): LotStatus {
  return action === "quarantine" ? "quarantine" : action === "close" ? "closed" : "active";
}

/** The edit dialog's changes (only fields that differ; trimmed; empty text = null). */
export function lotEditChanges(
  before: { lotNo: string; supplierBatchNo: string | null; mfgDate: string | null; expDate: string | null; notes: string | null },
  after: { lotNo: string; supplierBatchNo: string; mfgDate: string | null; expDate: string | null; notes: string },
): { lotNo?: string; supplierBatchNo?: string | null; mfgDate?: string | null; expDate?: string | null; notes?: string | null } {
  const text = (v: string) => (v.trim() ? v.trim() : null);
  const out: ReturnType<typeof lotEditChanges> = {};
  if (after.lotNo.trim() !== before.lotNo) out.lotNo = after.lotNo.trim();
  if (text(after.supplierBatchNo) !== (before.supplierBatchNo ?? null)) out.supplierBatchNo = text(after.supplierBatchNo);
  if ((after.mfgDate ?? null) !== (before.mfgDate?.slice(0, 10) ?? null)) out.mfgDate = after.mfgDate ?? null;
  if ((after.expDate ?? null) !== (before.expDate?.slice(0, 10) ?? null)) out.expDate = after.expDate ?? null;
  if (text(after.notes) !== (before.notes ?? null)) out.notes = text(after.notes);
  return out;
}
