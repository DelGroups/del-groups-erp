/**
 * Renewal invoices (prompt 13). Pure: no I/O, no Date.now(); dates are ISO YYYY-MM-DD and
 * money is integer minor units until it is handed to the database (numeric(12,2)).
 *
 * Timeline of one renewal, with billing_settings.payment_terms_days = 7:
 *   renewal date − 7 days  the invoice for the next period is issued (and emailed), due on
 *                          the renewal date;
 *   renewal date           the subscription moves to the next period (service continues);
 *   after the due date     dunning (dunning.ts) takes over until it is paid.
 * public.issue_invoice() numbers the invoice, adds tax and snapshots seller and buyer; the
 * same totals and numbering are computed here for previews and tests.
 */
import { addPeriod, quote, toCents, type BillingPeriod, type ModuleInfo, type PlanPricing, type Quote, type SubscriptionChoice } from "./pricing.ts";

export interface BillingSettings {
  invoicePrefix: string;
  taxRatePct: number;
  paymentTermsDays: number;
  graceDays: number;
  suspendAfterDays: number;
}

/** Same defaults as public.billing_settings. */
export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  invoicePrefix: "INV",
  taxRatePct: 0,
  paymentTermsDays: 7,
  graceDays: 7,
  suspendAfterDays: 30,
};

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** INV-2026-00001: numbering restarts every calendar year (public.next_invoice_number). */
export function formatInvoiceNumber(prefix: string, year: number, n: number): string {
  return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}

export type InvoiceLineKind = "base" | "module" | "addon" | "discount" | "proration" | "credit" | "other";

/** One invoice line as public.issue_invoice() takes it (major units). */
export interface InvoiceLine {
  kind: InvoiceLineKind;
  item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface InvoiceTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/** subtotal = Σ lines, tax = subtotal × rate rounded to the cent, total = subtotal + tax. */
export function invoiceTotals(lines: readonly Pick<InvoiceLine, "amount">[], taxRatePct: number): InvoiceTotals {
  const subtotalCents = lines.reduce((sum, l) => sum + toCents(l.amount), 0);
  const taxCents = Math.round((subtotalCents * Math.min(100, Math.max(0, Number(taxRatePct) || 0))) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export interface LineLabels {
  base: string;
  module(id: string): string;
  addon(code: string): string;
  /** "Yearly discount 17 %" */
  discount(pct: number): string;
}

const major = (cents: number) => Math.round(cents) / 100;

/**
 * Lines for one billing period of a quote: monthly prices as they are; for a yearly period
 * each line × 12 and the yearly discount as a negative line. The lines add up to
 * quote.periodCents.
 */
export function quoteLines(q: Quote, labels: LineLabels, discountPct: number): InvoiceLine[] {
  const months = q.period === "yearly" ? 12 : 1;
  const lines: InvoiceLine[] = q.lines.map((l) => ({
    kind: l.kind,
    item_id: l.kind === "base" ? null : l.id,
    description: l.kind === "base" ? labels.base : l.kind === "module" ? labels.module(l.id) : labels.addon(l.id),
    quantity: l.quantity,
    unit_price: major(l.unitCents * months),
    amount: major(l.totalCents * months),
  }));
  if (q.discountCents > 0) {
    lines.push({
      kind: "discount",
      item_id: null,
      description: labels.discount(discountPct),
      quantity: 1,
      unit_price: major(-q.discountCents),
      amount: major(-q.discountCents),
    });
  }
  return lines;
}

export interface SubscriptionPeriod {
  billing_period: BillingPeriod;
  current_period_start: string | null;
  current_period_end: string | null;
}

export interface RenewalStep {
  /** The next period, which the renewal invoice is for. */
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  /** The invoice for the next period should exist by today. */
  issue: boolean;
  /** The renewal date has come: move the subscription to the next period. */
  advance: boolean;
}

/** What is due for a subscription today; null when it has no period dates (not billed). */
export function renewalStep(sub: SubscriptionPeriod, today: string, settings: Pick<BillingSettings, "paymentTermsDays">): RenewalStep | null {
  if (!sub.current_period_end) return null;
  const periodStart = sub.current_period_end;
  const periodEnd = addPeriod(periodStart, sub.billing_period);
  const issueDate = addDays(periodStart, -Math.max(0, settings.paymentTermsDays));
  return {
    periodStart,
    periodEnd,
    issueDate,
    dueDate: periodStart,
    issue: today >= issueDate,
    advance: today >= periodStart,
  };
}

/** The renewal invoice of a subscription: its lines and dates. */
export function renewalInvoice(
  plan: PlanPricing,
  choice: SubscriptionChoice,
  catalog: readonly ModuleInfo[],
  step: RenewalStep,
  labels: LineLabels
): { lines: InvoiceLine[]; quote: Quote } {
  const q = quote(plan, choice, catalog);
  return { lines: quoteLines(q, labels, plan.annualDiscountPct), quote: q };
}
