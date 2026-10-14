/**
 * Sales on the view engine (NEW_UI): the sales invoice model and its view definition, the
 * sales report definition, and the figures of the sales dashboard. Pure: no React or Supabase,
 * so tests load it directly. Reads go through the module's own fetchers (same data and rules as
 * the classic screens); this file only shapes the rows.
 */
import { normalizeSalesDocumentStatus } from "../../../lib/invoices/invoiceStatus";
import { computeInvoiceDebtBreakdown } from "../../../lib/finance/invoiceRemainingBalance";
import type { FilterDef, ModelDef, SelectionOption, ViewDefinition, ViewRecord } from "../../../views/types";

export const SALES_VIEW_KEY = "sales.invoices";
export const SALES_REPORT_VIEW_KEY = "sales.report";

export type PaymentState = "unpaid" | "partial" | "paid";
export type WarehouseState = "not_sent" | "pending" | "approved" | "rejected";

export interface SaleListRecord extends ViewRecord {
  doc_no: string | null;
  doc_date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  seller_id: string | null;
  seller_name: string | null;
  warehouse_name: string | null;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  vat_total: number;
  doc_status: "draft" | "posted" | "cancelled";
  payment_state: PaymentState;
  warehouse_state: WarehouseState;
  is_official: boolean;
  payment_type: string | null;
  due_date: string | null;
  currency: string | null;
  note: string | null;
  created_at: string | null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Remaining debt exactly as the classic list computes it (stored balance, else total − paid). */
export function saleRemaining(row: Record<string, unknown>): number {
  return computeInvoiceDebtBreakdown({
    isOfficial: row.is_official === true,
    subtotalAmount: row.subtotal_amount as number | null,
    vatAmount: (row.vat_amount ?? row.vat_total) as number | null,
    grandTotal: (row.grand_total ?? row.total_amount) as number | null,
    totalAmount: row.total_amount as number | null,
    paidAmount: row.paid_amount as number | null,
    remainingBalance: row.remaining_balance as number | null,
  }).totalRemaining;
}

export function paymentState(total: number, paid: number, remaining: number): PaymentState {
  if (remaining <= 0.004) return "paid";
  return paid > 0 || remaining < total - 0.004 ? "partial" : "unpaid";
}

/** The classic send badge: not sent, waiting for approval, sent, else rejected. */
export function warehouseState(sent: unknown, slipStatus: unknown): WarehouseState {
  if (sent !== true) return "not_sent";
  if (slipStatus === "pending") return "pending";
  if (slipStatus === "approved") return "approved";
  return "rejected";
}

/** A row of fetchSalesListWithMeta / fetchSaleById (SaleRecord) → a flat record. */
export function saleToRecord(row: Record<string, unknown>): SaleListRecord {
  const total = num(row.total_amount);
  const paid = num(row.paid_amount);
  const remaining = saleRemaining(row);
  return {
    id: String(row.id),
    doc_no: str(row.doc_no),
    doc_date: str(row.doc_date),
    customer_id: str(row.customer_id),
    customer_name: str(row.customer_name),
    seller_id: str(row.seller_id),
    seller_name: str(row.issued_by_name) ?? str(row.seller_name),
    warehouse_name: str(row.warehouse_name),
    total_amount: total,
    paid_amount: paid,
    remaining,
    vat_total: num(row.vat_amount ?? row.vat_total),
    doc_status: normalizeSalesDocumentStatus(str(row.status)),
    payment_state: paymentState(total, paid, remaining),
    warehouse_state: warehouseState(row.warehouse_sent, row.warehouse_slip_status),
    is_official: row.is_official === true,
    payment_type: str(row.payment_type),
    due_date: str(row.due_date),
    currency: str(row.currency),
    note: str(row.note),
    created_at: str(row.created_at),
  };
}

export const DOC_STATUS_OPTIONS: SelectionOption[] = [
  { value: "draft", labelKey: "invoice.statusDraft", color: "#94a3b8" },
  { value: "posted", labelKey: "invoice.statusPosted", color: "#10b981" },
  { value: "cancelled", labelKey: "invoice.statusCancelled", color: "#f43f5e" },
];
export const PAYMENT_STATE_OPTIONS: SelectionOption[] = [
  { value: "unpaid", labelKey: "sales.engine.payment.unpaid", color: "#f43f5e" },
  { value: "partial", labelKey: "sales.engine.payment.partial", color: "#f59e0b" },
  { value: "paid", labelKey: "sales.engine.payment.paid", color: "#10b981" },
];
export const WAREHOUSE_STATE_OPTIONS: SelectionOption[] = [
  { value: "not_sent", labelKey: "warehouseSend.notSent", color: "#94a3b8" },
  { value: "pending", labelKey: "warehouseSend.pendingApproval", color: "#f59e0b" },
  { value: "approved", labelKey: "warehouseSend.sent", color: "#10b981" },
  { value: "rejected", labelKey: "warehouseSend.rejected", color: "#f43f5e" },
];
export const PAYMENT_TYPE_OPTIONS: SelectionOption[] = [
  { value: "cash", labelKey: "invoice.paymentTypeCash" },
  { value: "credit", labelKey: "invoice.paymentTypeCredit" },
  { value: "bank_transfer", labelKey: "invoice.paymentTypeBank" },
];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monthStart = (d: Date, shift = 0) => new Date(d.getFullYear(), d.getMonth() + shift, 1);

export function salesFilters(): FilterDef[] {
  return [
    { key: "mine", labelKey: "sales.engine.filters.mine", group: "owner", conditions: (ctx) => [{ field: "seller_id", op: "eq", value: ctx.userId ?? "__nobody" }] },
    { key: "posted", labelKey: "invoice.statusPosted", group: "status", conditions: () => [{ field: "doc_status", op: "eq", value: "posted" }] },
    { key: "draft", labelKey: "invoice.statusDraft", group: "status", conditions: () => [{ field: "doc_status", op: "eq", value: "draft" }] },
    { key: "unpaid", labelKey: "sales.engine.payment.unpaid", group: "payment", conditions: () => [{ field: "payment_state", op: "eq", value: "unpaid" }] },
    { key: "partial", labelKey: "sales.engine.payment.partial", group: "payment", conditions: () => [{ field: "payment_state", op: "eq", value: "partial" }] },
    { key: "paid", labelKey: "sales.engine.payment.paid", group: "payment", conditions: () => [{ field: "payment_state", op: "eq", value: "paid" }] },
    {
      key: "overdue",
      labelKey: "sales.engine.filters.overdue",
      group: "due",
      conditions: (ctx) => [
        { field: "due_date", op: "lt", value: dayStart(ctx.now) },
        { field: "remaining", op: "gt", value: 0 },
      ],
    },
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

/** Sales invoices: read through the module's fetchers, so they are passed in. */
export function salesModel(fetchers: Pick<ModelDef, "fetchAll" | "fetchOne">): ModelDef<SaleListRecord> {
  return {
    key: SALES_VIEW_KEY,
    table: "sales",
    module: "sales",
    readPermission: "can_view_sales",
    writePermission: "can_edit_sales",
    select: "*",
    order: { field: "created_at", dir: "desc" },
    toRecord: saleToRecord,
    ...fetchers,
  };
}

/**
 * The sales screen: list (default, like the classic page), kanban by payment state (read-only:
 * payment changes through payments, not by dragging), pivot, graph and a calendar of invoice
 * dates. The form is read-only like the classic detail page; drafts are edited in the invoice form.
 */
export function salesDefinition(model: ModelDef<SaleListRecord>): ViewDefinition<SaleListRecord> {
  return {
    model,
    titleKey: "sales.title",
    fields: [
      { name: "doc_no", labelKey: "sales.docNo", type: "char", searchable: true, readonly: true },
      { name: "doc_date", labelKey: "common.date", type: "date", readonly: true },
      { name: "customer_id", labelKey: "sales.customer", type: "many2one", displayField: "customer_name", searchable: true, groupable: true, readonly: true },
      { name: "warehouse_name", labelKey: "sales.warehouse", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "seller_name", labelKey: "invoice.issuedBy", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "total_amount", labelKey: "sales.totalAmount", type: "monetary", readonly: true },
      { name: "paid_amount", labelKey: "sales.paid", type: "monetary", readonly: true },
      { name: "remaining", labelKey: "sales.remaining", type: "monetary", readonly: true },
      { name: "vat_total", labelKey: "sales.engine.fields.vat", type: "monetary", readonly: true },
      { name: "doc_status", labelKey: "sales.docStatus", type: "selection", options: DOC_STATUS_OPTIONS, groupable: true, readonly: true },
      { name: "payment_state", labelKey: "sales.engine.fields.paymentState", type: "selection", options: PAYMENT_STATE_OPTIONS, groupable: true, readonly: true },
      { name: "warehouse_state", labelKey: "sales.sendStatus", type: "selection", options: WAREHOUSE_STATE_OPTIONS, groupable: true, readonly: true },
      { name: "payment_type", labelKey: "sales.engine.fields.paymentType", type: "selection", options: PAYMENT_TYPE_OPTIONS, groupable: true, readonly: true },
      { name: "is_official", labelKey: "sales.engine.fields.official", type: "boolean", groupable: true, readonly: true },
      { name: "due_date", labelKey: "sales.engine.fields.dueDate", type: "date", readonly: true },
      { name: "currency", labelKey: "sales.engine.fields.currency", type: "char", readonly: true },
      { name: "note", labelKey: "sales.engine.fields.note", type: "text", searchable: true, readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
    ],
    filters: salesFilters(),
    groupBys: ["doc_status", "payment_state", "warehouse_state", "customer_id", "warehouse_name", "seller_name", "payment_type", "is_official", "doc_date:month", "doc_date:week", "doc_date:quarter"],
    views: ["list", "kanban", "pivot", "graph", "calendar"],
    list: {
      columns: ["doc_no", "doc_date", "customer_id", "warehouse_name", "total_amount", "paid_amount", "remaining", "doc_status", "warehouse_state"],
      sums: ["total_amount", "paid_amount", "remaining"],
    },
    kanban: { groupBy: "payment_state", title: "doc_no", subtitle: "customer_id", amount: "remaining", fields: ["doc_date", "total_amount"] },
    form: {
      title: "doc_no",
      statusField: "doc_status",
      fields: ["customer_id", "doc_date", "warehouse_name", "seller_name", "payment_type", "due_date", "total_amount", "paid_amount", "remaining", "payment_state"],
      tabs: [{ key: "notes", labelKey: "sales.engine.fields.note", fields: ["note", "currency", "is_official", "warehouse_state", "created_at"] }],
    },
    pivot: { rows: "customer_id", cols: "doc_date:month", measure: "total_amount" },
    graph: { groupBy: "doc_date:month", measure: "total_amount", type: "bar" },
    calendar: { dateField: "doc_date", title: "doc_no", colorField: "payment_state" },
  };
}

// ── Sales report (top products) ──────────────────────────────────────────────

export interface ReportProductRecord extends ViewRecord {
  product_name: string;
  product_code: string;
  category: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

/** fetchSalesReport's top products → records (rank kept as order). */
export function reportRecords(top: readonly { product_id: string; product_name: string; product_code: string; category: string; quantity: number; revenue: number; cost: number; profit: number; marginPercent: number }[]): ReportProductRecord[] {
  return top.map((p, i) => ({
    id: p.product_id || `row-${i}`,
    product_name: p.product_name,
    product_code: p.product_code,
    category: p.category,
    quantity: Math.round(p.quantity * 100) / 100,
    revenue: Math.round(p.revenue * 100) / 100,
    cost: Math.round(p.cost * 100) / 100,
    profit: Math.round(p.profit * 100) / 100,
    margin: Math.round(p.marginPercent * 10) / 10,
  }));
}

export const SALES_REPORT_MODEL: ModelDef<ReportProductRecord> = {
  key: SALES_REPORT_VIEW_KEY,
  table: "sale_items",
  module: "sales",
  readPermission: "can_view_reports",
  select: "*",
  order: { field: "revenue", dir: "desc" },
  toRecord: (row) => row as ReportProductRecord,
};

export function salesReportDefinition(): ViewDefinition<ReportProductRecord> {
  return {
    model: SALES_REPORT_MODEL,
    titleKey: "reports.salesReportTitle",
    fields: [
      { name: "product_name", labelKey: "sales.engine.report.product", type: "char", searchable: true },
      { name: "product_code", labelKey: "sales.engine.report.code", type: "char", searchable: true },
      { name: "category", labelKey: "sales.engine.report.category", type: "char", searchable: true, groupable: true },
      { name: "quantity", labelKey: "sales.engine.report.quantity", type: "float" },
      { name: "revenue", labelKey: "sales.profitability.revenue", type: "monetary" },
      { name: "cost", labelKey: "sales.engine.report.cost", type: "monetary" },
      { name: "profit", labelKey: "sales.profitability.grossProfit", type: "monetary" },
      { name: "margin", labelKey: "sales.engine.report.margin", type: "float" },
    ],
    groupBys: ["category"],
    views: ["list", "pivot", "graph"],
    list: { columns: ["product_name", "product_code", "category", "quantity", "revenue", "cost", "profit", "margin"], sums: ["quantity", "revenue", "cost", "profit"] },
    form: { title: "product_name", fields: ["category", "quantity", "revenue", "cost", "profit", "margin"] },
    pivot: { rows: "category", measure: "revenue" },
    graph: { groupBy: "category", measure: "revenue", type: "bar" },
  };
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface SalesDashboard {
  month: { total: number; previous: number; delta: number | null; count: number; weekly: number[]; weeklyCount: number[] };
  receivables: { total: number; count: number; overdue: number };
  drafts: number;
  notSent: number;
  payment: { paid: number; partial: number; unpaid: number; paidPercent: number };
  monthly: { key: string; paid: number; remaining: number }[];
  topCustomers: { name: string | null; total: number; count: number }[];
}

const dateOf = (r: SaleListRecord): Date | null => {
  const raw = r.doc_date ?? r.created_at;
  if (!raw) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Figures of the sales dashboard from the invoices the user can see. Revenue counts posted
 * invoices only (drafts are not sales yet); "this month" is by invoice date.
 */
export function salesDashboard(records: readonly SaleListRecord[], now: Date, weeks = 8, months = 6, top = 5): SalesDashboard {
  const posted = records.filter((r) => r.doc_status === "posted");
  const thisMonth = monthStart(now);
  const lastMonth = monthStart(now, -1);
  const today = dayStart(now);
  const weekStart = (d: Date) => {
    const day = dayStart(d);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
  };
  const firstWeek = new Date(weekStart(now).getTime());
  firstWeek.setDate(firstWeek.getDate() - 7 * (weeks - 1));
  const weekly = Array<number>(weeks).fill(0);
  const weeklyCount = Array<number>(weeks).fill(0);
  let total = 0;
  let previous = 0;
  let count = 0;
  const monthKeys = Array.from({ length: months }, (_, i) => monthKey(monthStart(now, i - months + 1)));
  const monthly = new Map(monthKeys.map((k) => [k, { key: k, paid: 0, remaining: 0 }]));
  const customers = new Map<string, { name: string | null; total: number; count: number }>();
  const yearAgo = monthStart(now, -11);
  let paid = 0;
  let partial = 0;
  let unpaid = 0;
  let receivable = 0;
  let receivableCount = 0;
  let overdue = 0;

  for (const r of posted) {
    const d = dateOf(r);
    if (d) {
      if (d >= thisMonth) {
        total += r.total_amount;
        count += 1;
      } else if (d >= lastMonth) previous += r.total_amount;
      const w = Math.floor((weekStart(d).getTime() - firstWeek.getTime()) / (7 * 86400000) + 0.5);
      if (w >= 0 && w < weeks) {
        weekly[w] += r.total_amount;
        weeklyCount[w] += 1;
      }
      const m = monthly.get(monthKey(d));
      if (m) {
        m.paid += Math.min(r.paid_amount, r.total_amount);
        m.remaining += r.remaining;
      }
      if (d >= yearAgo) {
        const key = r.customer_id ?? `name:${r.customer_name ?? ""}`;
        const c = customers.get(key) ?? { name: r.customer_name, total: 0, count: 0 };
        c.total += r.total_amount;
        c.count += 1;
        customers.set(key, c);
      }
    }
    if (r.total_amount > 0) {
      if (r.payment_state === "paid") paid += 1;
      else if (r.payment_state === "partial") partial += 1;
      else unpaid += 1;
    }
    if (r.remaining > 0) {
      receivable += r.remaining;
      receivableCount += 1;
      const due = r.due_date ? dateOf({ ...r, doc_date: r.due_date }) : null;
      if (due && due < today) overdue += 1;
    }
  }

  const counted = paid + partial + unpaid;
  return {
    month: {
      total: round2(total),
      previous: round2(previous),
      delta: previous > 0 ? Math.round(((total - previous) / previous) * 100) : null,
      count,
      weekly: weekly.map(round2),
      weeklyCount,
    },
    receivables: { total: round2(receivable), count: receivableCount, overdue },
    drafts: records.filter((r) => r.doc_status === "draft").length,
    notSent: posted.filter((r) => r.warehouse_state === "not_sent").length,
    payment: { paid, partial, unpaid, paidPercent: counted ? Math.round((paid / counted) * 100) : 0 },
    monthly: [...monthly.values()].map((m) => ({ key: m.key, paid: round2(m.paid), remaining: round2(m.remaining) })),
    topCustomers: [...customers.values()]
      .map((c) => ({ ...c, total: round2(c.total) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, top),
  };
}
