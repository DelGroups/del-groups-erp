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

export interface ExpenseDocument {
  id: string;
  code: string;
  expense_date: string;
  status: ExpenseStatus;
  category_id: string | null;
  category: string;
  account_id: string | null;
  account_name: string | null;
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
  supplierId?: string;
  payee?: string;
  referenceNo?: string;
  description?: string;
  notes?: string;
  departmentId?: string;
  netAmount: number;
  vatRate?: number;
  vatAmount?: number;
  /** true: post to kassa/bank and the ledger now; false: keep as draft. */
  post: boolean;
}

export interface ExpenseCategoryTotal {
  category: string;
  count: number;
  amount: number;
}

export interface ExpenseSummary {
  count: number;
  net: number;
  vat: number;
  total: number;
  draftCount: number;
  draftTotal: number;
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

/** Totals for posted and draft documents; cancelled ones are left out. */
export function summarizeExpenses(rows: ExpenseDocument[]): ExpenseSummary {
  const byCategory = new Map<string, ExpenseCategoryTotal>();
  let count = 0;
  let net = 0;
  let vat = 0;
  let total = 0;
  let draftCount = 0;
  let draftTotal = 0;

  for (const row of rows) {
    if (row.status === "cancelled") continue;
    if (row.status !== "posted") {
      draftCount += 1;
      draftTotal += row.amount;
      continue;
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
    draftCount,
    draftTotal: roundMoney(draftTotal),
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
