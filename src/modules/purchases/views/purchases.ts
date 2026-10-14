/**
 * Purchases on the view engine (NEW_UI): the purchase invoice record, its view definition and
 * the dashboard figures. Pure: rows come from the module's own fetchers (same data and rules
 * as the classic list), this file only shapes them.
 */
import { normalizePurchaseDocumentStatus } from "../../../lib/invoices/invoiceStatus";
import { computeInvoiceDebtBreakdown } from "../../../lib/finance/invoiceRemainingBalance";
import {
  DOC_STATUS_OPTIONS,
  PAYMENT_STATE_OPTIONS,
  paymentState,
  WAREHOUSE_STATE_OPTIONS,
  warehouseState,
  type PaymentState,
  type WarehouseState,
} from "../../../lib/invoices/documentStates";
import { countIf, money, monthTotals, sumIf, weeklySeries, figure, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { FilterDef, ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export const PURCHASES_VIEW_KEY = "purchases.invoices";

export interface PurchaseListRecord extends ViewRecord {
  invoice_number: string;
  doc_date: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  warehouse_name: string | null;
  responsible_name: string | null;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  doc_status: "draft" | "posted" | "cancelled";
  payment_state: PaymentState;
  warehouse_state: WarehouseState;
  is_official: boolean;
  notes: string | null;
  created_at: string | null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Remaining debt exactly as the classic list computes it (stored debt, else total − paid). */
export function purchaseRemaining(row: Record<string, unknown>): number {
  return computeInvoiceDebtBreakdown({
    isOfficial: row.is_official === true,
    subtotalAmount: row.subtotal_amount as number | null,
    vatAmount: row.vat_amount as number | null,
    grandTotal: (row.grand_total ?? row.total_amount) as number | null,
    totalAmount: row.total_amount as number | null,
    paidAmount: row.paid_amount as number | null,
    remainingBalance: row.debt_amount as number | null,
  }).totalRemaining;
}

/** A PurchaseRecord (fetchPurchaseList / fetchPurchaseById) → a flat record. */
export function purchaseToRecord(row: Record<string, unknown>): PurchaseListRecord {
  const total = num(row.total_amount);
  const paid = num(row.paid_amount);
  const remaining = purchaseRemaining(row);
  const name = str(row.supplier_name);
  const company = str(row.supplier_company);
  return {
    id: String(row.id),
    invoice_number: String(row.invoice_number ?? ""),
    doc_date: str(row.doc_date),
    supplier_id: str(row.supplier_id),
    supplier_name: name && company ? `${name} (${company})` : (name ?? company),
    warehouse_name: str(row.warehouse_name),
    responsible_name: str(row.responsible_name),
    total_amount: total,
    paid_amount: paid,
    remaining,
    doc_status: normalizePurchaseDocumentStatus(str(row.status)),
    payment_state: paymentState(total, paid, remaining),
    warehouse_state: warehouseState(row.warehouse_sent, row.warehouse_slip_status),
    is_official: row.is_official === true,
    notes: str(row.notes),
    created_at: str(row.created_at),
  };
}

const monthStart = (d: Date, shift = 0) => new Date(d.getFullYear(), d.getMonth() + shift, 1);

export function purchaseFilters(): FilterDef[] {
  return [
    { key: "posted", labelKey: "invoice.statusPosted", group: "status", conditions: () => [{ field: "doc_status", op: "eq", value: "posted" }] },
    { key: "draft", labelKey: "invoice.statusDraft", group: "status", conditions: () => [{ field: "doc_status", op: "eq", value: "draft" }] },
    { key: "unpaid", labelKey: "sales.engine.payment.unpaid", group: "payment", conditions: () => [{ field: "payment_state", op: "eq", value: "unpaid" }] },
    { key: "partial", labelKey: "sales.engine.payment.partial", group: "payment", conditions: () => [{ field: "payment_state", op: "eq", value: "partial" }] },
    { key: "paid", labelKey: "sales.engine.payment.paid", group: "payment", conditions: () => [{ field: "payment_state", op: "eq", value: "paid" }] },
    { key: "not_sent", labelKey: "sales.engine.filters.notSent", group: "warehouse", conditions: () => [{ field: "doc_status", op: "eq", value: "posted" }, { field: "warehouse_state", op: "eq", value: "not_sent" }] },
    { key: "official", labelKey: "sales.engine.filters.official", group: "official", conditions: () => [{ field: "is_official", op: "eq", value: true }] },
    { key: "this_month", labelKey: "sales.engine.filters.thisMonth", group: "date", conditions: (ctx) => [{ field: "doc_date", op: "gte", value: monthStart(ctx.now) }] },
    {
      key: "last_month",
      labelKey: "sales.engine.filters.lastMonth",
      group: "date",
      conditions: (ctx) => [
        { field: "doc_date", op: "gte", value: monthStart(ctx.now, -1) },
        { field: "doc_date", op: "lt", value: monthStart(ctx.now) },
      ],
    },
  ];
}

export function purchasesModel(fetchers: Pick<ModelDef, "fetchAll" | "fetchOne">): ModelDef<PurchaseListRecord> {
  return {
    key: PURCHASES_VIEW_KEY,
    table: "purchases",
    module: "purchases",
    readPermission: "can_view_purchases",
    writePermission: "can_edit_purchases",
    select: "*",
    order: { field: "created_at", dir: "desc" },
    toRecord: purchaseToRecord,
    ...fetchers,
  };
}

/** Purchase invoices: list (as the classic page), kanban by payment state (read-only), pivot, graph, calendar. */
export function purchasesDefinition(model: ModelDef<PurchaseListRecord>): ViewDefinition<PurchaseListRecord> {
  return {
    model,
    titleKey: "purchases.title",
    fields: [
      { name: "invoice_number", labelKey: "purchases.invoiceNo", type: "char", searchable: true, readonly: true },
      { name: "doc_date", labelKey: "common.date", type: "date", readonly: true },
      { name: "supplier_id", labelKey: "purchases.supplier", type: "many2one", displayField: "supplier_name", searchable: true, groupable: true, readonly: true },
      { name: "warehouse_name", labelKey: "purchases.warehouse", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "responsible_name", labelKey: "purchases.engine.responsible", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "total_amount", labelKey: "purchases.totalAmount", type: "monetary", readonly: true },
      { name: "paid_amount", labelKey: "purchases.paid", type: "monetary", readonly: true },
      { name: "remaining", labelKey: "purchases.debt", type: "monetary", readonly: true },
      { name: "doc_status", labelKey: "common.status", type: "selection", options: DOC_STATUS_OPTIONS.map((o) => ({ ...o })), groupable: true, readonly: true },
      { name: "payment_state", labelKey: "sales.engine.fields.paymentState", type: "selection", options: PAYMENT_STATE_OPTIONS.map((o) => ({ ...o })), groupable: true, readonly: true },
      { name: "warehouse_state", labelKey: "purchases.sendStatus", type: "selection", options: WAREHOUSE_STATE_OPTIONS.map((o) => ({ ...o })), groupable: true, readonly: true },
      { name: "is_official", labelKey: "sales.engine.fields.official", type: "boolean", groupable: true, readonly: true },
      { name: "notes", labelKey: "sales.engine.fields.note", type: "text", searchable: true, readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
    ],
    filters: purchaseFilters(),
    groupBys: ["doc_status", "payment_state", "warehouse_state", "supplier_id", "warehouse_name", "responsible_name", "is_official", "doc_date:month", "doc_date:week", "doc_date:quarter"],
    views: ["list", "kanban", "pivot", "graph", "calendar"],
    list: {
      columns: ["invoice_number", "doc_date", "supplier_id", "total_amount", "paid_amount", "remaining", "doc_status", "warehouse_state"],
      sums: ["total_amount", "paid_amount", "remaining"],
    },
    kanban: { groupBy: "payment_state", title: "invoice_number", subtitle: "supplier_id", amount: "remaining", fields: ["doc_date", "total_amount"] },
    form: {
      title: "invoice_number",
      statusField: "doc_status",
      fields: ["supplier_id", "doc_date", "warehouse_name", "responsible_name", "total_amount", "paid_amount", "remaining", "payment_state"],
      tabs: [{ key: "notes", labelKey: "sales.engine.fields.note", fields: ["notes", "is_official", "warehouse_state", "created_at"] }],
    },
    pivot: { rows: "supplier_id", cols: "doc_date:month", measure: "total_amount" },
    graph: { groupBy: "doc_date:month", measure: "total_amount", type: "bar" },
    calendar: { dateField: "doc_date", title: "invoice_number", colorField: "payment_state" },
  };
}

/** Dashboard cards: this month's purchases, payables, unpaid invoices, drafts / not sent. */
export function purchaseKpis(records: readonly PurchaseListRecord[], fmt: Formatter, now: Date): Kpi[] {
  const posted = records.filter((r) => r.doc_status === "posted");
  const date = (r: PurchaseListRecord) => r.doc_date ?? r.created_at;
  const month = monthTotals(posted, date, (r) => r.total_amount, now);
  const drafts = countIf(records, (r) => r.doc_status === "draft");
  const notSent = countIf(posted, (r) => r.warehouse_state === "not_sent");
  return [
    {
      key: "month",
      label: fmt.t("purchases.engine.kpi.month"),
      value: money(month.current, fmt),
      delta: month.delta,
      deltaLabel: fmt.t("sales.engine.dashboard.vsLastMonth"),
      series: weeklySeries(posted, date, (r) => r.total_amount, now),
      seriesLabel: fmt.t("sales.engine.dashboard.lastWeeks", { count: 8 }),
      filters: ["posted", "this_month"],
      filterLabel: fmt.t("purchases.engine.kpi.showMonth"),
    },
    {
      key: "payable",
      label: fmt.t("purchases.engine.kpi.payable", { count: countIf(posted, (r) => r.remaining > 0) }),
      value: money(sumIf(posted, (r) => r.remaining), fmt),
      hint: fmt.t("purchases.engine.kpi.payableHint"),
      filters: ["posted", "unpaid", "partial"],
      filterLabel: fmt.t("purchases.engine.kpi.showPayable"),
      tone: sumIf(posted, (r) => r.remaining) > 0 ? "attention" : undefined,
    },
    {
      key: "drafts",
      label: fmt.t("sales.engine.dashboard.drafts"),
      value: figure(drafts, fmt),
      hint: fmt.t("purchases.engine.kpi.draftsHint"),
      filters: ["draft"],
      filterLabel: fmt.t("sales.engine.dashboard.showDrafts"),
    },
    {
      key: "not_sent",
      label: fmt.t("sales.engine.filters.notSent"),
      value: figure(notSent, fmt),
      hint: fmt.t("purchases.engine.kpi.notSentHint"),
      filters: ["not_sent"],
      filterLabel: fmt.t("sales.engine.dashboard.showNotSent"),
    },
  ];
}
