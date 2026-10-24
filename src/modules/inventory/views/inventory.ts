/**
 * Inventory on the view engine (NEW_UI): stock per warehouse, warehouse slips, inventory counts,
 * stock intake / opening balance documents and damage write-offs. Pure: rows come from the
 * module's own fetchers and server actions (same data and permissions as the classic pages).
 */
import { countIf, figure, money, sumIf, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
type Fetchers = Pick<ModelDef, "fetchAll" | "fetchOne">;

// ── Stock per warehouse ──────────────────────────────────────────────────────

export const STOCK_VIEW_KEY = "inventory.stock";

export interface StockRecord extends ViewRecord {
  product_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string | null;
  warehouse_id: string | null;
  warehouse_name: string;
  unit: string | null;
  on_hand: number;
  reserved: number;
  available: number;
  min_limit: number;
  buy_price: number;
  valuation: number;
  status: "in_stock" | "low" | "out";
}

/** A WarehouseStockRow (fetchWarehouseStockDashboard) → a flat record. */
export function stockToRecord(row: Record<string, unknown>): StockRecord {
  const status = row.status === "out" || row.status === "low" ? row.status : "in_stock";
  return {
    id: String(row.id),
    product_id: String(row.productId ?? ""),
    sku: String(row.sku ?? ""),
    barcode: str(row.barcode),
    name: String(row.name ?? ""),
    category: str(row.category),
    warehouse_id: str(row.warehouseId),
    warehouse_name: String(row.warehouseName ?? ""),
    unit: str(row.unit),
    on_hand: num(row.totalPhysical),
    reserved: num(row.reserved),
    available: num(row.available),
    min_limit: num(row.minLimit),
    buy_price: num(row.buyPrice),
    valuation: round(num(row.valuation)),
    status,
  };
}

export function stockDefinition(fetchers: Fetchers): ViewDefinition<StockRecord> {
  return {
    model: { key: STOCK_VIEW_KEY, table: "warehouse_stocks", module: "inventory", readPermission: "can_view_products", select: "*", order: { field: "name", dir: "asc" }, toRecord: stockToRecord, ...fetchers },
    titleKey: "inventory.pageTitle",
    fields: [
      { name: "sku", labelKey: "inventory.columns.barcodeOrCode", type: "char", searchable: true, readonly: true },
      { name: "barcode", labelKey: "inventory.engine.barcode", type: "char", searchable: true, readonly: true },
      { name: "name", labelKey: "inventory.columns.name", type: "char", searchable: true, readonly: true },
      { name: "warehouse_name", labelKey: "inventory.columns.warehouse", type: "char", groupable: true, searchable: true, readonly: true },
      { name: "category", labelKey: "inventory.columns.category", type: "char", groupable: true, searchable: true, readonly: true },
      { name: "on_hand", labelKey: "inventory.columns.qtyOnHand", type: "float", readonly: true },
      { name: "reserved", labelKey: "inventory.engine.reserved", type: "float", readonly: true },
      { name: "available", labelKey: "inventory.engine.available", type: "float", readonly: true },
      { name: "min_limit", labelKey: "inventory.engine.minLimit", type: "float", readonly: true },
      { name: "unit", labelKey: "inventory.columns.unit", type: "char", readonly: true },
      { name: "buy_price", labelKey: "inventory.engine.buyPrice", type: "monetary", readonly: true },
      { name: "valuation", labelKey: "inventory.columns.totalValue", type: "monetary", readonly: true },
      {
        name: "status",
        labelKey: "inventory.columns.statusAlert",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "in_stock", labelKey: "inventory.statusInStock", color: "#10b981" },
          { value: "low", labelKey: "inventory.statusLowStock", color: "#f59e0b" },
          { value: "out", labelKey: "inventory.statusOutOfStock", color: "#f43f5e" },
        ],
      },
    ],
    filters: [
      { key: "low", labelKey: "inventory.filters.statusLow", group: "status", conditions: () => [{ field: "status", op: "eq", value: "low" }] },
      { key: "out", labelKey: "inventory.filters.statusOut", group: "status", conditions: () => [{ field: "status", op: "eq", value: "out" }] },
      { key: "in_stock", labelKey: "inventory.statusInStock", group: "status", conditions: () => [{ field: "status", op: "eq", value: "in_stock" }] },
      { key: "reserved", labelKey: "inventory.engine.hasReserved", group: "reserved", conditions: () => [{ field: "reserved", op: "gt", value: 0 }] },
    ],
    groupBys: ["warehouse_name", "category", "status"],
    views: ["list", "kanban", "pivot", "graph"],
    list: { columns: ["sku", "name", "warehouse_name", "category", "on_hand", "reserved", "available", "unit", "valuation", "status"], sums: ["valuation"] },
    kanban: { groupBy: "status", title: "name", subtitle: "warehouse_name", amount: "valuation", fields: ["on_hand", "min_limit"] },
    form: { title: "name", fields: ["sku", "barcode", "warehouse_name", "category", "on_hand", "reserved", "available", "min_limit", "unit", "buy_price", "valuation", "status"] },
    pivot: { rows: "category", cols: "warehouse_name", measure: "valuation" },
    graph: { groupBy: "warehouse_name", measure: "valuation", type: "bar" },
  };
}

/** The classic KPI strip: distinct products, low, out of stock, total valuation. */
export function stockKpis(records: readonly StockRecord[], fmt: Formatter): Kpi[] {
  return [
    { key: "items", label: fmt.t("inventory.kpi.totalItems"), value: figure(new Set(records.map((r) => r.product_id)).size, fmt) },
    { key: "low", label: fmt.t("inventory.kpi.lowStock"), value: figure(countIf(records, (r) => r.status === "low"), fmt), filters: ["low"], filterLabel: fmt.t("inventory.engine.showLow"), tone: "attention" },
    { key: "out", label: fmt.t("inventory.kpi.outOfStock"), value: figure(countIf(records, (r) => r.status === "out"), fmt), filters: ["out"], filterLabel: fmt.t("inventory.engine.showOut"), tone: "attention" },
    { key: "value", label: fmt.t("inventory.kpi.totalValuation"), value: money(sumIf(records, (r) => r.valuation), fmt) },
  ];
}

// ── Warehouse slips ──────────────────────────────────────────────────────────

export const SLIPS_VIEW_KEY = "inventory.slips";

export interface SlipRecord extends ViewRecord {
  slip_number: string;
  type: string;
  status: "pending" | "approved" | "rejected";
  source_document_no: string | null;
  warehouse_name: string | null;
  item_count: number;
  created_at: string | null;
  approved_at: string | null;
  delivery_due_at: string | null;
}

export function slipToRecord(row: Record<string, unknown>): SlipRecord {
  const status = row.status === "approved" || row.status === "rejected" ? row.status : "pending";
  return {
    id: String(row.id),
    slip_number: String(row.slip_number ?? ""),
    type: String(row.type ?? ""),
    status,
    source_document_no: str(row.source_document_no),
    warehouse_name: str(row.warehouse_name),
    item_count: Array.isArray(row.items) ? row.items.length : 0,
    created_at: str(row.created_at),
    approved_at: str(row.approved_at),
    delivery_due_at: str(row.delivery_due_at),
  };
}

export function slipsDefinition(fetchers: Fetchers): ViewDefinition<SlipRecord> {
  return {
    model: { key: SLIPS_VIEW_KEY, table: "warehouse_slips", module: "inventory", readPermission: "can_view_warehouse_slips", writePermission: "can_approve_warehouse_slips", select: "*", order: { field: "created_at", dir: "desc" }, toRecord: slipToRecord, ...fetchers },
    titleKey: "warehouseSlips.title",
    fields: [
      { name: "slip_number", labelKey: "warehouseSlips.slipNo", type: "char", searchable: true, readonly: true },
      {
        name: "type",
        labelKey: "warehouseSlips.type",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "inbound", labelKey: "warehouseSlips.types.inbound", color: "#0ea5e9" },
          { value: "outbound", labelKey: "warehouseSlips.types.outbound", color: "#8b5cf6" },
          { value: "waste", labelKey: "warehouseSlips.types.waste", color: "#f43f5e" },
        ],
      },
      { name: "source_document_no", labelKey: "warehouseSlips.invoiceNo", type: "char", searchable: true, readonly: true },
      { name: "warehouse_name", labelKey: "warehouseSlips.warehouse", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "item_count", labelKey: "inventory.engine.lines", type: "integer", readonly: true },
      { name: "created_at", labelKey: "warehouseSlips.invoiceDate", type: "datetime", readonly: true },
      { name: "delivery_due_at", labelKey: "inventory.engine.deliveryDue", type: "datetime", readonly: true },
      { name: "approved_at", labelKey: "inventory.engine.approvedAt", type: "datetime", readonly: true },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "pending", labelKey: "warehouseSlips.tabs.pending", color: "#f59e0b" },
          { value: "approved", labelKey: "warehouseSlips.tabs.approved", color: "#10b981" },
          { value: "rejected", labelKey: "warehouseSlips.tabs.rejected", color: "#f43f5e" },
        ],
      },
    ],
    filters: [
      { key: "pending", labelKey: "warehouseSlips.tabs.pending", group: "status", conditions: () => [{ field: "status", op: "eq", value: "pending" }] },
      { key: "approved", labelKey: "warehouseSlips.tabs.approved", group: "status", conditions: () => [{ field: "status", op: "eq", value: "approved" }] },
      { key: "rejected", labelKey: "warehouseSlips.tabs.rejected", group: "status", conditions: () => [{ field: "status", op: "eq", value: "rejected" }] },
      {
        key: "late",
        labelKey: "inventory.engine.lateDelivery",
        group: "due",
        conditions: (ctx) => [
          { field: "status", op: "eq", value: "pending" },
          { field: "delivery_due_at", op: "lt", value: ctx.now },
        ],
      },
    ],
    groupBys: ["status", "type", "warehouse_name", "created_at:day", "created_at:month"],
    views: ["list", "kanban", "calendar", "graph"],
    list: { columns: ["slip_number", "type", "source_document_no", "warehouse_name", "created_at", "delivery_due_at", "status"] },
    kanban: { groupBy: "status", title: "slip_number", subtitle: "warehouse_name", fields: ["type", "source_document_no", "delivery_due_at"] },
    form: { title: "slip_number", statusField: "status", fields: ["type", "source_document_no", "warehouse_name", "item_count", "created_at", "delivery_due_at", "approved_at"] },
    graph: { groupBy: "created_at:day", measure: "__count", type: "bar" },
    calendar: { dateField: "delivery_due_at", title: "slip_number", colorField: "status", defaultMinutes: 60 },
  };
}

export function slipKpis(records: readonly SlipRecord[], fmt: Formatter, now: Date): Kpi[] {
  const today = dayStart(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const pending = records.filter((r) => r.status === "pending");
  const due = (r: SlipRecord) => (r.delivery_due_at ? new Date(r.delivery_due_at) : null);
  return [
    { key: "pending", label: fmt.t("inventory.engine.kpi.pendingSlips"), value: figure(pending.length, fmt), filters: ["pending"], filterLabel: fmt.t("inventory.engine.kpi.showPending"), tone: pending.length ? "attention" : undefined },
    { key: "late", label: fmt.t("inventory.engine.lateDelivery"), value: figure(countIf(pending, (r) => { const d = due(r); return !!d && d < now; }), fmt), filters: ["late"], filterLabel: fmt.t("inventory.engine.kpi.showLate") },
    { key: "today", label: fmt.t("inventory.engine.kpi.dueToday"), value: figure(countIf(pending, (r) => { const d = due(r); return !!d && d >= today && d < tomorrow; }), fmt), hint: fmt.t("inventory.engine.kpi.dueTodayHint") },
    { key: "approved", label: fmt.t("inventory.engine.kpi.approvedMonth"), value: figure(countIf(records, (r) => r.status === "approved" && !!r.approved_at && new Date(r.approved_at) >= monthStart(now)), fmt), filters: ["approved"], filterLabel: fmt.t("inventory.engine.kpi.showApproved"), tone: "good" },
  ];
}

// ── Inventory counts ─────────────────────────────────────────────────────────

export const COUNTS_VIEW_KEY = "inventory.counts";
export const COUNT_STATUSES = ["draft", "in_progress", "review", "posted"] as const;

export interface CountRecord extends ViewRecord {
  document_number: string;
  count_date: string | null;
  warehouse_name: string | null;
  scope: string | null;
  status: (typeof COUNT_STATUSES)[number];
  responsible_name: string | null;
  line_count: number;
  counted_count: number;
  progress: number;
  surplus: number;
  shortage: number;
  variance: number;
  created_at: string | null;
}

export function countToRecord(row: Record<string, unknown>): CountRecord {
  const lines = num(row.line_count);
  const counted = num(row.counted_count);
  const status = (COUNT_STATUSES as readonly string[]).includes(String(row.status)) ? (row.status as CountRecord["status"]) : "draft";
  return {
    id: String(row.id),
    document_number: String(row.document_number ?? ""),
    count_date: str(row.count_date),
    warehouse_name: str(row.warehouse_name),
    scope: [str(row.category_name), str(row.subcategory_name)].filter(Boolean).join(" › ") || null,
    status,
    responsible_name: str(row.responsible_name),
    line_count: lines,
    counted_count: counted,
    progress: lines > 0 ? Math.round((counted / lines) * 100) : 0,
    surplus: round(num(row.total_surplus_value)),
    shortage: round(num(row.total_shortage_value)),
    variance: round(num(row.total_variance_value)),
    created_at: str(row.created_at),
  };
}

export function countsDefinition(fetchers: Fetchers): ViewDefinition<CountRecord> {
  return {
    model: { key: COUNTS_VIEW_KEY, table: "inventory_counts", module: "inventory", readPermission: "can_writeoff_inventory", writePermission: "can_writeoff_inventory", select: "*", order: { field: "created_at", dir: "desc" }, toRecord: countToRecord, ...fetchers },
    titleKey: "inventoryCount.listTitle",
    fields: [
      { name: "document_number", labelKey: "inventoryCount.docNo", type: "char", searchable: true, readonly: true },
      { name: "count_date", labelKey: "inventoryCount.countDate", type: "date", readonly: true },
      { name: "warehouse_name", labelKey: "inventoryCount.warehouse", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "scope", labelKey: "inventoryCount.scope", type: "char", searchable: true, readonly: true },
      { name: "responsible_name", labelKey: "inventoryCount.responsible", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "progress", labelKey: "inventoryCount.progress", type: "integer", readonly: true },
      { name: "line_count", labelKey: "inventory.engine.lines", type: "integer", readonly: true },
      { name: "surplus", labelKey: "inventory.engine.surplus", type: "monetary", readonly: true },
      { name: "shortage", labelKey: "inventory.engine.shortage", type: "monetary", readonly: true },
      { name: "variance", labelKey: "inventoryCount.variance", type: "monetary", readonly: true },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "draft", labelKey: "inventoryCount.status_draft", color: "#94a3b8" },
          { value: "in_progress", labelKey: "inventoryCount.status_in_progress", color: "#0ea5e9" },
          { value: "review", labelKey: "inventoryCount.status_review", color: "#f59e0b" },
          { value: "posted", labelKey: "inventoryCount.status_posted", color: "#10b981" },
        ],
      },
    ],
    filters: [
      { key: "open", labelKey: "inventory.engine.openCounts", group: "status", conditions: () => [{ field: "status", op: "neq", value: "posted" }] },
      { key: "review", labelKey: "inventoryCount.status_review", group: "status", conditions: () => [{ field: "status", op: "eq", value: "review" }] },
      { key: "posted", labelKey: "inventoryCount.status_posted", group: "status", conditions: () => [{ field: "status", op: "eq", value: "posted" }] },
      { key: "with_variance", labelKey: "inventory.engine.withVariance", group: "variance", conditions: () => [{ field: "variance", op: "neq", value: 0 }] },
    ],
    groupBys: ["status", "warehouse_name", "responsible_name", "count_date:month"],
    views: ["list", "kanban", "pivot", "graph"],
    list: { columns: ["document_number", "count_date", "warehouse_name", "scope", "responsible_name", "progress", "variance", "status"], sums: ["surplus", "shortage", "variance"] },
    kanban: { groupBy: "status", title: "document_number", subtitle: "warehouse_name", amount: "variance", fields: ["count_date", "progress"] },
    form: { title: "document_number", statusField: "status", fields: ["count_date", "warehouse_name", "scope", "responsible_name", "progress", "line_count", "surplus", "shortage", "variance"] },
    pivot: { rows: "warehouse_name", cols: "count_date:month", measure: "variance" },
    graph: { groupBy: "count_date:month", measure: "variance", type: "bar" },
  };
}

export function countKpis(records: readonly CountRecord[], fmt: Formatter): Kpi[] {
  const posted = records.filter((r) => r.status === "posted");
  return [
    { key: "open", label: fmt.t("inventory.engine.openCounts"), value: figure(countIf(records, (r) => r.status !== "posted"), fmt), filters: ["open"], filterLabel: fmt.t("inventory.engine.kpi.showOpenCounts") },
    { key: "review", label: fmt.t("inventoryCount.status_review"), value: figure(countIf(records, (r) => r.status === "review"), fmt), filters: ["review"], filterLabel: fmt.t("inventory.engine.kpi.showReview"), tone: "attention" },
    { key: "surplus", label: fmt.t("inventory.engine.kpi.postedSurplus"), value: money(sumIf(posted, (r) => r.surplus), fmt, 2), tone: "good" },
    { key: "shortage", label: fmt.t("inventory.engine.kpi.postedShortage"), value: money(sumIf(posted, (r) => r.shortage), fmt, 2), tone: "attention" },
  ];
}

// ── Stock intake / opening balance ───────────────────────────────────────────

export const INTAKE_VIEW_KEY = "inventory.intake";

export interface IntakeRecord extends ViewRecord {
  document_number: string;
  doc_date: string | null;
  entry_type: "opening_balance" | "receipt";
  warehouse_name: string | null;
  total_amount: number;
  status: "draft" | "posted" | "cancelled";
  created_by_name: string | null;
  posted_at: string | null;
  notes: string | null;
}

export function intakeToRecord(row: Record<string, unknown>): IntakeRecord {
  return {
    id: String(row.id),
    document_number: String(row.document_number ?? ""),
    doc_date: str(row.doc_date),
    entry_type: row.entry_type === "receipt" ? "receipt" : "opening_balance",
    warehouse_name: str(row.warehouse_name),
    total_amount: round(num(row.total_amount)),
    status: row.status === "posted" ? "posted" : row.status === "cancelled" ? "cancelled" : "draft",
    created_by_name: str(row.created_by_name),
    posted_at: str(row.posted_at),
    notes: str(row.notes),
  };
}

export function intakeDefinition(fetchers: Fetchers): ViewDefinition<IntakeRecord> {
  return {
    model: { key: INTAKE_VIEW_KEY, table: "inventory_initial_balances", module: "inventory", readPermission: "can_manage_products", writePermission: "can_manage_products", select: "*", order: { field: "created_at", dir: "desc" }, toRecord: intakeToRecord, ...fetchers },
    titleKey: "initialBalance.listTitle",
    fields: [
      { name: "document_number", labelKey: "initialBalance.docNo", type: "char", searchable: true, readonly: true },
      { name: "doc_date", labelKey: "common.date", type: "date", readonly: true },
      {
        name: "entry_type",
        labelKey: "initialBalance.entryType",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "opening_balance", labelKey: "initialBalance.entryTypeOpeningBalance", color: "#8b5cf6" },
          { value: "receipt", labelKey: "initialBalance.entryTypeReceipt", color: "#0ea5e9" },
        ],
      },
      { name: "warehouse_name", labelKey: "inventoryCount.warehouse", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "total_amount", labelKey: "initialBalance.totalValue", type: "monetary", readonly: true },
      { name: "created_by_name", labelKey: "initialBalance.createdBy", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "posted_at", labelKey: "inventory.engine.postedAt", type: "datetime", readonly: true },
      { name: "notes", labelKey: "inventoryCount.notes", type: "text", searchable: true, readonly: true },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "draft", labelKey: "initialBalance.statusDraft", color: "#94a3b8" },
          { value: "posted", labelKey: "initialBalance.statusPosted", color: "#10b981" },
          { value: "cancelled", labelKey: "initialBalance.statusCancelled", color: "#f43f5e" },
        ],
      },
    ],
    filters: [
      { key: "draft", labelKey: "initialBalance.statusDraft", group: "status", conditions: () => [{ field: "status", op: "eq", value: "draft" }] },
      { key: "posted", labelKey: "initialBalance.statusPosted", group: "status", conditions: () => [{ field: "status", op: "eq", value: "posted" }] },
      { key: "receipt", labelKey: "initialBalance.entryTypeReceipt", group: "type", conditions: () => [{ field: "entry_type", op: "eq", value: "receipt" }] },
      { key: "opening", labelKey: "initialBalance.entryTypeOpeningBalance", group: "type", conditions: () => [{ field: "entry_type", op: "eq", value: "opening_balance" }] },
    ],
    groupBys: ["status", "entry_type", "warehouse_name", "created_by_name", "doc_date:month"],
    views: ["list", "pivot", "graph", "calendar"],
    list: { columns: ["document_number", "doc_date", "entry_type", "warehouse_name", "total_amount", "status", "created_by_name"], sums: ["total_amount"] },
    form: { title: "document_number", statusField: "status", fields: ["doc_date", "entry_type", "warehouse_name", "total_amount", "created_by_name", "posted_at", "notes"] },
    pivot: { rows: "warehouse_name", cols: "entry_type", measure: "total_amount" },
    graph: { groupBy: "doc_date:month", measure: "total_amount", type: "bar" },
    calendar: { dateField: "doc_date", title: "document_number", colorField: "status" },
  };
}

export function intakeKpis(records: readonly IntakeRecord[], fmt: Formatter, now: Date): Kpi[] {
  const posted = records.filter((r) => r.status === "posted");
  const thisMonth = (r: IntakeRecord) => !!r.doc_date && new Date(`${r.doc_date.slice(0, 10)}T00:00:00`) >= monthStart(now);
  return [
    { key: "drafts", label: fmt.t("initialBalance.statusDraft"), value: figure(countIf(records, (r) => r.status === "draft"), fmt), filters: ["draft"], filterLabel: fmt.t("sales.engine.dashboard.showDrafts") },
    { key: "receipts", label: fmt.t("inventory.engine.kpi.receiptsMonth"), value: money(sumIf(posted, (r) => r.total_amount, (r) => r.entry_type === "receipt" && thisMonth(r)), fmt) },
    { key: "opening", label: fmt.t("inventory.engine.kpi.openingTotal"), value: money(sumIf(posted, (r) => r.total_amount, (r) => r.entry_type === "opening_balance"), fmt) },
    { key: "posted", label: fmt.t("initialBalance.statusPosted"), value: figure(posted.length, fmt), filters: ["posted"], filterLabel: fmt.t("inventory.engine.kpi.showPosted") },
  ];
}

// ── Damage write-offs ────────────────────────────────────────────────────────

export const WRITEOFFS_VIEW_KEY = "inventory.writeoffs";

export interface WriteoffViewRecord extends ViewRecord {
  document_number: string;
  writeoff_date: string | null;
  warehouse_name: string | null;
  checker_name: string;
  item_count: number;
  quantity: number;
  notes: string | null;
  created_at: string | null;
}

/** A WriteoffRecord plus its warehouse name (the classic list looks it up the same way). */
export function writeoffToRecord(row: Record<string, unknown>): WriteoffViewRecord {
  const items = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : [];
  return {
    id: String(row.id),
    document_number: String(row.document_number ?? ""),
    writeoff_date: str(row.writeoff_date),
    warehouse_name: str(row.warehouse_name),
    checker_name: String(row.checker_name ?? ""),
    item_count: items.length,
    quantity: round(items.reduce((s, i) => s + num(i.quantity), 0)),
    notes: str(row.notes),
    created_at: str(row.created_at),
  };
}

export function writeoffsDefinition(fetchers: Fetchers): ViewDefinition<WriteoffViewRecord> {
  return {
    model: { key: WRITEOFFS_VIEW_KEY, table: "inventory_writeoffs", module: "inventory", readPermission: "can_writeoff_inventory", writePermission: "can_writeoff_inventory", select: "*", order: { field: "created_at", dir: "desc" }, toRecord: writeoffToRecord, ...fetchers },
    titleKey: "damagedGoods.pageTitle",
    fields: [
      { name: "document_number", labelKey: "inventoryCount.docNo", type: "char", searchable: true, readonly: true },
      { name: "writeoff_date", labelKey: "common.date", type: "date", readonly: true },
      { name: "warehouse_name", labelKey: "inventoryCount.warehouse", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "checker_name", labelKey: "inventory.engine.checker", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "item_count", labelKey: "inventory.engine.lines", type: "integer", readonly: true },
      { name: "quantity", labelKey: "inventory.engine.quantity", type: "float", readonly: true },
      { name: "notes", labelKey: "inventoryCount.notes", type: "text", searchable: true, readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
    ],
    filters: [
      { key: "this_month", labelKey: "sales.engine.filters.thisMonth", group: "date", conditions: (ctx) => [{ field: "writeoff_date", op: "gte", value: monthStart(ctx.now) }] },
    ],
    groupBys: ["warehouse_name", "checker_name", "writeoff_date:month"],
    views: ["list", "graph", "calendar"],
    list: { columns: ["document_number", "writeoff_date", "warehouse_name", "checker_name", "item_count", "quantity"], sums: ["quantity"] },
    form: { title: "document_number", fields: ["writeoff_date", "warehouse_name", "checker_name", "item_count", "quantity", "notes"] },
    graph: { groupBy: "writeoff_date:month", measure: "quantity", type: "bar" },
    calendar: { dateField: "writeoff_date", title: "document_number" },
  };
}

export function writeoffKpis(records: readonly WriteoffViewRecord[], fmt: Formatter, now: Date): Kpi[] {
  const month = (r: WriteoffViewRecord) => !!r.writeoff_date && new Date(`${r.writeoff_date.slice(0, 10)}T00:00:00`) >= monthStart(now);
  return [
    { key: "month", label: fmt.t("inventory.engine.kpi.writeoffsMonth"), value: figure(countIf(records, month), fmt), filters: ["this_month"], filterLabel: fmt.t("inventory.engine.kpi.showWriteoffsMonth") },
    { key: "qty", label: fmt.t("inventory.engine.kpi.writtenOffQty"), value: figure(sumIf(records, (r) => r.quantity, month), fmt, 2), hint: fmt.t("inventory.engine.kpi.writtenOffQtyHint") },
    { key: "all", label: fmt.t("inventory.engine.kpi.allWriteoffs"), value: figure(records.length, fmt) },
  ];
}
