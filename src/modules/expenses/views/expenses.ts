/**
 * Expenses on the view engine (NEW_UI): expense documents with their approval flow (draft →
 * submitted → approved → posted, or cancelled) and the classic summary. Pure: rows come from the
 * module's fetchExpensesAction; the figures use the module's own summarizeExpenses.
 */
import { isOwedToEmployee, summarizeExpenses, type ExpenseDocument } from "../lib/expenseDocuments";
import { money, weeklySeries, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export const EXPENSES_VIEW_KEY = "expenses.documents";

export interface ExpenseRecord extends ViewRecord {
  code: string;
  expense_date: string;
  /** The document state, with "owed" for approved expenses still to reimburse to an employee. */
  stage: "draft" | "submitted" | "approved" | "owed" | "posted" | "cancelled";
  status: ExpenseDocument["status"];
  payment_mode: ExpenseDocument["payment_mode"];
  category_id: string | null;
  category: string;
  supplier_name: string | null;
  payee: string | null;
  employee_name: string | null;
  account_name: string | null;
  department_name: string | null;
  reference_no: string | null;
  description: string | null;
  net_amount: number;
  vat_amount: number;
  amount: number;
  attachment_count: number;
  is_production: boolean;
  rejected_reason: string | null;
  cancel_reason: string | null;
  created_at: string | null;
}

export function expenseToRecord(row: Record<string, unknown>): ExpenseRecord {
  const doc = row as unknown as ExpenseDocument;
  return {
    id: doc.id,
    code: doc.code,
    expense_date: doc.expense_date,
    stage: isOwedToEmployee(doc) ? "owed" : doc.status,
    status: doc.status,
    payment_mode: doc.payment_mode,
    category_id: doc.category_id,
    category: doc.category || "—",
    supplier_name: doc.supplier_name,
    payee: doc.payee,
    employee_name: doc.employee_name,
    account_name: doc.account_name,
    department_name: doc.department_name,
    reference_no: doc.reference_no,
    description: doc.description,
    net_amount: Number(doc.net_amount) || 0,
    vat_amount: Number(doc.vat_amount) || 0,
    amount: Number(doc.amount) || 0,
    attachment_count: Number(doc.attachment_count) || 0,
    is_production: doc.is_production === true,
    rejected_reason: doc.rejected_reason,
    cancel_reason: doc.cancel_reason,
    created_at: doc.created_at,
  };
}

const monthStart = (d: Date, shift = 0) => new Date(d.getFullYear(), d.getMonth() + shift, 1);

export function expensesDefinition(fetchers: Pick<ModelDef, "fetchAll" | "fetchOne">): ViewDefinition<ExpenseRecord> {
  return {
    model: { key: EXPENSES_VIEW_KEY, table: "expenses", module: "expenses", readPermission: "can_view_expenses", writePermission: "can_manage_expenses", select: "*", order: { field: "expense_date", dir: "desc" }, toRecord: expenseToRecord, ...fetchers },
    titleKey: "expenses.pageTitle",
    fields: [
      { name: "expense_date", labelKey: "common.date", type: "date", readonly: true },
      { name: "code", labelKey: "expenses.doc.code", type: "char", searchable: true, readonly: true },
      { name: "category", labelKey: "common.category", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "supplier_name", labelKey: "expenses.doc.supplier", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "payee", labelKey: "expenses.engine.payee", type: "char", searchable: true, readonly: true },
      { name: "employee_name", labelKey: "expenses.doc.paidByEmployee", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "account_name", labelKey: "expenses.paidAccount", type: "char", groupable: true, readonly: true },
      { name: "department_name", labelKey: "expenses.doc.department", type: "char", groupable: true, readonly: true },
      { name: "reference_no", labelKey: "expenses.doc.referenceNo", type: "char", searchable: true, readonly: true },
      { name: "description", labelKey: "expenses.doc.description", type: "text", searchable: true, readonly: true },
      { name: "net_amount", labelKey: "expenses.doc.net", type: "monetary", readonly: true },
      { name: "vat_amount", labelKey: "expenses.doc.vat", type: "monetary", readonly: true },
      { name: "amount", labelKey: "expenses.doc.total", type: "monetary", readonly: true },
      { name: "attachment_count", labelKey: "expenses.doc.attachments", type: "integer", readonly: true },
      { name: "rejected_reason", labelKey: "expenses.doc.rejectReason", type: "text", readonly: true },
      { name: "cancel_reason", labelKey: "expenses.doc.cancelReason", type: "text", readonly: true },
      {
        name: "stage",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "draft", labelKey: "expenses.doc.status_draft", color: "#94a3b8" },
          { value: "submitted", labelKey: "expenses.doc.status_submitted", color: "#0ea5e9" },
          { value: "approved", labelKey: "expenses.doc.status_approved", color: "#8b5cf6" },
          { value: "owed", labelKey: "expenses.doc.status_owed", color: "#f59e0b" },
          { value: "posted", labelKey: "expenses.doc.status_posted", color: "#10b981" },
          { value: "cancelled", labelKey: "expenses.doc.status_cancelled", color: "#f43f5e" },
        ],
      },
      {
        name: "payment_mode",
        labelKey: "expenses.engine.paidBy",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "company", labelKey: "expenses.engine.paidByCompany" },
          { value: "employee", labelKey: "expenses.doc.paidByEmployee" },
        ],
      },
    ],
    filters: [
      { key: "pending", labelKey: "expenses.doc.pending", group: "stage", conditions: () => [{ field: "stage", op: "in", value: ["draft", "submitted"] }] },
      { key: "to_approve", labelKey: "expenses.doc.status_submitted", group: "stage", conditions: () => [{ field: "stage", op: "eq", value: "submitted" }] },
      { key: "owed", labelKey: "expenses.doc.owedToEmployees", group: "stage", conditions: () => [{ field: "stage", op: "eq", value: "owed" }] },
      { key: "booked", labelKey: "expenses.engine.booked", group: "stage", conditions: () => [{ field: "stage", op: "in", value: ["approved", "owed", "posted"] }] },
      { key: "active", labelKey: "expenses.engine.notCancelled", group: "cancel", conditions: () => [{ field: "stage", op: "neq", value: "cancelled" }] },
      { key: "no_receipt", labelKey: "expenses.engine.noReceipt", group: "receipt", conditions: () => [{ field: "attachment_count", op: "eq", value: 0 }] },
      { key: "this_month", labelKey: "expenses.doc.rangeThisMonth", group: "date", conditions: (ctx) => [{ field: "expense_date", op: "gte", value: monthStart(ctx.now) }] },
      { key: "last_month", labelKey: "expenses.doc.rangeLastMonth", group: "date", conditions: (ctx) => [{ field: "expense_date", op: "gte", value: monthStart(ctx.now, -1) }, { field: "expense_date", op: "lt", value: monthStart(ctx.now) }] },
      { key: "this_year", labelKey: "expenses.doc.rangeThisYear", group: "date", conditions: (ctx) => [{ field: "expense_date", op: "gte", value: new Date(ctx.now.getFullYear(), 0, 1) }] },
    ],
    groupBys: ["stage", "category", "supplier_name", "department_name", "account_name", "payment_mode", "expense_date:month", "expense_date:quarter"],
    views: ["list", "kanban", "pivot", "graph", "calendar"],
    list: { columns: ["expense_date", "code", "category", "supplier_name", "description", "account_name", "vat_amount", "amount", "stage"], sums: ["net_amount", "vat_amount", "amount"] },
    kanban: { groupBy: "stage", title: "code", subtitle: "category", amount: "amount", fields: ["supplier_name", "expense_date"], folded: ["cancelled"] },
    form: {
      title: "code",
      statusField: "stage",
      fields: ["expense_date", "category", "supplier_name", "payee", "payment_mode", "employee_name", "account_name", "department_name", "reference_no", "net_amount", "vat_amount", "amount"],
      tabs: [{ key: "notes", labelKey: "expenses.doc.description", fields: ["description", "attachment_count", "rejected_reason", "cancel_reason"] }],
    },
    // The classic monthly report (category by month) as a pivot.
    pivot: { rows: "category", cols: "expense_date:month", measure: "amount" },
    graph: { groupBy: "category", measure: "amount", type: "bar" },
    calendar: { dateField: "expense_date", title: "code", colorField: "stage" },
  };
}

/** The classic summary (cancelled left out): booked total, pending approval, owed to employees; plus this month. */
export function expenseKpis(records: readonly ExpenseRecord[], fmt: Formatter, now: Date): Kpi[] {
  const s = summarizeExpenses(records as unknown as ExpenseDocument[]);
  const thisMonth = records.filter((r) => r.stage !== "cancelled" && r.stage !== "draft" && r.stage !== "submitted" && new Date(`${r.expense_date}T00:00:00`) >= monthStart(now));
  return [
    {
      key: "month",
      label: fmt.t("expenses.engine.thisMonth"),
      value: money(thisMonth.reduce((sum, r) => sum + r.amount, 0), fmt),
      series: weeklySeries(records.filter((r) => r.stage !== "cancelled" && r.stage !== "draft" && r.stage !== "submitted"), (r) => r.expense_date, (r) => r.amount, now),
      seriesLabel: fmt.t("sales.engine.dashboard.lastWeeks", { count: 8 }),
      filters: ["booked", "this_month"],
      filterLabel: fmt.t("expenses.engine.showThisMonth"),
    },
    { key: "total", label: fmt.t("expenses.totalRecorded"), value: money(s.total, fmt, 2), hint: fmt.t("expenses.doc.documentsCount", { count: s.count }) },
    { key: "pending", label: fmt.t("expenses.doc.pending"), value: money(s.pendingTotal, fmt, 2), hint: fmt.t("expenses.doc.documentsCount", { count: s.pendingCount }), filters: ["pending"], filterLabel: fmt.t("expenses.engine.showPending"), tone: s.pendingCount ? "attention" : undefined },
    { key: "owed", label: fmt.t("expenses.doc.owedToEmployees"), value: money(s.owedTotal, fmt, 2), hint: fmt.t("expenses.doc.documentsCount", { count: s.owedCount }), filters: ["owed"], filterLabel: fmt.t("expenses.engine.showOwed"), tone: s.owedCount ? "attention" : undefined },
  ];
}

