/**
 * Debtor / creditor reports and turnover per partner (LED-4, PARTNER_LEDGERS): the shapes of
 * get_debtor_creditor_report and get_partner_turnover (20261114100000), the URL filter state,
 * the KPI formulas and the Excel sheets. Pure: covered by node --test.
 */
import { toXlsxCell, XLSX_FORMATS, type XlsxCell } from "@/lib/export/exportXlsx";
import { cents } from "./partnerStatement";

export type DebtorTab = "debtors" | "creditors" | "net" | "turnover";
export const DEBTOR_TABS: readonly DebtorTab[] = ["debtors", "creditors", "net", "turnover"];
export type PartnerKind = "all" | "customer" | "supplier" | "partner";
export type BalanceSort = "name" | "balance" | "overdue" | "oldest_days" | "open_count" | "used_pct" | "last_payment_date" | "terms";
export type TurnoverSort = "name" | "opening" | "debit" | "credit" | "closing" | "dso" | "dpo";
export const BALANCE_SORTS: readonly BalanceSort[] = ["name", "balance", "overdue", "oldest_days", "open_count", "used_pct", "last_payment_date", "terms"];
export const TURNOVER_SORTS: readonly TurnoverSort[] = ["name", "opening", "debit", "credit", "closing", "dso", "dpo"];
export const PAGE_SIZES = [25, 50, 100] as const;

export interface ReportFilters {
  type: PartnerKind;
  minAmount: number | null;
  currency: string;
  userId: string;
  overdueOnly: boolean;
  overLimitOnly: boolean;
  search: string;
}

export interface DebtorQuery extends ReportFilters {
  tab: DebtorTab;
  asOf: string;
  from: string;
  to: string;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface BalanceRow {
  partnerId: string;
  name: string;
  phone: string;
  voen: string;
  isCustomer: boolean;
  isSupplier: boolean;
  isDeleted: boolean;
  balance: number;
  receivable: number;
  payable: number;
  overdue: number;
  oldestOverdueDays: number | null;
  openCount: number;
  advance: number;
  creditLimit: number;
  creditUsedPct: number | null;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  paymentTermsDays: number | null;
}

export interface Kpi {
  totalReceivable: number;
  totalPayable: number;
  net: number;
  overdueReceivable: number;
  topDebtors: { partnerId: string; name: string; balance: number }[];
}

export interface BalanceReport {
  asOf: string;
  tab: Exclude<DebtorTab, "turnover">;
  totalCount: number;
  rows: BalanceRow[];
  totals: { balance: number; overdue: number; openCount: number };
  kpi: Kpi;
}

export interface TurnoverRow {
  partnerId: string;
  name: string;
  phone: string;
  isCustomer: boolean;
  isSupplier: boolean;
  isDeleted: boolean;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  sales: number;
  purchases: number;
  dso: number | null;
  dpo: number | null;
}

export interface TurnoverReport {
  from: string;
  to: string;
  days: number;
  totalCount: number;
  rows: TurnoverRow[];
  totals: { opening: number; debit: number; credit: number; closing: number; sales: number; purchases: number; dso: number | null; dpo: number | null };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const dateOrNull = (v: unknown): string | null => (v ? str(v).slice(0, 10) : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function mapBalanceReport(payload: unknown): BalanceReport {
  const d = (payload ?? {}) as Record<string, unknown>;
  const totals = (d.totals ?? {}) as Record<string, unknown>;
  const kpi = (d.kpi ?? {}) as Record<string, unknown>;
  const tab = d.tab === "creditors" || d.tab === "net" ? d.tab : "debtors";
  return {
    asOf: str(d.as_of).slice(0, 10),
    tab,
    totalCount: num(d.total_count),
    rows: arr(d.rows).map((r) => ({
      partnerId: str(r.partner_id),
      name: str(r.partner_name),
      phone: str(r.phone),
      voen: str(r.voen),
      isCustomer: r.is_customer === true,
      isSupplier: r.is_supplier === true,
      isDeleted: r.is_deleted === true,
      balance: cents(num(r.balance)),
      receivable: cents(num(r.receivable)),
      payable: cents(num(r.payable)),
      overdue: cents(num(r.overdue)),
      oldestOverdueDays: numOrNull(r.oldest_overdue_days),
      openCount: num(r.open_count),
      advance: cents(num(r.advance)),
      creditLimit: num(r.credit_limit),
      creditUsedPct: numOrNull(r.credit_used_pct),
      lastPaymentDate: dateOrNull(r.last_payment_date),
      lastPaymentAmount: numOrNull(r.last_payment_amount),
      paymentTermsDays: numOrNull(r.payment_terms_days),
    })),
    totals: { balance: cents(num(totals.balance)), overdue: cents(num(totals.overdue)), openCount: num(totals.open_count) },
    kpi: {
      totalReceivable: cents(num(kpi.total_receivable)),
      totalPayable: cents(num(kpi.total_payable)),
      net: cents(num(kpi.net)),
      overdueReceivable: cents(num(kpi.overdue_receivable)),
      topDebtors: arr(kpi.top_debtors).map((t) => ({ partnerId: str(t.partner_id), name: str(t.partner_name), balance: cents(num(t.balance)) })),
    },
  };
}

export function mapTurnoverReport(payload: unknown): TurnoverReport {
  const d = (payload ?? {}) as Record<string, unknown>;
  const t = (d.totals ?? {}) as Record<string, unknown>;
  return {
    from: str(d.from).slice(0, 10),
    to: str(d.to).slice(0, 10),
    days: num(d.days),
    totalCount: num(d.total_count),
    rows: arr(d.rows).map((r) => ({
      partnerId: str(r.partner_id),
      name: str(r.partner_name),
      phone: str(r.phone),
      isCustomer: r.is_customer === true,
      isSupplier: r.is_supplier === true,
      isDeleted: r.is_deleted === true,
      opening: cents(num(r.opening)),
      debit: cents(num(r.debit)),
      credit: cents(num(r.credit)),
      closing: cents(num(r.closing)),
      sales: cents(num(r.sales)),
      purchases: cents(num(r.purchases)),
      dso: numOrNull(r.dso),
      dpo: numOrNull(r.dpo),
    })),
    totals: {
      opening: cents(num(t.opening)),
      debit: cents(num(t.debit)),
      credit: cents(num(t.credit)),
      closing: cents(num(t.closing)),
      sales: cents(num(t.sales)),
      purchases: cents(num(t.purchases)),
      dso: numOrNull(t.dso),
      dpo: numOrNull(t.dpo),
    },
  };
}

// ── KPI formulas ──────────────────────────────────────────────────────────

/** % overdue = overdue receivable / total receivable × 100 (one decimal); null when nothing is owed. */
export function overduePct(kpi: Pick<Kpi, "overdueReceivable" | "totalReceivable">): number | null {
  if (kpi.totalReceivable <= 0) return null;
  return Math.round((kpi.overdueReceivable / kpi.totalReceivable) * 1000) / 10;
}

/** DSO = average receivable / credit sales × days (one decimal); null without sales. */
export function dso(receivableStart: number, receivableEnd: number, sales: number, days: number): number | null {
  if (sales <= 0 || days <= 0) return null;
  return Math.round((((receivableStart + receivableEnd) / 2 / sales) * days) * 10) / 10;
}

/** DPO = average payable / purchases × days (one decimal); null without purchases. */
export function dpo(payableStart: number, payableEnd: number, purchases: number, days: number): number | null {
  return dso(payableStart, payableEnd, purchases, days);
}

/** Credit use warns above 100 %. */
export function overCreditLimit(row: Pick<BalanceRow, "creditUsedPct">): boolean {
  return (row.creditUsedPct ?? 0) > 100;
}

/** Bar widths (0–100 %) of the top-debtors chart, against the biggest one. */
export function barWidths(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? Math.max(0, Math.round((v / max) * 1000) / 10) : 0));
}

// ── URL state ─────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const firstOfMonth = (today: string) => `${today.slice(0, 7)}-01`;

export function defaultDebtorQuery(today: string): DebtorQuery {
  return {
    tab: "debtors",
    asOf: today,
    from: firstOfMonth(today),
    to: today,
    sort: "balance",
    dir: "desc",
    page: 1,
    pageSize: 50,
    type: "all",
    minAmount: null,
    currency: "",
    userId: "",
    overdueOnly: false,
    overLimitOnly: false,
    search: "",
  };
}

/** Reads the URL (?tab=&asOf=&from=&to=&type=&min=&ccy=&user=&overdue=1&overLimit=1&q=&sort=&dir=&page=&size=). */
export function parseDebtorQuery(params: { get(name: string): string | null }, today: string): DebtorQuery {
  const d = defaultDebtorQuery(today);
  const g = (k: string) => params.get(k);
  const tab = (DEBTOR_TABS as readonly string[]).includes(g("tab") ?? "") ? (g("tab") as DebtorTab) : d.tab;
  const date = (v: string | null, fallback: string) => (v && DATE_RE.test(v) ? v : fallback);
  const to = date(g("to"), d.to);
  let from = date(g("from"), d.from);
  if (from > to) from = firstOfMonth(to);
  const sorts: readonly string[] = tab === "turnover" ? TURNOVER_SORTS : BALANCE_SORTS;
  const sort = sorts.includes(g("sort") ?? "") ? (g("sort") as string) : tab === "turnover" ? "name" : "balance";
  const dir = g("dir") === "asc" || g("dir") === "desc" ? (g("dir") as "asc" | "desc") : tab === "turnover" ? "asc" : "desc";
  const min = Number(g("min"));
  const type = g("type");
  const size = Number(g("size"));
  const page = Math.floor(Number(g("page")));
  const ccy = (g("ccy") ?? "").trim().toUpperCase();
  return {
    tab,
    asOf: date(g("asOf"), d.asOf),
    from,
    to,
    sort,
    dir,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : d.pageSize,
    type: type === "customer" || type === "supplier" || type === "partner" ? type : "all",
    minAmount: g("min") !== null && g("min") !== "" && Number.isFinite(min) && min > 0 ? min : null,
    currency: /^[A-Z]{3}$/.test(ccy) ? ccy : "",
    userId: UUID_RE.test(g("user") ?? "") ? (g("user") as string) : "",
    overdueOnly: g("overdue") === "1",
    overLimitOnly: g("overLimit") === "1",
    search: (g("q") ?? "").slice(0, 100),
  };
}

/** The URL of a query: only what differs from the defaults. */
export function debtorQueryString(q: DebtorQuery, today: string): string {
  const d = defaultDebtorQuery(today);
  const sp = new URLSearchParams();
  if (q.tab !== d.tab) sp.set("tab", q.tab);
  if (q.tab === "turnover") {
    if (q.from !== d.from) sp.set("from", q.from);
    if (q.to !== d.to) sp.set("to", q.to);
  } else if (q.asOf !== d.asOf) sp.set("asOf", q.asOf);
  if (q.type !== "all") sp.set("type", q.type);
  if (q.minAmount !== null) sp.set("min", String(q.minAmount));
  if (q.currency) sp.set("ccy", q.currency);
  if (q.userId) sp.set("user", q.userId);
  if (q.overdueOnly) sp.set("overdue", "1");
  if (q.overLimitOnly) sp.set("overLimit", "1");
  if (q.search) sp.set("q", q.search);
  const defSort = q.tab === "turnover" ? "name" : "balance";
  const defDir = q.tab === "turnover" ? "asc" : "desc";
  if (q.sort !== defSort || q.dir !== defDir) {
    sp.set("sort", q.sort);
    sp.set("dir", q.dir);
  }
  if (q.page > 1) sp.set("page", String(q.page));
  if (q.pageSize !== d.pageSize) sp.set("size", String(q.pageSize));
  return sp.toString();
}

/** A changed query: filters, tab or dates send the user back to page 1; switching tab resets the sort. */
export function patchQuery(q: DebtorQuery, patch: Partial<DebtorQuery>): DebtorQuery {
  const next = { ...q, ...patch };
  if (patch.tab && patch.tab !== q.tab) {
    const turnover = patch.tab === "turnover";
    const wasTurnover = q.tab === "turnover";
    if (turnover !== wasTurnover) {
      next.sort = turnover ? "name" : "balance";
      next.dir = turnover ? "asc" : "desc";
    }
  }
  if (!("page" in patch)) next.page = 1;
  return next;
}

/** Clicking a column header: same column flips the direction, a new one starts descending (names ascending). */
export function nextSort(q: Pick<DebtorQuery, "sort" | "dir">, key: string): { sort: string; dir: "asc" | "desc" } {
  if (q.sort === key) return { sort: key, dir: q.dir === "asc" ? "desc" : "asc" };
  return { sort: key, dir: key === "name" ? "asc" : "desc" };
}

/** The RPC's filters jsonb. */
export function filtersJson(q: ReportFilters): Record<string, string | number | boolean> {
  const f: Record<string, string | number | boolean> = {};
  if (q.type !== "all") f.type = q.type;
  if (q.minAmount !== null) f.min_amount = q.minAmount;
  if (q.currency) f.currency = q.currency;
  if (q.userId) f.user_id = q.userId;
  if (q.overdueOnly) f.overdue_only = true;
  if (q.overLimitOnly) f.over_limit_only = true;
  if (q.search.trim()) f.search = q.search.trim();
  return f;
}

export function pageCount(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / Math.max(1, pageSize)));
}

/** File name: debtors-<tab>-<as of | from_to>.<ext>. */
export function debtorFileName(q: Pick<DebtorQuery, "tab" | "asOf" | "from" | "to">, ext: "xlsx" | "pdf"): string {
  return q.tab === "turnover" ? `partner-turnover-${q.from}-${q.to}.${ext}` : `${q.tab}-${q.asOf}.${ext}`;
}

// ── Excel ─────────────────────────────────────────────────────────────────

export interface ReportSheet {
  name: string;
  rows: XlsxCell[][];
  widths: number[];
  boldRows: number[];
}

export interface SheetColumn<R> {
  header: string;
  kind: "text" | "money" | "number" | "date" | "percent";
  value: (row: R) => string | number | null;
}

/** A sheet: title, the filter lines (as of / period and every filter set), the header, the rows, the totals row. */
export function buildReportSheet<R>(input: {
  name: string;
  title: string;
  filterLines: readonly [string, string][];
  columns: readonly SheetColumn<R>[];
  rows: readonly R[];
  totals?: Readonly<Record<number, number | null>>;
  totalsLabel: string;
}): ReportSheet {
  const rows: XlsxCell[][] = [];
  const bold: number[] = [];
  const text = (v: string): XlsxCell => (v ? { t: "s", v } : { t: "z" });
  const cell = (kind: SheetColumn<R>["kind"], v: string | number | null): XlsxCell => {
    if (v === null || v === "") return { t: "z" };
    if (kind === "money") return { t: "n", v: cents(Number(v)), z: XLSX_FORMATS.money };
    if (kind === "number") return { t: "n", v: Number(v), z: Number.isInteger(Number(v)) ? XLSX_FORMATS.integer : "0.0" };
    if (kind === "percent") return { t: "n", v: Number(v), z: "0.0" };
    if (kind === "date") return toXlsxCell("date", v);
    return text(String(v));
  };
  bold.push(0);
  rows.push([text(input.title)]);
  for (const [label, value] of input.filterLines) rows.push([text(label), text(value)]);
  rows.push([]);
  bold.push(rows.length);
  rows.push(input.columns.map((c) => text(c.header)));
  for (const r of input.rows) rows.push(input.columns.map((c) => cell(c.kind, c.value(r))));
  if (input.totals) {
    bold.push(rows.length);
    rows.push(input.columns.map((c, i) => (i === 0 ? text(input.totalsLabel) : input.totals![i] !== undefined ? cell(c.kind, input.totals![i]) : { t: "z" })));
  }
  const widths = input.columns.map((_, i) =>
    Math.min(
      i === 0 ? 48 : 22,
      Math.max(
        10,
        ...rows.map((r) => {
          const x = r[i];
          if (!x || x.t === "z") return 0;
          return x.t === "n" ? String(Math.trunc(Math.abs(Number(x.v)))).length + 5 : String(x.v).length + 2;
        })
      )
    )
  );
  return { name: input.name, rows, widths, boldRows: bold };
}
