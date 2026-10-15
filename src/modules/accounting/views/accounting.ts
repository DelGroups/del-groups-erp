/**
 * Accounting on the view engine (NEW_UI): the unified finance ledger, cash and bank accounts,
 * and partner payments, with the classic totals. Pure: rows come from the module's server
 * actions and fetchers (same data and permissions as the classic pages).
 */
import { countIf, figure, money, monthTotals, sumIf, weeklySeries, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export const LEDGER_VIEW_KEY = "accounting.ledger";
export const ACCOUNTS_VIEW_KEY = "accounting.accounts";
export const PAYMENTS_VIEW_KEY = "accounting.payments";
type Fetchers = Pick<ModelDef, "fetchAll" | "fetchOne">;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const monthStart = (d: Date, shift = 0) => new Date(d.getFullYear(), d.getMonth() + shift, 1);

/** Sources whose ledger lines are changed from their own module, never from the ledger (classic rule). */
export const LOCKED_SOURCES = ["sale", "purchase", "production", "production_expense", "expense", "payroll", "employee_advance"] as const;

// ── Ledger ───────────────────────────────────────────────────────────────────

export interface LedgerRecord extends ViewRecord {
  transaction_date: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  /** Signed for sums: income +, expense −, transfers 0. */
  net: number;
  account_name: string | null;
  category: string;
  source: string | null;
  locked: boolean;
  description: string;
  notes: string | null;
  created_at: string;
}

export function ledgerToRecord(row: Record<string, unknown>): LedgerRecord {
  const type = row.type === "INCOME" || row.type === "EXPENSE" ? row.type : "TRANSFER";
  const amount = num(row.amount);
  const source = str(row.reference_type);
  return {
    id: String(row.id),
    transaction_date: String(row.transaction_date ?? ""),
    type,
    amount,
    net: type === "INCOME" ? amount : type === "EXPENSE" ? -amount : 0,
    account_name: str(row.account_name),
    category: String(row.category ?? "") || "—",
    source,
    locked: !!source && (LOCKED_SOURCES as readonly string[]).includes(source),
    description: String(row.description ?? ""),
    notes: str(row.notes),
    created_at: String(row.created_at ?? ""),
  };
}

/** Ledger sources the classic list names (src/lib/finance/unifiedLedger), translated here. */
export const LEDGER_SOURCES = ["production_expense", "production", "manual_expense", "expense", "storno", "purchase_invoice", "purchase", "customer_advance", "employee_advance", "payroll", "sale", "cash_transaction"] as const;

export function ledgerDefinition(fetchers: Fetchers): ViewDefinition<LedgerRecord> {
  return {
    model: { key: LEDGER_VIEW_KEY, table: "transactions", module: "accounting", readPermission: "can_view_finance", writePermission: "can_manage_finance", select: "*", order: { field: "transaction_date", dir: "desc" }, toRecord: ledgerToRecord, ...fetchers },
    titleKey: "finance.title",
    fields: [
      { name: "transaction_date", labelKey: "finance.columnDate", type: "date", readonly: true },
      {
        name: "type",
        labelKey: "finance.columnType",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "INCOME", labelKey: "finance.typeIncome", color: "#10b981" },
          { value: "EXPENSE", labelKey: "finance.typeExpense", color: "#f43f5e" },
          { value: "TRANSFER", labelKey: "finance.typeTransfer", color: "#94a3b8" },
        ],
      },
      { name: "category", labelKey: "finance.columnCategory", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "amount", labelKey: "finance.columnAmount", type: "monetary", readonly: true },
      { name: "net", labelKey: "finance.netFlow", type: "monetary", readonly: true },
      { name: "account_name", labelKey: "finance.columnAccount", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "description", labelKey: "finance.columnDescription", type: "text", searchable: true, readonly: true },
      { name: "notes", labelKey: "finance.note", type: "text", searchable: true, readonly: true },
      { name: "source", labelKey: "finance.columnSource", type: "selection", options: LEDGER_SOURCES.map((value) => ({ value, labelKey: `accounting.engine.source.${value}` })), groupable: true, searchable: true, readonly: true },
      { name: "locked", labelKey: "accounting.engine.fromModule", type: "boolean", groupable: true, readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
    ],
    filters: [
      { key: "income", labelKey: "finance.typeIncome", group: "type", conditions: () => [{ field: "type", op: "eq", value: "INCOME" }] },
      { key: "expense", labelKey: "finance.typeExpense", group: "type", conditions: () => [{ field: "type", op: "eq", value: "EXPENSE" }] },
      { key: "transfer", labelKey: "finance.typeTransfer", group: "type", conditions: () => [{ field: "type", op: "eq", value: "TRANSFER" }] },
      { key: "manual", labelKey: "accounting.engine.manual", group: "source", conditions: () => [{ field: "locked", op: "eq", value: false }] },
      { key: "this_month", labelKey: "sales.engine.filters.thisMonth", group: "date", conditions: (ctx) => [{ field: "transaction_date", op: "gte", value: monthStart(ctx.now) }] },
      { key: "last_month", labelKey: "sales.engine.filters.lastMonth", group: "date", conditions: (ctx) => [{ field: "transaction_date", op: "gte", value: monthStart(ctx.now, -1) }, { field: "transaction_date", op: "lt", value: monthStart(ctx.now) }] },
    ],
    groupBys: ["type", "category", "account_name", "source", "transaction_date:month", "transaction_date:week"],
    views: ["list", "pivot", "graph", "calendar"],
    list: { columns: ["transaction_date", "type", "category", "amount", "account_name", "description", "source"], sums: ["net"] },
    form: { title: "category", statusField: "type", fields: ["transaction_date", "amount", "account_name", "source", "description", "notes", "created_at"] },
    pivot: { rows: "category", cols: "transaction_date:month", measure: "net" },
    graph: { groupBy: "transaction_date:month", measure: "net", type: "bar" },
    calendar: { dateField: "transaction_date", title: "category", colorField: "type" },
  };
}

/** The classic totals (income, expense, net) plus this month's net flow with a weekly trend. */
export function ledgerKpis(records: readonly LedgerRecord[], fmt: Formatter, now: Date): Kpi[] {
  const income = sumIf(records, (r) => r.amount, (r) => r.type === "INCOME");
  const expense = sumIf(records, (r) => r.amount, (r) => r.type === "EXPENSE");
  const month = monthTotals(records, (r) => r.transaction_date, (r) => r.net, now);
  return [
    { key: "income", label: fmt.t("finance.totalIncome"), value: money(income, fmt, 2), filters: ["income"], filterLabel: fmt.t("accounting.engine.showIncome"), tone: "good" },
    { key: "expense", label: fmt.t("finance.totalExpense"), value: money(expense, fmt, 2), filters: ["expense"], filterLabel: fmt.t("accounting.engine.showExpense"), tone: "attention" },
    { key: "net", label: fmt.t("finance.netBalance"), value: money(Math.round((income - expense) * 100) / 100, fmt, 2) },
    {
      key: "month",
      label: fmt.t("accounting.engine.netThisMonth"),
      value: money(month.current, fmt),
      delta: month.delta,
      deltaLabel: fmt.t("sales.engine.dashboard.vsLastMonth"),
      series: weeklySeries(records, (r) => r.transaction_date, (r) => r.net, now),
      seriesLabel: fmt.t("sales.engine.dashboard.lastWeeks", { count: 8 }),
      filters: ["this_month"],
      filterLabel: fmt.t("accounting.engine.showThisMonth"),
    },
  ];
}

// ── Cash and bank accounts ───────────────────────────────────────────────────

export interface AccountRecord extends ViewRecord {
  code: string;
  name: string;
  type: string;
  balance: number;
  stored_balance: number;
  /** Stored balance and ledger disagree (the ledger is what the classic page shows). */
  mismatch: boolean;
  income_total: number;
  expense_total: number;
}

export function accountToRecord(row: Record<string, unknown>): AccountRecord {
  const ledger = num(row.ledger_balance);
  const stored = num(row.stored_balance);
  return {
    id: String(row.account_id ?? row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    type: String(row.type ?? ""),
    balance: ledger,
    stored_balance: stored,
    mismatch: Math.abs(ledger - stored) > 0.004,
    income_total: num(row.income_total),
    expense_total: num(row.expense_total),
  };
}

/** The classic totals: "Kassa" accounts are cash, "Bank" accounts bank (other types in neither). */
export const isCashAccount = (r: Pick<AccountRecord, "type">) => r.type === "Kassa";
export const isBankAccount = (r: Pick<AccountRecord, "type">) => r.type === "Bank";

export function accountsDefinition(fetchers: Fetchers): ViewDefinition<AccountRecord> {
  return {
    model: { key: ACCOUNTS_VIEW_KEY, table: "accounts", module: "accounting", readPermission: "can_view_finance", writePermission: "can_manage_finance", select: "*", order: { field: "name", dir: "asc" }, toRecord: accountToRecord, ...fetchers },
    titleKey: "cashBank.pageTitle",
    fields: [
      { name: "code", labelKey: "cashBank.accountCode", type: "char", searchable: true, readonly: true },
      { name: "name", labelKey: "cashBank.accountName", type: "char", searchable: true, readonly: true },
      {
        name: "type",
        labelKey: "accounting.engine.accountType",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "Kassa", labelKey: "cashBank.typeCash", color: "#10b981" },
          { value: "Bank", labelKey: "cashBank.typeBank", color: "#0ea5e9" },
        ],
      },
      { name: "balance", labelKey: "cashBank.currentBalance", type: "monetary", readonly: true },
      { name: "income_total", labelKey: "cashBank.ledgerIncome", type: "monetary", readonly: true },
      { name: "expense_total", labelKey: "cashBank.ledgerExpense", type: "monetary", readonly: true },
      { name: "stored_balance", labelKey: "accounting.engine.storedBalance", type: "monetary", readonly: true },
      { name: "mismatch", labelKey: "accounting.engine.mismatch", type: "boolean", groupable: true, readonly: true },
    ],
    filters: [
      { key: "cash", labelKey: "cashBank.typeCash", group: "type", conditions: () => [{ field: "type", op: "eq", value: "Kassa" }] },
      { key: "bank", labelKey: "cashBank.typeBank", group: "type", conditions: () => [{ field: "type", op: "eq", value: "Bank" }] },
      { key: "negative", labelKey: "accounting.engine.negative", group: "balance", conditions: () => [{ field: "balance", op: "lt", value: 0 }] },
    ],
    groupBys: ["type", "mismatch"],
    views: ["list", "kanban", "graph"],
    list: { columns: ["code", "name", "type", "income_total", "expense_total", "balance"], sums: ["income_total", "expense_total", "balance"] },
    kanban: { groupBy: "type", title: "name", subtitle: "code", amount: "balance" },
    form: { title: "name", fields: ["code", "type", "balance", "income_total", "expense_total", "stored_balance"] },
    graph: { groupBy: "type", measure: "balance", type: "pie" },
  };
}

/** The classic totals: cash, bank, all money; plus accounts below zero. */
export function accountKpis(records: readonly AccountRecord[], fmt: Formatter): Kpi[] {
  const cash = sumIf(records, (r) => r.balance, isCashAccount);
  const bank = sumIf(records, (r) => r.balance, isBankAccount);
  const negative = countIf(records, (r) => r.balance < 0);
  return [
    { key: "cash", label: fmt.t("cashBank.totalCash"), value: money(cash, fmt, 2), filters: ["cash"], filterLabel: fmt.t("accounting.engine.showCash") },
    { key: "bank", label: fmt.t("cashBank.totalBank"), value: money(bank, fmt, 2), filters: ["bank"], filterLabel: fmt.t("accounting.engine.showBank") },
    { key: "total", label: fmt.t("cashBank.totalFinance"), value: money(Math.round((cash + bank) * 100) / 100, fmt, 2), tone: "good" },
    { key: "negative", label: fmt.t("accounting.engine.negative"), value: figure(negative, fmt), filters: ["negative"], filterLabel: fmt.t("accounting.engine.showNegative"), tone: negative ? "attention" : undefined },
  ];
}

// ── Partner payments ─────────────────────────────────────────────────────────

export interface PaymentRecord extends ViewRecord {
  payment_date: string;
  partner_name: string;
  amount: number;
  /** Signed: incoming +, outgoing −. */
  net: number;
  payment_type: "in" | "out";
  payment_method: "cash" | "bank";
  cash_account_name: string | null;
  reference_note: string | null;
  created_at: string | null;
}

export function paymentToRecord(row: Record<string, unknown>): PaymentRecord {
  const type = row.payment_type === "out" ? "out" : "in";
  const amount = num(row.amount);
  return {
    id: String(row.id),
    payment_date: String(row.payment_date ?? ""),
    partner_name: String(row.partner_name ?? ""),
    amount,
    net: type === "in" ? amount : -amount,
    payment_type: type,
    payment_method: row.payment_method === "bank" ? "bank" : "cash",
    cash_account_name: str(row.cash_account_name),
    reference_note: str(row.reference_note),
    created_at: str(row.created_at),
  };
}

export function paymentsDefinition(fetchers: Fetchers): ViewDefinition<PaymentRecord> {
  return {
    model: { key: PAYMENTS_VIEW_KEY, table: "partner_payments", module: "accounting", readPermission: "can_view_finance", writePermission: "can_manage_finance", select: "*", order: { field: "payment_date", dir: "desc" }, toRecord: paymentToRecord, ...fetchers },
    titleKey: "payments.pageTitle",
    fields: [
      { name: "payment_date", labelKey: "common.date", type: "date", readonly: true },
      { name: "partner_name", labelKey: "payments.partner", type: "char", searchable: true, groupable: true, readonly: true },
      {
        name: "payment_type",
        labelKey: "payments.type",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "in", labelKey: "payments.typeIn", color: "#10b981" },
          { value: "out", labelKey: "payments.typeOut", color: "#f43f5e" },
        ],
      },
      {
        name: "payment_method",
        labelKey: "payments.method",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "cash", labelKey: "payments.methodCash" },
          { value: "bank", labelKey: "payments.methodBank" },
        ],
      },
      { name: "amount", labelKey: "payments.amount", type: "monetary", readonly: true },
      { name: "net", labelKey: "finance.netFlow", type: "monetary", readonly: true },
      { name: "cash_account_name", labelKey: "payments.cashAccount", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "reference_note", labelKey: "payments.reference", type: "char", searchable: true, readonly: true },
      { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
    ],
    filters: [
      { key: "in", labelKey: "payments.typeIn", group: "type", conditions: () => [{ field: "payment_type", op: "eq", value: "in" }] },
      { key: "out", labelKey: "payments.typeOut", group: "type", conditions: () => [{ field: "payment_type", op: "eq", value: "out" }] },
      { key: "this_month", labelKey: "sales.engine.filters.thisMonth", group: "date", conditions: (ctx) => [{ field: "payment_date", op: "gte", value: monthStart(ctx.now) }] },
    ],
    groupBys: ["payment_type", "partner_name", "payment_method", "cash_account_name", "payment_date:month"],
    views: ["list", "pivot", "graph", "calendar"],
    list: { columns: ["payment_date", "partner_name", "payment_type", "payment_method", "amount", "cash_account_name", "reference_note"], sums: ["net"] },
    form: { title: "partner_name", statusField: "payment_type", fields: ["payment_date", "amount", "payment_method", "cash_account_name", "reference_note", "created_at"] },
    pivot: { rows: "partner_name", cols: "payment_type", measure: "amount" },
    graph: { groupBy: "payment_date:month", measure: "net", type: "bar" },
    calendar: { dateField: "payment_date", title: "partner_name", colorField: "payment_type" },
  };
}

export function paymentKpis(records: readonly PaymentRecord[], fmt: Formatter, now: Date): Kpi[] {
  const month = (r: PaymentRecord) => new Date(`${r.payment_date.slice(0, 10)}T00:00:00`) >= monthStart(now);
  return [
    { key: "in", label: fmt.t("accounting.engine.receivedMonth"), value: money(sumIf(records, (r) => r.amount, (r) => r.payment_type === "in" && month(r)), fmt, 2), filters: ["in", "this_month"], filterLabel: fmt.t("accounting.engine.showReceived"), tone: "good" },
    { key: "out", label: fmt.t("accounting.engine.paidMonth"), value: money(sumIf(records, (r) => r.amount, (r) => r.payment_type === "out" && month(r)), fmt, 2), filters: ["out", "this_month"], filterLabel: fmt.t("accounting.engine.showPaidOut") },
    { key: "count", label: fmt.t("accounting.engine.paymentsMonth"), value: figure(countIf(records, month), fmt) },
  ];
}
