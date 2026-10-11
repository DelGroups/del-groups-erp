/**
 * Expense documents (public.expenses): shared types and pure helpers.
 * Safe to import from client components.
 */

export type ExpenseStatus = "draft" | "submitted" | "approved" | "posted" | "cancelled";

export const EXPENSE_STATUSES: ExpenseStatus[] = [
  "draft",
  "submitted",
  "approved",
  "posted",
  "cancelled",
];

export type ExpensePaymentMode = "company" | "employee";

export interface ExpenseDocument {
  id: string;
  code: string;
  expense_date: string;
  status: ExpenseStatus;
  /** company: paid from a kassa/bank; employee: paid by an employee, reimbursed later. */
  payment_mode: ExpensePaymentMode;
  employee_id: string | null;
  employee_name: string | null;
  rejected_reason: string | null;
  category_id: string | null;
  category: string;
  account_id: string | null;
  account_name: string | null;
  /** ƏDV deposit account the VAT part was (or will be) paid from; null = from account_id. */
  vat_account_id: string | null;
  vat_account_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  payee: string | null;
  reference_no: string | null;
  description: string | null;
  notes: string | null;
  department_id: string | null;
  department_name: string | null;
  production_order_id: string | null;
  net_amount: number;
  vat_rate: number;
  vat_amount: number;
  amount: number;
  cancel_reason: string | null;
  created_at: string | null;
  /** Posted by another module (production); cancelled from there, not here. */
  is_production: boolean;
  /** Receipts / invoices attached to the document. */
  attachment_count: number;
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  accountId?: string;
  supplierId?: string;
  departmentId?: string;
  status?: ExpenseStatus | "";
  search?: string;
}

export interface ExpenseSaveInput {
  id?: string;
  expenseDate: string;
  categoryId: string;
  accountId: string;
  /** Pay the VAT part from this (ƏDV deposit) account; company-paid with VAT only. */
  vatAccountId?: string;
  supplierId?: string;
  payee?: string;
  referenceNo?: string;
  description?: string;
  notes?: string;
  departmentId?: string;
  paymentMode: ExpensePaymentMode;
  employeeId?: string;
  netAmount: number;
  vatRate?: number;
  vatAmount?: number;
  /** true: pay from kassa/bank and post to the ledger now (company-paid only). */
  post: boolean;
  /** true: send for approval after saving. */
  submit?: boolean;
}

export interface ExpenseCategoryTotal {
  category: string;
  count: number;
  amount: number;
}

export interface ExpenseSummary {
  /** Booked expenses: paid, plus employee-paid ones approved but not yet reimbursed. */
  count: number;
  net: number;
  vat: number;
  total: number;
  /** Drafts and documents waiting for approval. */
  pendingCount: number;
  pendingTotal: number;
  /** Approved employee-paid expenses the company still owes. */
  owedCount: number;
  owedTotal: number;
  byCategory: ExpenseCategoryTotal[];
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeVat(net: number, ratePercent: number): number {
  if (!Number.isFinite(net) || !Number.isFinite(ratePercent) || net <= 0 || ratePercent <= 0) {
    return 0;
  }
  return roundMoney((net * ratePercent) / 100);
}

/** Splits a VAT-inclusive total into net + VAT at the given rate. */
export function splitGross(gross: number, ratePercent: number): { net: number; vat: number } {
  if (!Number.isFinite(gross) || gross <= 0) return { net: 0, vat: 0 };
  if (!Number.isFinite(ratePercent) || ratePercent <= 0) return { net: roundMoney(gross), vat: 0 };
  const net = roundMoney(gross / (1 + ratePercent / 100));
  return { net, vat: roundMoney(gross - net) };
}

/** True when an employee-paid expense is approved but not reimbursed yet. */
export function isOwedToEmployee(row: Pick<ExpenseDocument, "status" | "payment_mode">): boolean {
  return row.payment_mode === "employee" && row.status === "approved";
}

/** Totals by state; cancelled documents are left out. */
export function summarizeExpenses(rows: ExpenseDocument[]): ExpenseSummary {
  const byCategory = new Map<string, ExpenseCategoryTotal>();
  let count = 0;
  let net = 0;
  let vat = 0;
  let total = 0;
  let pendingCount = 0;
  let pendingTotal = 0;
  let owedCount = 0;
  let owedTotal = 0;

  for (const row of rows) {
    if (row.status === "cancelled") continue;
    if (row.status === "draft" || row.status === "submitted") {
      pendingCount += 1;
      pendingTotal += row.amount;
      continue;
    }
    if (isOwedToEmployee(row)) {
      owedCount += 1;
      owedTotal += row.amount;
    }
    count += 1;
    net += row.net_amount;
    vat += row.vat_amount;
    total += row.amount;
    const key = row.category || "—";
    const bucket = byCategory.get(key) || { category: key, count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += row.amount;
    byCategory.set(key, bucket);
  }

  return {
    count,
    net: roundMoney(net),
    vat: roundMoney(vat),
    total: roundMoney(total),
    pendingCount,
    pendingTotal: roundMoney(pendingTotal),
    owedCount,
    owedTotal: roundMoney(owedTotal),
    byCategory: Array.from(byCategory.values())
      .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** Today in Baku, as YYYY-MM-DD. */
export function todayIsoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baku",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function firstDayOfMonthIsoDate(now: Date = new Date()): string {
  return `${todayIsoDate(now).slice(0, 7)}-01`;
}

/** The account VAT is normally paid from: flagged is_vat_account, else named "ƏDV"/"EDV". */
export function guessVatAccountId(
  accounts: Array<{ id: string; name: string; is_vat_account?: boolean }>
): string {
  const flagged = accounts.find((a) => a.is_vat_account);
  if (flagged) return flagged.id;
  const named = accounts.find((a) => /^\s*(ə|e)dv(\s|$)/i.test(a.name));
  return named?.id || "";
}

/* ------------------------------------------------------------------ */
/* Attachments (receipts, invoices)                                    */
/* ------------------------------------------------------------------ */

export const EXPENSE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Allowed MIME types and the extension used for the stored object. */
export const EXPENSE_ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export interface ExpenseAttachment {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  /** Short-lived signed link for viewing/downloading. */
  url: string | null;
}

/** Normalises a browser-reported MIME type (some report image/jpg). */
export function normalizeAttachmentMime(mime: string): string {
  const value = String(mime || "").trim().toLowerCase();
  return value === "image/jpg" ? "image/jpeg" : value;
}

/** Checks type and size before an upload; returns an error message or null. */
export function validateExpenseAttachment(file: { type: string; size: number }): string | null {
  if (!EXPENSE_ATTACHMENT_TYPES[normalizeAttachmentMime(file.type)]) {
    return "Yalnız PDF, JPG, PNG, WEBP və ya HEIC fayl əlavə etmək olar";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return "Fayl boşdur";
  if (file.size > EXPENSE_ATTACHMENT_MAX_BYTES) return "Fayl 10 MB-dan böyük ola bilməz";
  return null;
}

/** True when a storage path is one this module hands out for the given expense. */
export function isExpenseAttachmentPath(expenseId: string, path: string): boolean {
  const extensions = Array.from(new Set(Object.values(EXPENSE_ATTACHMENT_TYPES))).join("|");
  const pattern = new RegExp(`^${expenseId}/[0-9a-f-]{36}\\.(${extensions})$`);
  return pattern.test(path);
}

/* ------------------------------------------------------------------ */
/* Monthly report                                                      */
/* ------------------------------------------------------------------ */

export type ExpenseReportGroup = "category" | "department";

export interface ExpenseReportLine {
  label: string;
  byMonth: Record<string, number>;
  total: number;
}

export interface ExpenseMonthlyReport {
  /** YYYY-MM, oldest first, every month between the first and last expense. */
  months: string[];
  lines: ExpenseReportLine[];
  monthTotals: Record<string, number>;
  total: number;
}

/** Every YYYY-MM from `from` to `to`, inclusive. */
export function monthRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return from ? [from] : [];
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/**
 * Booked expenses (paid, or employee-paid and approved) by month and by
 * category or department. Drafts, pending and cancelled documents are left out,
 * matching the "total" card.
 */
export function buildMonthlyReport(
  rows: ExpenseDocument[],
  group: ExpenseReportGroup,
  emptyLabel = "—"
): ExpenseMonthlyReport {
  const booked = rows.filter((row) => row.status === "posted" || row.status === "approved");
  const lines = new Map<string, ExpenseReportLine>();
  const monthTotals: Record<string, number> = {};
  let total = 0;
  let first = "";
  let last = "";

  for (const row of booked) {
    const month = String(row.expense_date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (!first || month < first) first = month;
    if (!last || month > last) last = month;
    const raw = group === "category" ? row.category : row.department_name;
    const label = String(raw || "").trim() || emptyLabel;
    const line = lines.get(label) || { label, byMonth: {}, total: 0 };
    line.byMonth[month] = (line.byMonth[month] || 0) + row.amount;
    line.total += row.amount;
    lines.set(label, line);
    monthTotals[month] = (monthTotals[month] || 0) + row.amount;
    total += row.amount;
  }

  const months = monthRange(first, last);
  for (const month of months) monthTotals[month] = roundMoney(monthTotals[month] || 0);

  return {
    months,
    lines: Array.from(lines.values())
      .map((line) => ({
        label: line.label,
        total: roundMoney(line.total),
        byMonth: Object.fromEntries(
          Object.entries(line.byMonth).map(([month, amount]) => [month, roundMoney(amount)])
        ),
      }))
      .sort((a, b) => b.total - a.total),
    monthTotals,
    total: roundMoney(total),
  };
}
