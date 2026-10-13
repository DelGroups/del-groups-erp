/**
 * The billing run (prompt 13): what the daily job (scripts/tenants/billing-run.ts), the
 * panel's "Run billing now" and every recorded payment do. For each tenant in the worklist:
 *
 *   1. renewal   issue the next period's invoice when it is due (invoicing.ts), render its PDF,
 *                email it; move the subscription to the next period on the renewal date;
 *   2. PDFs      render a PDF for any open invoice without one (invoices made in the panel);
 *   3. cards     charge a saved card for due invoices when the provider supports it;
 *   4. dunning   move the tenant along due → past_due → read_only → suspended, or back to
 *                active once nothing is overdue (dunning.ts), email each step once and tell
 *                the ERP right away.
 *
 * Everything that changes data goes through BillingStore (Supabase client or local psql), so
 * this file has no I/O of its own and the whole walk is testable with an in-memory store.
 * Every step is safe to repeat: renewal invoices are unique per period, emails once per
 * invoice and step, payments once per gateway reference.
 */
import { ADDON_CODES, type AddonCode, type BillingPeriod, type ModuleInfo, type PlanPricing, type SubscriptionChoice } from "./pricing.ts";
import { quote } from "./pricing.ts";
import { toPlanPricing } from "./catalog.ts";
import { addDays, quoteLines, renewalStep, type BillingSettings, type InvoiceLine } from "./invoicing.ts";
import { decideDunning, type DunningStatus } from "./dunning.ts";
import { billingEmail, type EmailKind, type EmailSender } from "./email.ts";
import { PaymentProviderError } from "./providers/types.ts";
import type { ProviderRegistry } from "./providers/index.ts";
import type { BankDetails } from "./providers/manualBankTransfer.ts";
import type { InvoiceDocument } from "./pdf.ts";
import { MESSAGES, isLocale, translate, type Locale } from "../i18n/messages.ts";

// ── Shapes of the control-plane data (public.billing_work_item / billing_settings) ──

export interface SettingsRow extends BankDetails {
  invoice_prefix: string;
  tax_rate_pct: number | string;
  payment_terms_days: number;
  grace_days: number;
  suspend_after_days: number;
  seller_email?: string | null;
}

export function settingsFromRow(row: SettingsRow): BillingSettings {
  return {
    invoicePrefix: row.invoice_prefix,
    taxRatePct: Number(row.tax_rate_pct) || 0,
    paymentTermsDays: Number(row.payment_terms_days),
    graceDays: Number(row.grace_days),
    suspendAfterDays: Number(row.suspend_after_days),
  };
}

export interface OpenInvoice {
  id: string;
  number: string;
  kind: string;
  status: string;
  total: number | string;
  amount_paid: number | string;
  currency: string;
  due_date: string | null;
  pdf_path: string | null;
  charge_attempts: number;
  last_charge_attempt_at: string | null;
}

export interface WorkSubscription {
  id: string;
  status: string;
  billing_period: BillingPeriod;
  currency: string;
  user_count: number;
  current_period_start: string | null;
  current_period_end: string | null;
  auto_billing: boolean;
  payment_provider: string;
  modules: string[];
  addons: Record<string, number>;
  plan: {
    id: string;
    code: string;
    name: string;
    annual_discount_pct: number | string;
    max_users: number | null;
    included_storage_gb: number | string | null;
    included_ai_credit_usd: number | string | null;
    includes_custom_domain: boolean;
    prices: { module_id: string | null; amount: number | string; per_user: boolean }[];
    addon_prices: { addon_code: string; amount: number | string }[];
  };
}

export interface WorkItem {
  tenant_id: string;
  slug: string;
  name: string;
  status: string;
  status_source: "admin" | "billing";
  language: string;
  billing_email: string | null;
  billing_paused_until: string | null;
  billing_exempt: boolean;
  subscription: WorkSubscription | null;
  open_invoices: OpenInvoice[];
  last_paid_invoice_id: string | null;
}

export function workPlanPricing(sub: WorkSubscription): PlanPricing {
  const p = sub.plan;
  return toPlanPricing({
    id: p.id,
    code: p.code,
    name: p.name,
    description: null,
    annual_discount_pct: p.annual_discount_pct,
    is_active: true,
    sort_order: 0,
    max_users: p.max_users,
    included_storage_gb: p.included_storage_gb,
    included_ai_credit_usd: p.included_ai_credit_usd,
    includes_custom_domain: p.includes_custom_domain,
    plan_prices: p.prices.map((x) => ({ ...x, billing_period: "monthly" as const, currency: sub.currency })),
    plan_addon_prices: p.addon_prices.map((x) => ({ ...x, currency: sub.currency })),
  });
}

export function workChoice(sub: WorkSubscription): SubscriptionChoice {
  const addons: SubscriptionChoice["addons"] = {};
  for (const [code, q] of Object.entries(sub.addons ?? {})) {
    if ((ADDON_CODES as readonly string[]).includes(code) && Number(q) > 0) addons[code as AddonCode] = Number(q);
  }
  return { period: sub.billing_period, userCount: sub.user_count, modules: [...sub.modules].sort(), addons };
}

// ── Store and dependencies ───────────────────────────────────────────────────

export interface IssueInvoiceInput {
  tenant_id: string;
  subscription_id: string | null;
  kind: "renewal" | "change" | "manual";
  billing_period: BillingPeriod | null;
  period_start: string | null;
  period_end: string | null;
  issue_date: string;
  due_date: string;
  currency: string;
  lines: InvoiceLine[];
}

export interface PaymentInput {
  invoice_id: string;
  amount: number;
  method: "bank_transfer" | "card" | "cash" | "other";
  provider: string | null;
  provider_reference: string | null;
  paid_at: string | null;
  status?: "succeeded" | "failed";
  failure_reason?: string | null;
}

export interface PaymentRecorded {
  payment_id: string;
  duplicate: boolean;
  invoice_status: string;
  tenant_id: string;
}

export interface BillingStore {
  settings(): Promise<SettingsRow>;
  worklist(): Promise<WorkItem[]>;
  workItem(tenantId: string): Promise<WorkItem | null>;
  catalog(): Promise<ModuleInfo[]>;
  markOverdue(today: string): Promise<number>;
  issueInvoice(input: IssueInvoiceInput): Promise<{ id: string; number: string; created: boolean }>;
  advancePeriod(subscriptionId: string, fromEnd: string, newEnd: string): Promise<boolean>;
  invoiceDocument(invoiceId: string): Promise<InvoiceDocument>;
  /** Stores the PDF (Storage bucket "invoices") and sets invoices.pdf_path; returns the path. */
  savePdf(invoice: { id: string; tenantId: string; number: string }, pdf: Uint8Array): Promise<string>;
  setStatus(tenantId: string, status: DunningStatus): Promise<boolean>;
  recordPayment(input: PaymentInput): Promise<PaymentRecorded>;
  noteChargeAttempt(invoiceId: string): Promise<void>;
  defaultCard(tenantId: string, provider: string): Promise<{ id: string; token: string } | null>;
  /** Inserts the email row; null when this invoice already had this email (or it is being sent). */
  claimEmail(row: { tenant_id: string; invoice_id: string | null; kind: EmailKind; recipient: string | null; subject: string }): Promise<string | null>;
  finishEmail(id: string, result: { status: "sent" | "skipped" | "failed"; error: string | null; provider_message_id: string | null }): Promise<void>;
}

export interface BillingDeps {
  store: BillingStore;
  providers: ProviderRegistry;
  email: EmailSender;
  renderPdf(doc: InvoiceDocument): Promise<Uint8Array>;
  /** Tells the ERP to drop its cached tenant status (lib/erpWebhook.ts). */
  notifyTenantChanged?(tenantId: string): Promise<void>;
  onEvent?(line: string): void;
  /** Values to keep out of error messages. */
  secrets?: string[];
}

export interface TenantBillingResult {
  tenantId: string;
  slug: string;
  ok: boolean;
  issued: string[];
  advanced: number;
  charged: string[];
  statusFrom: string;
  statusTo: DunningStatus | null;
  emails: { kind: EmailKind; status: "sent" | "skipped" | "failed" }[];
  notes: string[];
  error: string | null;
}

export interface BillingSummary {
  ok: boolean;
  date: string;
  overdueMarked: number;
  results: TenantBillingResult[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PDF_EMAILS = new Set<EmailKind>(["invoice_issued", "payment_failed", "past_due", "read_only", "suspended"]);
const MAX_RENEWALS_PER_RUN = 24;
const MAX_CHARGE_ATTEMPTS = 3;

function redact(message: string, secrets: readonly string[] = []): string {
  let out = message;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  return out;
}

const localeOf = (language: string): Locale => (isLocale(language) ? language : "az");

export function lineLabels(language: string) {
  const m = MESSAGES[localeOf(language)];
  const tr = (key: string, vars?: Record<string, string | number>) => translate(m, `invoiceDoc.${key}`, vars);
  return {
    base: tr("base"),
    module: (id: string) => {
      const name = tr(`modules.${id}`);
      return name === `invoiceDoc.modules.${id}` ? id : name;
    },
    addon: (code: string) => tr(`addons.${code}`),
    discount: (pct: number) => tr("discount", { pct: Number(pct) }),
  };
}

const owed = (i: Pick<OpenInvoice, "total" | "amount_paid">) => Math.max(0, Math.round((Number(i.total) - Number(i.amount_paid)) * 100) / 100);

interface RunContext {
  deps: BillingDeps;
  settings: BillingSettings;
  settingsRow: SettingsRow;
  catalog: ModuleInfo[];
  today: string;
}

async function sendEmail(
  ctx: RunContext,
  item: WorkItem,
  result: TenantBillingResult,
  kind: EmailKind,
  invoiceId: string | null,
  extra: { daysOverdue?: number } = {}
): Promise<void> {
  const { store, email } = ctx.deps;
  const doc = invoiceId ? await store.invoiceDocument(invoiceId) : null;
  const dueDate = doc?.due_date ?? null;
  const content = billingEmail(kind, {
    language: localeOf(item.language),
    company: item.name,
    seller: ctx.settingsRow.seller_name || "",
    number: doc?.number ?? "",
    amount: doc ? (kind === "payment_received" ? Number(doc.amount_paid) : owed(doc)) : 0,
    currency: doc?.currency ?? "",
    dueDate,
    readOnlyOn: dueDate ? addDays(dueDate, ctx.settings.graceDays + 1) : null,
    suspendOn: dueDate ? addDays(dueDate, ctx.settings.graceDays + ctx.settings.suspendAfterDays + 1) : null,
    daysOverdue: extra.daysOverdue,
    bank: ctx.settingsRow,
  });
  const recipient = item.billing_email?.trim() || null;
  const id = await store.claimEmail({ tenant_id: item.tenant_id, invoice_id: invoiceId, kind, recipient, subject: content.subject });
  if (!id) return;

  let status: "sent" | "skipped" | "failed";
  let error: string | null = null;
  let messageId: string | null = null;
  if (!recipient) {
    status = "skipped";
    error = "no billing email for this tenant";
  } else if (email.missing.length) {
    status = "skipped";
    error = `email not configured (${email.missing.join(", ")})`;
  } else {
    try {
      const attachments = doc && PDF_EMAILS.has(kind) ? [{ filename: `${doc.number}.pdf`, content: await ctx.deps.renderPdf(doc) }] : [];
      messageId = (await email.send({ to: recipient, ...content, attachments })).id;
      status = "sent";
    } catch (e) {
      status = "failed";
      error = redact(e instanceof Error ? e.message : String(e), ctx.deps.secrets).slice(0, 500);
    }
  }
  await store.finishEmail(id, { status, error, provider_message_id: messageId });
  result.emails.push({ kind, status });
}

async function ensurePdf(ctx: RunContext, item: WorkItem, invoiceId: string): Promise<void> {
  const doc = await ctx.deps.store.invoiceDocument(invoiceId);
  await ctx.deps.store.savePdf({ id: doc.id, tenantId: item.tenant_id, number: doc.number }, await ctx.deps.renderPdf(doc));
}

// ── Steps ────────────────────────────────────────────────────────────────────

async function renew(ctx: RunContext, item: WorkItem, result: TenantBillingResult): Promise<void> {
  const sub = item.subscription;
  if (!sub || !sub.auto_billing || ["suspended", "cancelled", "provisioning"].includes(item.status)) return;
  const plan = workPlanPricing(sub);
  const choice = workChoice(sub);
  let period = { start: sub.current_period_start, end: sub.current_period_end };

  for (let i = 0; i < MAX_RENEWALS_PER_RUN; i++) {
    const step = renewalStep({ billing_period: sub.billing_period, current_period_start: period.start, current_period_end: period.end }, ctx.today, ctx.settings);
    if (!step) {
      result.notes.push("no billing period dates on the subscription");
      return;
    }
    if (step.issue) {
      const q = quote(plan, choice, ctx.catalog);
      if (q.periodCents > 0) {
        const issued = await ctx.deps.store.issueInvoice({
          tenant_id: item.tenant_id,
          subscription_id: sub.id,
          kind: "renewal",
          billing_period: sub.billing_period,
          period_start: step.periodStart,
          period_end: step.periodEnd,
          // Dated the day it is really issued; after missed runs it is never due before that.
          issue_date: ctx.today,
          due_date: step.dueDate < ctx.today ? ctx.today : step.dueDate,
          currency: sub.currency,
          lines: quoteLines(q, lineLabels(item.language), plan.annualDiscountPct),
        });
        if (issued.created) {
          result.issued.push(issued.number);
          ctx.deps.onEvent?.(`[${item.slug}] issued ${issued.number} for ${step.periodStart} – ${step.periodEnd}`);
          await ensurePdf(ctx, item, issued.id);
          await sendEmail(ctx, item, result, "invoice_issued", issued.id);
        }
      } else {
        result.notes.push(`free period ${step.periodStart}: no invoice`);
      }
    }
    if (!step.advance) return;
    if (await ctx.deps.store.advancePeriod(sub.id, step.periodStart, step.periodEnd)) result.advanced++;
    period = { start: step.periodStart, end: step.periodEnd };
  }
}

async function chargeCards(ctx: RunContext, item: WorkItem, open: OpenInvoice[], result: TenantBillingResult): Promise<Set<string>> {
  const paid = new Set<string>();
  const sub = item.subscription;
  if (!sub?.auto_billing) return paid;
  const provider = ctx.deps.providers.get(sub.payment_provider);
  if (!provider?.supportsSavedCards) return paid;

  for (const inv of open) {
    const lastDay = inv.last_charge_attempt_at?.slice(0, 10) ?? null;
    if (!inv.due_date || inv.due_date > ctx.today || inv.charge_attempts >= MAX_CHARGE_ATTEMPTS || lastDay === ctx.today) continue;
    const card = await ctx.deps.store.defaultCard(item.tenant_id, provider.id);
    if (!card) return paid;
    const amountCents = Math.round(owed(inv) * 100);
    try {
      const charge = await provider.chargeSavedCard(
        { id: inv.id, number: inv.number, tenantId: item.tenant_id, amountCents, currency: inv.currency, description: inv.number },
        card
      );
      await ctx.deps.store.noteChargeAttempt(inv.id);
      if (charge.status === "succeeded") {
        const r = await ctx.deps.store.recordPayment({
          invoice_id: inv.id,
          amount: amountCents / 100,
          method: "card",
          provider: provider.id,
          provider_reference: charge.reference,
          paid_at: null,
        });
        if (r.invoice_status === "paid") paid.add(inv.id);
        result.charged.push(inv.number);
        await sendEmail(ctx, item, result, "payment_received", inv.id);
      } else {
        await sendEmail(ctx, item, result, "payment_failed", inv.id);
      }
    } catch (e) {
      if (e instanceof PaymentProviderError && (e.code === "not_implemented" || e.code === "not_configured")) {
        result.notes.push(`card charge skipped: ${e.message}`);
        return paid;
      }
      throw e;
    }
  }
  return paid;
}

async function dunning(ctx: RunContext, item: WorkItem, open: OpenInvoice[], result: TenantBillingResult): Promise<void> {
  if (item.billing_exempt) return;
  // Dunning applies to tenants billed here: auto_billing on, or a status billing imposed.
  const billed = Boolean(item.subscription?.auto_billing) || item.status_source === "billing";
  if (!billed) return;
  const decision = decideDunning({
    tenantStatus: item.status,
    statusSource: item.status_source,
    pausedUntil: item.billing_paused_until,
    unpaid: open.map((i) => ({ id: i.id, dueDate: i.due_date })),
    lastPaidInvoiceId: item.last_paid_invoice_id,
    today: ctx.today,
    settings: ctx.settings,
  });
  if (!decision.status) return;
  const changed = await ctx.deps.store.setStatus(item.tenant_id, decision.status);
  if (!changed) return;
  result.statusTo = decision.status;
  ctx.deps.onEvent?.(`[${item.slug}] status ${item.status} → ${decision.status} (${decision.daysOverdue} days overdue)`);
  await ctx.deps.notifyTenantChanged?.(item.tenant_id);
  if (decision.email) await sendEmail(ctx, item, result, decision.email, decision.invoiceId, { daysOverdue: decision.daysOverdue });
}

async function billTenant(ctx: RunContext, initial: WorkItem): Promise<TenantBillingResult> {
  const result: TenantBillingResult = {
    tenantId: initial.tenant_id,
    slug: initial.slug,
    ok: true,
    issued: [],
    advanced: 0,
    charged: [],
    statusFrom: initial.status,
    statusTo: null,
    emails: [],
    notes: [],
    error: null,
  };
  if (initial.billing_exempt) {
    result.notes.push("exempt from billing");
    return result;
  }
  try {
    await renew(ctx, initial, result);
    // Re-read: renewal may have added an invoice.
    const item = (await ctx.deps.store.workItem(initial.tenant_id)) ?? initial;
    for (const inv of item.open_invoices) if (!inv.pdf_path) await ensurePdf(ctx, item, inv.id);
    // Invoices made in the panel are announced here; a failed announcement is tried again.
    for (const inv of item.open_invoices) await sendEmail(ctx, item, result, "invoice_issued", inv.id);
    const paid = await chargeCards(ctx, item, item.open_invoices, result);
    const stillOpen = item.open_invoices.filter((i) => !paid.has(i.id));
    const afterCharges = paid.size ? ((await ctx.deps.store.workItem(item.tenant_id)) ?? item) : item;
    await dunning(ctx, afterCharges, stillOpen, result);
  } catch (e) {
    result.ok = false;
    result.error = redact(e instanceof Error ? e.message : String(e), ctx.deps.secrets).slice(0, 1000);
    ctx.deps.onEvent?.(`[${initial.slug}] FAILED ${result.error}`);
  }
  return result;
}

async function context(deps: BillingDeps, today: string): Promise<RunContext> {
  const settingsRow = await deps.store.settings();
  return { deps, settings: settingsFromRow(settingsRow), settingsRow, catalog: await deps.store.catalog(), today };
}

/** The daily run over every tenant in the worklist, or one tenant (panel button). */
export async function runBilling(deps: BillingDeps, today: string, options: { tenantId?: string } = {}): Promise<BillingSummary> {
  const ctx = await context(deps, today);
  const overdueMarked = await deps.store.markOverdue(today);
  let items: WorkItem[];
  if (options.tenantId) {
    const one = await deps.store.workItem(options.tenantId);
    items = one ? [one] : [];
  } else {
    items = await deps.store.worklist();
  }
  const results: TenantBillingResult[] = [];
  for (const item of items) results.push(await billTenant(ctx, item));
  return { ok: results.every((r) => r.ok), date: today, overdueMarked, results };
}

/**
 * After a payment was recorded (an admin in the panel, or the gateway's webhook): thank the
 * tenant and lift billing restrictions at once instead of at the next daily run.
 */
export async function afterPayment(deps: BillingDeps, invoiceId: string, tenantId: string, today: string): Promise<TenantBillingResult | null> {
  const ctx = await context(deps, today);
  const item = await deps.store.workItem(tenantId);
  if (!item) return null;
  const result: TenantBillingResult = {
    tenantId,
    slug: item.slug,
    ok: true,
    issued: [],
    advanced: 0,
    charged: [],
    statusFrom: item.status,
    statusTo: null,
    emails: [],
    notes: [],
    error: null,
  };
  try {
    const doc = await deps.store.invoiceDocument(invoiceId);
    if (doc.status === "paid") {
      await ensurePdf(ctx, item, invoiceId); // the stored PDF now carries the PAID stamp
      await sendEmail(ctx, item, result, "payment_received", invoiceId);
    }
    if (!item.billing_exempt) await dunning(ctx, item, item.open_invoices, result);
  } catch (e) {
    result.ok = false;
    result.error = redact(e instanceof Error ? e.message : String(e), deps.secrets).slice(0, 1000);
  }
  return result;
}
