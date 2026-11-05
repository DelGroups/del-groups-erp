/**
 * One payment from several accounts (IMP-5, Del 2026-11-04): the lines of the unified payment
 * dialog, their defaults, totals and checks, and the entry preview. Pure: the dialog, every
 * caller and the tests use the same functions. The database posts the lines as ONE payment
 * event and ONE journal entry (process_invoice_payment_event, create_partner_payment,
 * pay_import_payable, prepay_import_supplier, pay_import_cost_advance).
 */

export const PAYMENT_METHODS = ["cash", "transfer", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentDirection = "in" | "out";

/** A cash / bank account the dialog can pay from (or into). */
export interface PaymentAccountOption {
  id: string;
  name: string;
  /** accounts.type: "cash", "bank", "card" … (free text in older data). */
  type?: string | null;
  balance?: number | null;
  isVatAccount?: boolean | null;
}

export interface PaymentLine {
  key: string;
  accountId: string | null;
  method: PaymentMethod;
  /** AZN. */
  amount: number;
  note: string | null;
}

/** What one line sends to the database. */
export interface PaymentLinePayload {
  account_id: string;
  amount: number;
  method: string;
  note: string | null;
}

const EPS = 0.005;
const cents = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100 + (n >= 0 ? 1e-7 : -1e-7)) / 100;

let seq = 0;
export function newPaymentLineKey(): string {
  seq += 1;
  return `pay-${Date.now().toString(36)}-${seq}`;
}

/** The method an account suggests: a cash desk → cash, a card → card, a bank account → transfer. */
export function methodForAccount(account: Pick<PaymentAccountOption, "type" | "name"> | null | undefined): PaymentMethod {
  const t = `${account?.type ?? ""} ${account?.name ?? ""}`.toLowerCase();
  if (/card|kart|карт/.test(t)) return "card";
  if (/cash|kassa|nağd|nagd|касс|налич/.test(t)) return "cash";
  if (/bank|банк/.test(t)) return "transfer";
  return account?.type ? "transfer" : "cash";
}

export interface InitialLinesInput {
  /** What is prefilled on the first line (the open balance, AZN). */
  amount: number;
  accounts: readonly PaymentAccountOption[];
  /** The account this user paid from last time, if it still exists. */
  lastAccountId?: string | null;
  /** Lines to start from instead (a preset such as the base / VAT split). */
  preset?: readonly Omit<PaymentLine, "key">[] | null;
}

/** The first line: the open balance from the last-used account (else the first non-VAT one). */
export function initialPaymentLines({ amount, accounts, lastAccountId, preset }: InitialLinesInput): PaymentLine[] {
  if (preset?.length) return preset.map((p) => ({ ...p, key: newPaymentLineKey(), amount: cents(p.amount) }));
  const account =
    (lastAccountId ? accounts.find((a) => a.id === lastAccountId) : undefined) ?? accounts.find((a) => !a.isVatAccount) ?? accounts[0] ?? null;
  return [{ key: newPaymentLineKey(), accountId: account?.id ?? null, method: methodForAccount(account), amount: cents(Math.max(0, amount)), note: null }];
}

/** A new line for "+ Add an account": what is still left, the method of no account yet. */
export function addPaymentLine(lines: readonly PaymentLine[], left: number): PaymentLine[] {
  return [...lines, { key: newPaymentLineKey(), accountId: null, method: "cash", amount: cents(Math.max(0, left)), note: null }];
}

/** A line with another account: its method follows the account's type unless the user changed it. */
export function setLineAccount(line: PaymentLine, account: PaymentAccountOption | null, methodTouched = false): PaymentLine {
  return { ...line, accountId: account?.id ?? null, method: methodTouched ? line.method : methodForAccount(account) };
}

export interface PaymentContext {
  /** The document's currency; AZN for most documents. */
  currency: string;
  /** What is still open, in the document's currency. */
  openBalance: number;
  /** Paying more than the open balance (an advance) is allowed. */
  allowAdvance?: boolean;
  /** For another currency: the amount paid in it and AZN per unit on the payment date. */
  amountFc?: number | null;
  rate?: number | null;
  /** Lines the caller's database accepts (1 for a single-account RPC). */
  maxLines?: number;
}

export interface PaymentTotals {
  /** AZN leaving / entering the accounts (the lines' sum). */
  totalAzn: number;
  /** For another currency: amount × rate that the lines must add up to. */
  targetAzn: number | null;
  /** What stays open after this payment, in the document's currency (negative = an advance). */
  remaining: number;
  /** What the lines still have to cover (other currency), or 0. */
  unassignedAzn: number;
}

export function paymentTotals(lines: readonly PaymentLine[], ctx: PaymentContext): PaymentTotals {
  const totalAzn = cents(lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0));
  if (ctx.currency !== "AZN") {
    const fc = cents(ctx.amountFc ?? 0);
    const targetAzn = cents(fc * (ctx.rate ?? 0));
    return { totalAzn, targetAzn, remaining: cents(ctx.openBalance - fc), unassignedAzn: cents(targetAzn - totalAzn) };
  }
  return { totalAzn, targetAzn: null, remaining: cents(ctx.openBalance - totalAzn), unassignedAzn: 0 };
}

export type PaymentIssue =
  | "no_lines"
  | "too_many_lines"
  | "account_required"
  | "amount_positive"
  | "duplicate_account"
  | "overpay"
  | "rate_required"
  | "amount_fc_required"
  | "lines_mismatch";

export interface PaymentCheck {
  issues: PaymentIssue[];
  /** Line keys with a problem (outlined in the grid). */
  badLines: string[];
  totals: PaymentTotals;
}

/** Everything that stops the payment: every line an account and a positive amount, each account once, no overpayment. */
export function checkPayment(lines: readonly PaymentLine[], ctx: PaymentContext): PaymentCheck {
  const issues = new Set<PaymentIssue>();
  const bad = new Set<string>();
  const totals = paymentTotals(lines, ctx);
  if (!lines.length) issues.add("no_lines");
  if (ctx.maxLines !== undefined && lines.length > ctx.maxLines) issues.add("too_many_lines");
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.accountId) {
      issues.add("account_required");
      bad.add(l.key);
    } else if (seen.has(l.accountId)) {
      issues.add("duplicate_account");
      bad.add(l.key);
    } else seen.add(l.accountId);
    if (!(l.amount > 0)) {
      issues.add("amount_positive");
      bad.add(l.key);
    }
  }
  if (ctx.currency !== "AZN") {
    if (!(Number(ctx.rate) > 0)) issues.add("rate_required");
    if (!(Number(ctx.amountFc) > 0)) issues.add("amount_fc_required");
    else if (!ctx.allowAdvance && (ctx.amountFc ?? 0) > ctx.openBalance + EPS) issues.add("overpay");
    if (totals.targetAzn !== null && Math.abs(totals.unassignedAzn) > 0.011) issues.add("lines_mismatch");
  } else if (!ctx.allowAdvance && totals.totalAzn > ctx.openBalance + EPS) {
    issues.add("overpay");
  }
  return { issues: [...issues], badLines: [...bad], totals };
}

/** The lines as the database takes them; the method as its code (cash / transfer / card) or the caller's label. */
export function paymentLinesPayload(lines: readonly PaymentLine[], methodLabel?: (m: PaymentMethod) => string): PaymentLinePayload[] {
  return lines
    .filter((l) => l.accountId && l.amount > 0)
    .map((l) => ({ account_id: l.accountId as string, amount: cents(l.amount), method: methodLabel ? methodLabel(l.method) : l.method, note: l.note?.trim() || null }));
}

// ── Entry preview ─────────────────────────────────────────────────────────────

export interface EntryPreviewRow {
  side: "Dt" | "Kt";
  /** The account code (2100, 1200, 1100 …) when it is known. */
  code: string | null;
  label: string;
  amount: number;
}

/**
 * "Dt 2100 DGK 150.00 / Kt ABB 100.00, Kt Kassa 50.00": money out debits the counterparty and
 * credits each account; money in the reverse. An exchange difference (foreign-currency payable)
 * is shown on its own row.
 */
export function entryPreview(input: {
  direction: PaymentDirection;
  counterpartyCode: string | null;
  counterpartyLabel: string;
  lines: readonly PaymentLine[];
  accounts: readonly PaymentAccountOption[];
  /** The booking value the counterparty side moves by, when it differs from the cash (FX). */
  settledAzn?: number | null;
  fxLabels?: { loss: string; gain: string };
}): EntryPreviewRow[] {
  const cash = input.lines
    .filter((l) => l.accountId && l.amount > 0)
    .map((l) => ({ label: input.accounts.find((a) => a.id === l.accountId)?.name ?? "—", amount: cents(l.amount) }));
  const total = cents(cash.reduce((s, c) => s + c.amount, 0));
  const settled = input.settledAzn != null ? cents(input.settledAzn) : total;
  const diff = cents(total - settled);
  const counter: EntryPreviewRow = { side: input.direction === "out" ? "Dt" : "Kt", code: input.counterpartyCode, label: input.counterpartyLabel, amount: settled };
  const cashRows: EntryPreviewRow[] = cash.map((c) => ({ side: input.direction === "out" ? "Kt" : "Dt", code: null, label: c.label, amount: c.amount }));
  const rows = input.direction === "out" ? [counter, ...cashRows] : [...cashRows, counter];
  if (diff !== 0 && input.fxLabels) {
    // Paid more AZN than booked: a loss (Dt 6260); less: a gain (Kt 4960).
    rows.push(diff > 0 ? { side: "Dt", code: "6260", label: input.fxLabels.loss, amount: diff } : { side: "Kt", code: "4960", label: input.fxLabels.gain, amount: -diff });
  }
  return rows;
}

/** One line of text for a preview row: "Dt 2100 DGK 150.00". */
export function previewText(row: EntryPreviewRow, money: (n: number) => string): string {
  return [row.side, row.code, row.label, money(row.amount)].filter(Boolean).join(" ");
}

// ── Last-used account (per user, per browser) ────────────────────────────────

export function lastAccountStorageKey(userId: string | null | undefined, direction: PaymentDirection): string {
  return `payment:last-account:${userId || "anon"}:${direction}`;
}
