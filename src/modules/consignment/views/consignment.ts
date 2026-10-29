/**
 * Consignment on the view engine (NEW_UI): stock held at partners and the document history
 * (dispatches, returns, monthly sales reports, opening balances), with the classic dashboard
 * figures. Pure: rows come from the module's own server actions (same data and permission).
 */
import { countIf, figure, money, sumIf, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export const STOCK_VIEW_KEY = "consignment.stock";
export const DOCS_VIEW_KEY = "consignment.documents";
type Fetchers = Pick<ModelDef, "fetchAll" | "fetchOne">;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const round = (n: number) => Math.round(n * 100) / 100;

/** Value of document lines, as the classic page computes it (quantity × unit price). */
export const linesValue = (items: unknown): number =>
  round((Array.isArray(items) ? (items as Record<string, unknown>[]) : []).reduce((s, i) => s + num(i.quantity) * num(i.unit_price), 0));

/** The classic "this month" period (YYYY-MM). */
export const periodOf = (d: Date) => d.toISOString().slice(0, 7);

// ── Stock at partners ────────────────────────────────────────────────────────

export interface PartnerStockRecord extends ViewRecord {
  partner_id: string;
  partner_name: string | null;
  product_code: string | null;
  product_name: string;
  category: string | null;
  unit: string | null;
  delivered: number;
  sold: number;
  returned: number;
  remaining: number;
  unit_price: number;
  value: number;
  last_dispatch_at: string | null;
  aging_days: number;
  is_aging: boolean;
}

export function partnerStockToRecord(row: Record<string, unknown>): PartnerStockRecord {
  const remaining = num(row.remaining_qty);
  const price = num(row.unit_price);
  return {
    id: String(row.id),
    partner_id: String(row.partner_id ?? ""),
    partner_name: str(row.partner_name),
    product_code: str(row.product_code),
    product_name: String(row.product_name ?? ""),
    category: str(row.category),
    unit: str(row.unit),
    delivered: num(row.delivered_qty),
    sold: num(row.sold_qty),
    returned: num(row.returned_qty),
    remaining,
    unit_price: price,
    value: round(remaining * price),
    last_dispatch_at: str(row.last_dispatch_at),
    aging_days: num(row.aging_days),
    is_aging: row.is_aging === true,
  };
}

export function partnerStockDefinition(fetchers: Fetchers): ViewDefinition<PartnerStockRecord> {
  return {
    model: { key: STOCK_VIEW_KEY, table: "consignment_inventory", module: "consignment", readPermission: "can_view_consignments", select: "*", order: { field: "product_name", dir: "asc" }, toRecord: partnerStockToRecord, ...fetchers },
    titleKey: "consignments.tabStock",
    fields: [
      { name: "partner_id", labelKey: "consignments.partner", type: "many2one", displayField: "partner_name", searchable: true, groupable: true, readonly: true },
      { name: "product_code", labelKey: "inventory.columns.barcodeOrCode", type: "char", searchable: true, readonly: true },
      { name: "product_name", labelKey: "dashboard.product", type: "char", searchable: true, readonly: true },
      { name: "category", labelKey: "inventory.columns.category", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "delivered", labelKey: "consignments.sent", type: "float", readonly: true },
      { name: "sold", labelKey: "consignments.sold", type: "float", readonly: true },
      { name: "returned", labelKey: "consignments.returned", type: "float", readonly: true },
      { name: "remaining", labelKey: "consignments.remaining", type: "float", readonly: true },
      { name: "unit", labelKey: "inventory.columns.unit", type: "char", readonly: true },
      { name: "unit_price", labelKey: "modals.salesView.price", type: "monetary", readonly: true },
      { name: "value", labelKey: "consignments.stockValue", type: "monetary", readonly: true },
      { name: "last_dispatch_at", labelKey: "consignment.engine.lastDispatch", type: "date", readonly: true },
      { name: "aging_days", labelKey: "consignments.aging", type: "integer", readonly: true },
      { name: "is_aging", labelKey: "consignments.agingTitle", type: "boolean", groupable: true, readonly: true },
    ],
    filters: [
      { key: "aging", labelKey: "consignments.agingTitle", group: "aging", conditions: () => [{ field: "is_aging", op: "eq", value: true }, { field: "remaining", op: "gt", value: 0 }] },
      { key: "in_stock", labelKey: "consignment.engine.withRemaining", group: "stock", conditions: () => [{ field: "remaining", op: "gt", value: 0 }] },
    ],
    groupBys: ["partner_id", "category", "is_aging"],
    views: ["list", "pivot", "graph"],
    list: { columns: ["partner_id", "product_code", "product_name", "category", "delivered", "sold", "returned", "remaining", "value", "aging_days"], sums: ["delivered", "sold", "returned", "remaining", "value"] },
    form: { title: "product_name", fields: ["partner_id", "product_code", "category", "delivered", "sold", "returned", "remaining", "unit", "unit_price", "value", "last_dispatch_at", "aging_days"] },
    pivot: { rows: "partner_id", cols: "category", measure: "value" },
    graph: { groupBy: "partner_id", measure: "value", type: "bar" },
  };
}

// ── Documents ────────────────────────────────────────────────────────────────

export type ConsignmentDocType = "DISPATCH" | "RETURN" | "ACTUAL_SALE" | "INITIAL_BALANCE";

export interface ConsignmentDocRecord extends ViewRecord {
  /** Id of the source row (dispatch, return or report). */
  source_id: string;
  document_type: ConsignmentDocType;
  doc_no: string;
  partner_id: string | null;
  partner_name: string | null;
  sales_rep_name: string | null;
  date: string | null;
  total_value: number;
  line_count: number;
  created_at: string | null;
  /** Prompt 24c: creator id of the source row; the name is filled by the view data layer. */
  created_by: string | null;
  created_by_name: string | null;
}

/** The classic history: dispatches (opening balances apart), returns and monthly reports. */
export function consignmentDocuments(dispatches: readonly Record<string, unknown>[], returns: readonly Record<string, unknown>[], reports: readonly Record<string, unknown>[]): ConsignmentDocRecord[] {
  const out: ConsignmentDocRecord[] = [
    ...dispatches.map((d) => ({
      id: `dispatch-${d.id}`,
      source_id: String(d.id),
      document_type: (d.status === "initial_balance" ? "INITIAL_BALANCE" : "DISPATCH") as ConsignmentDocType,
      doc_no: String(d.dispatch_no ?? ""),
      partner_id: str(d.partner_id),
      partner_name: str(d.partner_name),
      sales_rep_name: str(d.sales_rep_name),
      date: str(d.dispatch_date),
      total_value: linesValue(d.items),
      line_count: Array.isArray(d.items) ? d.items.length : 0,
      created_at: str(d.created_at),
      created_by: str(d.created_by),
      created_by_name: null,
    })),
    ...returns.map((r) => ({
      id: `return-${r.id}`,
      source_id: String(r.id),
      document_type: "RETURN" as ConsignmentDocType,
      doc_no: String(r.return_no ?? ""),
      partner_id: str(r.partner_id),
      partner_name: str(r.partner_name),
      sales_rep_name: null,
      date: str(r.return_date),
      total_value: linesValue(r.items),
      line_count: Array.isArray(r.items) ? r.items.length : 0,
      created_at: str(r.created_at),
      created_by: str(r.created_by),
      created_by_name: null,
    })),
    ...reports.map((p) => ({
      id: `report-${p.id}`,
      source_id: String(p.id),
      document_type: "ACTUAL_SALE" as ConsignmentDocType,
      doc_no: String(p.report_no ?? ""),
      partner_id: str(p.partner_id),
      partner_name: str(p.partner_name),
      sales_rep_name: str(p.sales_rep_name),
      date: p.report_period ? `${p.report_period}-01` : null,
      total_value: round(num(p.total_amount)),
      line_count: Array.isArray(p.sold_items) ? p.sold_items.length : 0,
      created_at: str(p.created_at),
      created_by: str(p.created_by),
      created_by_name: null,
    })),
  ];
  // Newest first, as the classic history.
  return out.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export function documentsDefinition(fetchers: Fetchers): ViewDefinition<ConsignmentDocRecord> {
  return {
    model: { key: DOCS_VIEW_KEY, table: "consignment_dispatches", module: "consignment", readPermission: "can_view_consignments", writePermission: "can_manage_consignments", select: "*", order: { field: "date", dir: "desc" }, toRecord: (r) => r as ConsignmentDocRecord, userFields: { created_by: "created_by_name" }, ...fetchers },
    titleKey: "consignments.tabHistory",
    fields: [
      { name: "doc_no", labelKey: "consignments.docNo", type: "char", searchable: true, readonly: true },
      {
        name: "document_type",
        labelKey: "consignments.docType",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "DISPATCH", labelKey: "consignments.opTypeDispatch", color: "#0ea5e9" },
          { value: "ACTUAL_SALE", labelKey: "consignments.opTypeActualSale", color: "#10b981" },
          { value: "RETURN", labelKey: "consignments.opTypeReturn", color: "#f59e0b" },
          { value: "INITIAL_BALANCE", labelKey: "consignments.opTypeInitialBalance", color: "#8b5cf6" },
        ],
      },
      { name: "partner_id", labelKey: "consignments.partner", type: "many2one", displayField: "partner_name", searchable: true, groupable: true, readonly: true },
      { name: "sales_rep_name", labelKey: "consignments.salesRep", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "date", labelKey: "common.date", type: "date", readonly: true },
      { name: "line_count", labelKey: "inventory.engine.lines", type: "integer", readonly: true },
      { name: "total_value", labelKey: "consignments.totalValue", type: "monetary", readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
      { name: "created_by_name", labelKey: "listColumns.createdBy", type: "char", searchable: true, groupable: true, readonly: true },
    ],
    filters: [
      { key: "dispatch", labelKey: "consignments.opTypeDispatch", group: "type", conditions: () => [{ field: "document_type", op: "eq", value: "DISPATCH" }] },
      { key: "sale", labelKey: "consignments.opTypeActualSale", group: "type", conditions: () => [{ field: "document_type", op: "eq", value: "ACTUAL_SALE" }] },
      { key: "return", labelKey: "consignments.opTypeReturn", group: "type", conditions: () => [{ field: "document_type", op: "eq", value: "RETURN" }] },
      { key: "initial", labelKey: "consignments.opTypeInitialBalance", group: "type", conditions: () => [{ field: "document_type", op: "eq", value: "INITIAL_BALANCE" }] },
    ],
    groupBys: ["document_type", "partner_id", "sales_rep_name", "date:month"],
    views: ["list", "kanban", "pivot", "graph", "calendar"],
    list: {
      columns: ["doc_no", "document_type", "partner_id", "sales_rep_name", "date", "total_value"],
      sums: ["total_value"],
      // Prompt 24c: the sales rep is already a column (the salesperson of consignment).
      standard: ["created_at", "created_by_name"],
      optional: ["line_count"],
      standardLabels: { date: "listColumns.documentDate", sales_rep_name: "listColumns.salesperson", created_at: "listColumns.issuedAt", created_by_name: "listColumns.createdBy" },
    },
    kanban: { groupBy: "document_type", title: "doc_no", subtitle: "partner_id", amount: "total_value", fields: ["date", "sales_rep_name"] },
    form: { title: "doc_no", fields: ["document_type", "partner_id", "sales_rep_name", "date", "line_count", "total_value"] },
    pivot: { rows: "partner_id", cols: "document_type", measure: "total_value" },
    graph: { groupBy: "date:month", measure: "total_value", type: "bar" },
    calendar: { dateField: "date", title: "doc_no", colorField: "document_type" },
  };
}

// ── Dashboard ────────────────────────────────────────────────────────────────

/** The classic cards: stock value at partners, sold this month, aging stock to recover, partners holding stock. */
export function consignmentKpis(stock: readonly PartnerStockRecord[], docs: readonly ConsignmentDocRecord[], fmt: Formatter, now: Date): Kpi[] {
  const period = periodOf(now);
  return [
    { key: "stock", label: fmt.t("consignments.kpiStockValue"), value: money(sumIf(stock, (r) => r.value), fmt, 2), filters: ["in_stock"], filterLabel: fmt.t("consignment.engine.showInStock") },
    { key: "sold", label: fmt.t("consignments.kpiSoldThisMonth"), value: money(sumIf(docs, (r) => r.total_value, (r) => r.document_type === "ACTUAL_SALE" && (r.date ?? "").slice(0, 7) === period), fmt, 2) },
    { key: "aging", label: fmt.t("consignments.kpiPendingReturns"), value: money(sumIf(stock, (r) => r.value, (r) => r.is_aging), fmt, 2), filters: ["aging"], filterLabel: fmt.t("consignment.engine.showAging"), tone: "attention" },
    { key: "partners", label: fmt.t("consignment.engine.partnersHolding"), value: figure(new Set(stock.filter((r) => r.remaining > 0).map((r) => r.partner_id)).size, fmt), hint: fmt.t("consignment.engine.agingLines", { count: countIf(stock, (r) => r.is_aging && r.remaining > 0) }) },
  ];
}

export interface RepPerformance {
  repName: string;
  dispatched: number;
  sold: number;
}

/** Dispatched vs sold value per sales rep (opening balances excluded), as the classic chart. */
export function repPerformance(docs: readonly ConsignmentDocRecord[], unassigned: string): RepPerformance[] {
  const map = new Map<string, RepPerformance>();
  for (const d of docs) {
    if (d.document_type !== "DISPATCH" && d.document_type !== "ACTUAL_SALE") continue;
    const name = d.sales_rep_name || unassigned;
    const row = map.get(name) ?? { repName: name, dispatched: 0, sold: 0 };
    if (d.document_type === "DISPATCH") row.dispatched = round(row.dispatched + d.total_value);
    else row.sold = round(row.sold + d.total_value);
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.dispatched - a.dispatched);
}
