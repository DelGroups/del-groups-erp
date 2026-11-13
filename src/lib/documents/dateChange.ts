/**
 * DATE-1: change the date of a posted sales or purchase invoice in place
 * (preview_document_date_change / apply_document_date_change, migration 20261110150000).
 * DATE-2 (migration 20261110151000): the same for cash documents: a payment booked on an
 * invoice, a partner payment, a manual cash row and an expense.
 * DATE-3 (migration 20261110152000): inventory and import documents: a stock transfer, a write-off,
 * an initial balance or stock receipt, a posted count, an import receipt and an import payment.
 * Pure: the dialog's steps and rules, so `node --test` covers them. The RPC calls live in
 * dateChangeApi.ts.
 */

import { formatGridDate } from "../dates/localeDate";

export const DATE_CHANGE_DOCUMENT_TYPES = [
  "sale",
  "purchase",
  "invoice_payment",
  "partner_payment",
  "cash_transaction",
  "expense",
  "stock_transfer",
  "inventory_writeoff",
  "inventory_initial_balance",
  "inventory_count",
  "import_receipt",
  "import_payment",
] as const;
export type DateChangeDocumentType = (typeof DATE_CHANGE_DOCUMENT_TYPES)[number];

export function isDateChangeDocumentType(value: unknown): value is DateChangeDocumentType {
  return typeof value === "string" && (DATE_CHANGE_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * The "also move payments made on the same day" option: invoices (their payments) and expenses
 * (an employee's reimbursement). A payment or a cash row is itself the payment: no option.
 */
export function dateChangePaymentsOption(type: DateChangeDocumentType): "invoice" | "expense" | null {
  if (type === "sale" || type === "purchase") return "invoice";
  if (type === "expense") return "expense";
  return null;
}

/** The counts the dialog lists for a document type (invoices move stock too; cash documents do not). */
export function dateChangeAffectedKeys(type: DateChangeDocumentType): ReadonlyArray<"journals" | "cash" | "stock_moves" | "batches" | "pieces" | "payments"> {
  if (type === "sale" || type === "purchase") return ["journals", "cash", "stock_moves", "batches", "pieces", "payments"];
  if (type === "partner_payment" || type === "import_payment") return ["journals", "cash", "payments"];
  if (type === "stock_transfer" || type === "inventory_writeoff") return ["stock_moves"];
  if (type === "inventory_initial_balance" || type === "inventory_count" || type === "import_receipt") return ["journals", "stock_moves", "batches"];
  return ["journals", "cash"];
}

/** resolve_date_change_document: which document a cash row belongs to. */
export interface ResolvedDateChangeDocument {
  type: DateChangeDocumentType;
  id: string;
  label: string;
  date: string | null;
}

export function parseResolvedDocument(data: unknown): ResolvedDateChangeDocument | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (!isDateChangeDocumentType(r.type) || typeof r.id !== "string" || !r.id) return null;
  return { type: r.type, id: r.id, label: typeof r.label === "string" && r.label ? r.label : r.id, date: typeof r.date === "string" ? r.date.slice(0, 10) : null };
}

export interface DateChangeIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface DateChangePreview {
  ok: boolean;
  old_date?: string;
  new_date?: string;
  label?: string;
  blockers: DateChangeIssue[];
  warnings: DateChangeIssue[];
  affected: Partial<Record<"journals" | "cash" | "stock_moves" | "batches" | "pieces" | "payments", number>>;
}

export interface DateChangeOptions {
  move_same_day_payments: boolean;
}

/** The dialog: fill in → checked (preview shown) → applying → done; editing goes back to fill in. */
export type DateChangeStep = "edit" | "checking" | "checked" | "applying" | "done";

export interface DateChangeState {
  step: DateChangeStep;
  newDate: string | null;
  reason: string;
  options: DateChangeOptions;
  preview: DateChangePreview | null;
  /** Warning codes the user ticked. */
  acknowledged: string[];
  error: string | null;
}

export type DateChangeAction =
  | { type: "date"; value: string | null }
  | { type: "reason"; value: string }
  | { type: "option"; key: keyof DateChangeOptions; value: boolean }
  | { type: "check" }
  | { type: "previewed"; preview: DateChangePreview }
  | { type: "acknowledge"; code: string; value: boolean }
  | { type: "apply" }
  | { type: "applied" }
  | { type: "failed"; message: string };

export function initialDateChangeState(newDate: string | null = null): DateChangeState {
  return { step: "edit", newDate, reason: "", options: { move_same_day_payments: false }, preview: null, acknowledged: [], error: null };
}

/**
 * Any change to the inputs drops the old check: the user must check again before applying
 * (the server runs the checks again anyway).
 */
export function dateChangeReducer(state: DateChangeState, action: DateChangeAction): DateChangeState {
  switch (action.type) {
    case "date":
      return { ...state, newDate: action.value, step: "edit", preview: null, acknowledged: [], error: null };
    case "option":
      return { ...state, options: { ...state.options, [action.key]: action.value }, step: "edit", preview: null, acknowledged: [], error: null };
    case "reason":
      return { ...state, reason: action.value, error: null };
    case "check":
      return { ...state, step: "checking", error: null };
    case "previewed":
      return { ...state, step: "checked", preview: action.preview, acknowledged: [] };
    case "acknowledge": {
      const rest = state.acknowledged.filter((c) => c !== action.code);
      return { ...state, acknowledged: action.value ? [...rest, action.code] : rest };
    }
    case "apply":
      return { ...state, step: "applying", error: null };
    case "applied":
      return { ...state, step: "done" };
    case "failed":
      return { ...state, step: state.preview ? "checked" : "edit", error: action.message };
  }
}

/** yyyy-mm-dd of today in Baku (the server's document_today()). */
export function bakuToday(now: Date = new Date()): string {
  const [d, m, y] = formatGridDate(now, { timeZone: "Asia/Baku" }).split(".");
  return `${y}-${m}-${d}`;
}

/** yyyy-mm-dd in Baku of a moment (a payment's timestamp); null when it does not parse. */
export function bakuIsoDate(value: string | Date): string | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : bakuToday(d);
}

/** Why "Check" is not possible yet (an i18n key), or null. */
export function checkBlockedReason(state: DateChangeState, currentDate: string | null, today: string = bakuToday()): string | null {
  if (!state.newDate) return "dateChange.errors.dateRequired";
  if (currentDate && state.newDate === currentDate) return "dateChange.errors.sameDate";
  if (state.newDate > today) return "dateChange.errors.future";
  return null;
}

/** "Apply" is possible: checked, no blocker, every warning ticked, a reason written. */
export function canApply(state: DateChangeState): boolean {
  if (state.step !== "checked" || !state.preview || !state.preview.ok || state.preview.blockers.length) return false;
  if (!state.reason.trim()) return false;
  return state.preview.warnings.every((w) => state.acknowledged.includes(w.code));
}

/** The issue codes the UI translates; an unknown code shows the server's (Azerbaijani) message. */
export const DATE_CHANGE_CODES = [
  "not_admin",
  "unsupported_document",
  "not_found",
  "not_posted",
  "same_date",
  "future_date",
  "period_closed_old",
  "period_closed_new",
  "stock_negative",
  "fifo_order",
  "polywood_order",
  "cash_negative",
  "payment_before_invoice",
  "slip_before_invoice",
  "inventory_count_between",
  "payment_before_its_invoice",
  "reimbursement_before_expense",
  "expense_before_source",
  "reposted_document",
  "count_polywood_switch",
  "import_before_confirm",
  "import_payment_before_payable",
  "fx_rate_kept",
  "other_month",
  "payments_move",
  "far_back",
] as const;

/** The translated text of an issue, else the server's message. */
export function issueText(issue: DateChangeIssue, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!(DATE_CHANGE_CODES as readonly string[]).includes(issue.code)) return issue.message;
  const count = typeof issue.details?.count === "number" ? issue.details.count : 0;
  return t(`dateChange.issues.${issue.code}`, { count });
}

/** The items under an issue ("MDF 18 mm · Əsas anbar · 12.10.2026 · −3"), one line each. */
export function issueItems(issue: DateChangeIssue): string[] {
  const items = Array.isArray(issue.details?.items) ? (issue.details.items as Record<string, unknown>[]) : [];
  return items.map((i) =>
    [i.product, i.account, i.warehouse, i.doc_no, i.slip_number, i.document_number, i.date ? isoToDots(String(i.date)) : null, i.shortfall != null ? `−${i.shortfall}` : null, i.amount != null ? String(i.amount) : null]
      .filter((x) => x !== null && x !== undefined && x !== "")
      .join(" · ")
  );
}

/** yyyy-mm-dd → dd.mm.yyyy. */
export function isoToDots(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/**
 * FORM-routing (DATE-1 item 4): an admin's amendment of a posted invoice that changes only the
 * date goes to the date change instead of the full amend. `before` and `after` are the form's
 * values that the amend would save; the date key is compared apart.
 */
export function onlyDateChanged<T extends Record<string, unknown>>(before: T, after: T, dateKey: keyof T): boolean {
  if (before[dateKey] === after[dateKey]) return false;
  const strip = (o: T) => JSON.stringify({ ...o, [dateKey]: null });
  return strip(before) === strip(after);
}
