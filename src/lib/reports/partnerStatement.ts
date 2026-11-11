/**
 * Partner statement (LED-3, "Hesab çıxarışı"): the shape of get_partner_statement (LED-1, with the
 * details of 20261113100000), its running balance, per-currency subtotals, date presets, document
 * links, the Excel sheet and the mapping the reconciliation act uses. Pure: covered by node --test.
 *
 * Sign rule (LED-1): debit = the partner owes us more, credit = less; balance = opening + Σ(debit − credit).
 * A positive balance is a debtor (they owe us), a negative one a creditor (we owe them).
 */
import type { PartnerReconciliationReport } from "./partnerReconciliation";
import { toXlsxCell, XLSX_FORMATS, type XlsxCell } from "@/lib/export/exportXlsx";

export type StatementSide = "net" | "receivable" | "payable";
export type PartnerTypeFilter = "all" | "customer" | "supplier" | "partner";
export type StatementPreset = "thisMonth" | "lastMonth" | "thisYear" | "allTime";
export type StatementStatus = "debtor" | "creditor" | "settled";
export type StatementDocKind = "sale" | "purchase" | "production" | "import";

export interface StatementPartner {
  id: string;
  name: string;
  voen: string;
  phone: string;
  email: string;
  address: string;
  creditLimit: number;
  paymentTermsDays: number | null;
  isCustomer: boolean;
  isSupplier: boolean;
  isDeleted: boolean;
}

export interface StatementLine {
  entryDate: string;
  sourceType: string;
  sourceId: string;
  docNo: string;
  description: string;
  debit: number;
  credit: number;
  currencyCode: string;
  amountFc: number;
  rate: number;
  dueDate: string | null;
  side: "receivable" | "payable";
  balance: number;
  docKind: StatementDocKind | null;
  docId: string | null;
  createdByName: string;
}

export interface CurrencySubtotal {
  currencyCode: string;
  debit: number;
  credit: number;
  /** Signed foreign amount: + raises what the partner owes, − lowers it. */
  netFc: number;
}

export interface PartnerStatement {
  partner: StatementPartner;
  from: string | null;
  to: string;
  side: StatementSide;
  openingBalance: number;
  lines: StatementLine[];
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  currencies: CurrencySubtotal[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
/** Cents, without float noise (0.1 + 0.2). */
export const cents = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

const DOC_KINDS: readonly StatementDocKind[] = ["sale", "purchase", "production", "import"];

/** The partner's name as the lists show it: full name, else company, else the short name. */
export function statementPartnerName(p: Record<string, unknown>): string {
  return str(p.full_name).trim() || str(p.company_name).trim() || str(p.name).trim();
}

/** Running balance from the opening balance, line by line, in cents. */
export function runningBalances(opening: number, lines: readonly { debit: number; credit: number }[]): number[] {
  let balance = cents(opening);
  return lines.map((l) => (balance = cents(balance + l.debit - l.credit)));
}

export function mapPartnerStatement(payload: unknown): PartnerStatement {
  const data = (payload ?? {}) as Record<string, unknown>;
  const p = (data.partner ?? {}) as Record<string, unknown>;
  const rawLines = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
  const openingBalance = cents(num(data.opening_balance));
  const lines: StatementLine[] = rawLines.map((l) => {
    const kind = str(l.doc_kind);
    return {
      entryDate: str(l.entry_date).slice(0, 10),
      sourceType: str(l.source_type),
      sourceId: str(l.source_id),
      docNo: str(l.doc_no),
      description: str(l.description),
      debit: cents(num(l.debit)),
      credit: cents(num(l.credit)),
      currencyCode: str(l.currency_code) || "AZN",
      amountFc: cents(num(l.amount_fc)),
      rate: num(l.rate) || 1,
      dueDate: l.due_date ? str(l.due_date).slice(0, 10) : null,
      side: l.side === "payable" ? "payable" : "receivable",
      balance: 0,
      docKind: (DOC_KINDS as readonly string[]).includes(kind) ? (kind as StatementDocKind) : null,
      docId: l.doc_id ? str(l.doc_id) : null,
      createdByName: str(l.created_by_name),
    };
  });
  runningBalances(openingBalance, lines).forEach((b, i) => (lines[i].balance = b));
  const side = data.side === "receivable" || data.side === "payable" ? data.side : "net";
  const periodDebit = cents(num(data.period_debit));
  const periodCredit = cents(num(data.period_credit));
  return {
    partner: {
      id: str(p.id),
      name: statementPartnerName(p),
      voen: str(p.voen),
      phone: str(p.phone),
      email: str(p.email),
      address: str(p.address),
      creditLimit: num(p.credit_limit),
      paymentTermsDays: p.payment_terms_days === null || p.payment_terms_days === undefined ? null : num(p.payment_terms_days),
      isCustomer: p.is_customer === true,
      isSupplier: p.is_supplier === true,
      isDeleted: p.is_deleted === true,
    },
    from: data.from ? str(data.from).slice(0, 10) : null,
    to: str(data.to).slice(0, 10),
    side,
    openingBalance,
    lines,
    periodDebit,
    periodCredit,
    closingBalance: data.closing_balance === undefined ? cents(openingBalance + periodDebit - periodCredit) : cents(num(data.closing_balance)),
    currencies: (Array.isArray(data.currencies) ? (data.currencies as Record<string, unknown>[]) : []).map((c) => ({
      currencyCode: str(c.currency_code) || "AZN",
      debit: cents(num(c.debit)),
      credit: cents(num(c.credit)),
      netFc: cents(num(c.net_fc)),
    })),
  };
}

/** Debtor (owes us), creditor (we owe them) or settled, with a half-cent tolerance. */
export function statementStatus(balance: number): StatementStatus {
  if (balance > 0.005) return "debtor";
  if (balance < -0.005) return "creditor";
  return "settled";
}

/** The currency and foreign amount columns show only when a line is not in AZN. */
export function hasForeignCurrency(lines: readonly Pick<StatementLine, "currencyCode">[]): boolean {
  return lines.some((l) => l.currencyCode.toUpperCase() !== "AZN");
}

/** Per-currency subtotals show only when the period has more than one currency. */
export function visibleSubtotals(statement: Pick<PartnerStatement, "currencies">): CurrencySubtotal[] {
  return statement.currencies.length > 1 ? statement.currencies : [];
}

/** Per-currency subtotals computed from the lines (same rule as the RPC). */
export function currencySubtotals(lines: readonly StatementLine[]): CurrencySubtotal[] {
  const by = new Map<string, CurrencySubtotal>();
  for (const l of lines) {
    const c = by.get(l.currencyCode) ?? { currencyCode: l.currencyCode, debit: 0, credit: 0, netFc: 0 };
    c.debit = cents(c.debit + l.debit);
    c.credit = cents(c.credit + l.credit);
    c.netFc = cents(c.netFc + (l.debit >= l.credit ? Math.abs(l.amountFc) : -Math.abs(l.amountFc)));
    by.set(l.currencyCode, c);
  }
  return [...by.values()].sort((a, b) => a.currencyCode.localeCompare(b.currencyCode));
}

/** The side switch shows only for a partner who is both a customer and a supplier. */
export function showSideSwitch(partner: Pick<StatementPartner, "isCustomer" | "isSupplier">): boolean {
  return partner.isCustomer && partner.isSupplier;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** A preset's range for `today` (yyyy-mm-dd). "All time" has no start. */
export function presetRange(preset: StatementPreset, today: string): { from: string | null; to: string } {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "thisMonth":
      return { from: ymd(y, m, 1), to: today };
    case "lastMonth": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      return { from: ymd(py, pm, 1), to: ymd(py, pm, last) };
    }
    case "thisYear":
      return { from: ymd(y, 1, 1), to: today };
    case "allTime":
      return { from: null, to: today };
  }
}

/** Twelve months back from `today` (the partner page's Ledger tab). */
export function lastTwelveMonths(today: string): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const back = new Date(Date.UTC(y - 1, m - 1, d));
  // 29 Feb → 1 Mar of the year before is fine; add a day so the range is twelve months exactly.
  back.setUTCDate(back.getUTCDate() + 1);
  return { from: ymd(back.getUTCFullYear(), back.getUTCMonth() + 1, back.getUTCDate()), to: today };
}

/** The preset a range is, if any (for the selected chip). */
export function presetOf(from: string | null, to: string, today: string): StatementPreset | null {
  for (const p of ["thisMonth", "lastMonth", "thisYear", "allTime"] as const) {
    const r = presetRange(p, today);
    if (r.from === from && r.to === to) return p;
  }
  return null;
}

/** Where a line's document opens (null: no screen, e.g. an opening balance or a free payment). */
export function statementDocHref(line: Pick<StatementLine, "docKind" | "docId">): string | null {
  if (!line.docKind || !line.docId) return null;
  switch (line.docKind) {
    case "sale":
      return `/sales/${line.docId}`;
    case "purchase":
      return `/purchases?record=${line.docId}`;
    case "production":
      return `/production/${line.docId}`;
    case "import":
      return `/imports/${line.docId}`;
  }
}

/** i18n key of a line's document type ("partnerStatement.source.<group>"). */
export function sourceGroup(sourceType: string): string {
  if (sourceType === "sale" || sourceType === "purchase") return sourceType;
  if (sourceType.startsWith("opening")) return "opening";
  if (sourceType.endsWith("_reversal")) return "reversal";
  if (sourceType.startsWith("import")) return sourceType.includes("payment") || sourceType.includes("prepayment") || sourceType.includes("advance") ? "importPayment" : "import";
  if (sourceType.endsWith("payment")) return "payment";
  return "other";
}

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[əƏ]/g, "e")
    .replace(/[ıİ]/g, "i")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40) || "partner";

/** statement-<partner>-<from>-<to>.<ext>; "all" when the range has no start. */
export function statementFileName(partnerName: string, from: string | null, to: string, ext: "xlsx" | "pdf"): string {
  return `statement-${slug(partnerName)}-${from ?? "all"}-${to}.${ext}`;
}

// ── URL state ───────────────────────────────────────────────────────────────

export interface StatementQuery {
  partnerId: string;
  from: string | null;
  to: string;
  side: StatementSide;
  type: PartnerTypeFilter;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads ?partnerId=&from=&to=&side=&type= (bad values fall back to the defaults: this month). */
export function parseStatementQuery(params: { get(name: string): string | null }, today: string): StatementQuery {
  const partnerId = params.get("partnerId") ?? "";
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const def = presetRange("thisMonth", today);
  const validTo = !!rawTo && DATE_RE.test(rawTo);
  const to = validTo ? (rawTo as string) : def.to;
  // No start with a valid end (a link "up to a date") means from the beginning.
  const from = rawFrom === "all" ? null : rawFrom && DATE_RE.test(rawFrom) ? rawFrom : validTo && !rawFrom ? null : def.from;
  const side = params.get("side");
  const type = params.get("type");
  return {
    partnerId: UUID_RE.test(partnerId) ? partnerId : "",
    from: from && from > to ? def.from : from,
    to,
    side: side === "receivable" || side === "payable" ? side : "net",
    type: type === "customer" || type === "supplier" || type === "partner" ? type : "all",
  };
}

export function statementQueryString(q: StatementQuery): string {
  const sp = new URLSearchParams();
  if (q.partnerId) sp.set("partnerId", q.partnerId);
  sp.set("from", q.from ?? "all");
  sp.set("to", q.to);
  if (q.side !== "net") sp.set("side", q.side);
  if (q.type !== "all") sp.set("type", q.type);
  return sp.toString();
}

/** Deep link to the statement of one partner (lists, partner page, debtor reports). */
export function partnerStatementHref(partnerId: string): string {
  return `/dashboard/reports/partner-statement?partnerId=${encodeURIComponent(partnerId)}`;
}

/** The lookup's filter for a partner type ("partner" = both customer and supplier). */
export function partnerTypeWhere(type: PartnerTypeFilter): Readonly<Record<string, boolean>> | undefined {
  switch (type) {
    case "customer":
      return { is_customer: true };
    case "supplier":
      return { is_supplier: true };
    case "partner":
      return { is_customer: true, is_supplier: true };
    default:
      return undefined;
  }
}

// ── Reconciliation act on the ledger ────────────────────────────────────────

/** The reconciliation act's report from a statement: same document layout, ledger numbers. */
export function statementToReconciliation(s: PartnerStatement, startDate: string, endDate: string): PartnerReconciliationReport {
  return {
    partnerId: s.partner.id,
    partnerName: s.partner.name,
    startDate,
    endDate,
    initialBalance: s.openingBalance,
    closingBalance: s.closingBalance,
    lines: s.lines.map((l) => {
      const group = sourceGroup(l.sourceType);
      return {
        entryDate: l.entryDate,
        documentNo: l.docNo || "—",
        documentType:
          group === "sale" ? "invoice" : group === "purchase" ? "bill" : group === "payment" || group === "importPayment" ? (l.credit > 0 ? "payment_receipt" : "payment_disbursement") : `statement:${group}`,
        ourDebit: l.debit,
        ourCredit: l.credit,
        runningBalance: l.balance,
      };
    }),
  };
}

// ── Excel ───────────────────────────────────────────────────────────────────

export interface StatementSheetLabels {
  title: string;
  partner: string;
  voen: string;
  phone: string;
  creditLimit: string;
  paymentTerms: string;
  period: string;
  allTime: string;
  side: string;
  sideName: string;
  company: string;
  companyName: string;
  opening: string;
  closing: string;
  status: string;
  statusName: string;
  totals: string;
  cols: { date: string; type: string; docNo: string; description: string; debit: string; credit: string; balance: string; currency: string; amountFc: string; createdBy: string };
  typeName: (sourceType: string) => string;
  subtotals: string;
}

export interface StatementSheet {
  name: string;
  rows: XlsxCell[][];
  widths: number[];
  /** 0-based row indexes written bold. */
  boldRows: number[];
}

/** One sheet: a header block, the opening row, the lines, the totals row, then per-currency subtotals. */
export function buildStatementSheet(s: PartnerStatement, l: StatementSheetLabels): StatementSheet {
  const rows: XlsxCell[][] = [];
  const bold: number[] = [];
  const text = (v: string): XlsxCell => (v ? { t: "s", v } : { t: "z" });
  const money = (v: number): XlsxCell => ({ t: "n", v: cents(v), z: XLSX_FORMATS.money });
  const push = (cells: XlsxCell[], isBold = false) => {
    if (isBold) bold.push(rows.length);
    rows.push(cells);
  };
  const field = (label: string, value: XlsxCell) => push([text(label), value]);
  const foreign = hasForeignCurrency(s.lines);

  push([text(l.title)], true);
  if (l.companyName) field(l.company, text(l.companyName));
  field(l.partner, text(s.partner.name));
  if (s.partner.voen) field(l.voen, text(s.partner.voen));
  if (s.partner.phone) field(l.phone, text(s.partner.phone));
  if (s.partner.creditLimit > 0) field(l.creditLimit, money(s.partner.creditLimit));
  if (s.partner.paymentTermsDays !== null) field(l.paymentTerms, { t: "n", v: s.partner.paymentTermsDays, z: XLSX_FORMATS.integer });
  field(l.period, text(`${s.from ?? l.allTime} — ${s.to}`));
  if (s.side !== "net") field(l.side, text(l.sideName));
  field(l.status, text(l.statusName));
  push([]);

  const c = l.cols;
  const header = [c.date, c.type, c.docNo, c.description, c.debit, c.credit, c.balance, ...(foreign ? [c.currency, c.amountFc] : []), c.createdBy];
  push(header.map(text), true);
  const blank = (n: number): XlsxCell[] => Array.from({ length: n }, () => ({ t: "z" }) as XlsxCell);
  push([s.from ? toXlsxCell("date", s.from) : { t: "z" }, text(l.opening), ...blank(4), money(s.openingBalance), ...blank(foreign ? 3 : 1)], true);
  for (const line of s.lines) {
    push([
      toXlsxCell("date", line.entryDate),
      text(l.typeName(line.sourceType)),
      text(line.docNo),
      text(line.description),
      line.debit ? money(line.debit) : { t: "z" },
      line.credit ? money(line.credit) : { t: "z" },
      money(line.balance),
      ...(foreign ? [text(line.currencyCode), { t: "n", v: line.amountFc, z: XLSX_FORMATS.money } as XlsxCell] : []),
      text(line.createdByName),
    ]);
  }
  push([toXlsxCell("date", s.to), text(l.totals), ...blank(2), money(s.periodDebit), money(s.periodCredit), money(s.closingBalance), ...blank(foreign ? 3 : 1)], true);

  const subtotals = visibleSubtotals(s);
  if (subtotals.length) {
    push([]);
    push([text(l.subtotals)], true);
    push([text(c.currency), { t: "z" }, { t: "z" }, { t: "z" }, text(c.debit), text(c.credit), text(c.amountFc)], true);
    for (const st of subtotals) push([text(st.currencyCode), { t: "z" }, { t: "z" }, { t: "z" }, money(st.debit), money(st.credit), { t: "n", v: st.netFc, z: XLSX_FORMATS.money }]);
  }
  push([]);
  field(l.closing, money(s.closingBalance));

  const width = (i: number) =>
    rows.reduce((m, r) => {
      const cell = r[i];
      if (!cell || cell.t === "z") return m;
      const len = cell.t === "n" ? String(Math.trunc(Math.abs(Number(cell.v)))).length + 4 : String(cell.v).length;
      return Math.max(m, len);
    }, 0);
  const widths = header.map((_, i) => Math.min(i === 3 ? 50 : 28, Math.max(10, width(i) + 2)));
  return { name: "Statement", rows, widths, boldRows: bold };
}
