/**
 * The tenant admin's billing page (prompt 13): what the control plane returns about the
 * tenant's plan, invoices and pending plan change, parsed defensively, plus the usage meters
 * and the plan-change request check. Pure, shared by server code, API routes and the page.
 *
 * Off unless NEXT_PUBLIC_BILLING_PAGE_ENABLED is "true" and a control plane is configured
 * (multi-tenant mode), so a single-tenant deployment shows nothing new.
 *
 * Kept free of Next/React imports and `@/` aliases so `node --test` can load it.
 */
import { limitState, percentUsed, type LimitKind, type LimitState, type TenantLimitStatus } from "../limits/limits";

export type EnvLike = Readonly<Record<string, string | undefined>>;

export function billingPageEnabled(env: EnvLike): boolean {
  return (env.NEXT_PUBLIC_BILLING_PAGE_ENABLED ?? "").trim().toLowerCase() === "true";
}

export const INVOICE_STATUSES = ["issued", "paid", "overdue", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceSummary {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  total: number;
  amountPaid: number;
  issuedAt: string | null;
  dueDate: string | null;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  hasPdf: boolean;
}

export interface BillingOverview {
  tenantStatus: string;
  subscription: {
    planId: string;
    planName: string;
    status: string;
    billingPeriod: "monthly" | "yearly";
    currency: string;
    userCount: number;
    periodStart: string | null;
    periodEnd: string | null;
    trialEndsAt: string | null;
    modules: string[];
  } | null;
  invoices: InvoiceSummary[];
  pendingRequest: { planId: string; billingPeriod: "monthly" | "yearly"; userCount: number; note: string | null; createdAt: string } | null;
  plans: { id: string; name: string; maxUsers: number | null }[];
  /** Bank details for paying by transfer, only the filled-in ones, in display order. */
  bank: { key: string; value: string }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v: unknown) => str(v) || null;
const dateOrNull = (v: unknown) => (DATE.test(str(v)) ? str(v) : null);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const period = (v: unknown): "monthly" | "yearly" => (v === "yearly" ? "yearly" : "monthly");
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

const BANK_KEYS = ["seller_name", "seller_tax_id", "bank_name", "bank_code", "bank_tax_id", "bank_swift", "bank_correspondent_account", "bank_account"] as const;

/** Parses public.erp_billing_overview(); null when the tenant is unknown or the answer is unreadable. */
export function parseBillingOverview(raw: unknown): BillingOverview | null {
  const r = obj(Array.isArray(raw) ? raw[0] : raw);
  if (!r) return null;
  const tenant = obj(r.tenant);
  if (!tenant) return null;

  const s = obj(r.subscription);
  const subscription =
    s && UUID.test(str(s.plan_id))
      ? {
          planId: str(s.plan_id),
          planName: str(s.plan_name) || str(s.plan_code),
          status: str(s.status),
          billingPeriod: period(s.billing_period),
          currency: str(s.currency) || "AZN",
          userCount: Math.max(0, Math.round(num(s.user_count))),
          periodStart: dateOrNull(s.current_period_start),
          periodEnd: dateOrNull(s.current_period_end),
          trialEndsAt: dateOrNull(s.trial_ends_at),
          modules: Array.isArray(s.modules) ? s.modules.filter((m): m is string => typeof m === "string") : [],
        }
      : null;

  const invoices: InvoiceSummary[] = (Array.isArray(r.invoices) ? r.invoices : [])
    .map(obj)
    .filter((i): i is Record<string, unknown> => Boolean(i && UUID.test(str(i.id)) && (INVOICE_STATUSES as readonly string[]).includes(str(i.status))))
    .map((i) => ({
      id: str(i.id),
      number: str(i.number),
      status: str(i.status) as InvoiceStatus,
      currency: str(i.currency) || "AZN",
      total: num(i.total),
      amountPaid: num(i.amount_paid),
      issuedAt: dateOrNull(i.issued_at),
      dueDate: dateOrNull(i.due_date),
      paidAt: dateOrNull(i.paid_at),
      periodStart: dateOrNull(i.period_start),
      periodEnd: dateOrNull(i.period_end),
      hasPdf: i.has_pdf === true,
    }));

  const p = obj(r.pending_request);
  const pendingRequest =
    p && UUID.test(str(p.plan_id))
      ? {
          planId: str(p.plan_id),
          billingPeriod: period(p.billing_period),
          userCount: Math.round(num(p.user_count)),
          note: strOrNull(p.note),
          createdAt: str(p.created_at),
        }
      : null;

  const plans = (Array.isArray(r.plans) ? r.plans : [])
    .map(obj)
    .filter((x): x is Record<string, unknown> => Boolean(x && UUID.test(str(x.id))))
    .map((x) => ({ id: str(x.id), name: str(x.name) || str(x.code), maxUsers: x.max_users === null || x.max_users === undefined ? null : num(x.max_users) }));

  const b = obj(r.bank) ?? {};
  const bank = BANK_KEYS.filter((k) => str(b[k])).map((k) => ({ key: k, value: str(b[k]) }));

  return { tenantStatus: str(tenant.status), subscription, invoices, pendingRequest, plans, bank };
}

/** Still owed on an invoice. */
export function invoiceOwed(i: Pick<InvoiceSummary, "status" | "total" | "amountPaid">): number {
  if (i.status !== "issued" && i.status !== "overdue") return 0;
  return Math.max(0, Math.round((i.total - i.amountPaid) * 100) / 100);
}

/** Days from `today` to `date` (ISO), never negative. */
export function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
}

export interface Meter {
  kind: LimitKind;
  used: number;
  limit: number | null;
  percent: number;
  state: LimitState;
}

/** Seats, storage and AI as meters: amber from 80 %, red at 100 % (limits.ts rules). */
export function usageMeters(status: TenantLimitStatus): Meter[] {
  return (["users", "storage", "ai"] as const).map((kind) => ({
    kind,
    used: status[kind].used,
    limit: status[kind].limit,
    percent: percentUsed(status[kind]),
    state: limitState(status[kind]),
  }));
}

export interface PlanRequestInput {
  plan_id: string;
  billing_period: "monthly" | "yearly";
  user_count: number;
  note: string | null;
}

export type PlanRequestError = "planInvalid" | "periodInvalid" | "usersInvalid" | "noteTooLong";

/**
 * Checks an upgrade/downgrade request against the plans the control plane offers. More users
 * than a plan's cap is allowed: it is a request, and extra seats are sold as an add-on.
 */
export function validatePlanRequest(
  raw: unknown,
  plans: readonly { id: string; maxUsers: number | null }[]
): { ok: true; value: PlanRequestInput } | { ok: false; error: PlanRequestError } {
  const r = obj(raw) ?? {};
  const plan = plans.find((x) => x.id === str(r.plan_id));
  if (!plan) return { ok: false, error: "planInvalid" };
  if (r.billing_period !== "monthly" && r.billing_period !== "yearly") return { ok: false, error: "periodInvalid" };
  const users = Number(r.user_count);
  if (!Number.isInteger(users) || users < 1 || users > 10_000) return { ok: false, error: "usersInvalid" };
  const note = str(r.note);
  if (note.length > 2000) return { ok: false, error: "noteTooLong" };
  return { ok: true, value: { plan_id: plan.id, billing_period: r.billing_period, user_count: users, note: note || null } };
}
