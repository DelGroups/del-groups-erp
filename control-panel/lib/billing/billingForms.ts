/**
 * Forms of the billing screens (prompt 13): invoice/dunning settings, a tenant's billing
 * fields, recording a payment. Pure: raw form strings in, a validated value or i18n error keys
 * (billingAdmin.errors.*) out.
 */

type Raw = Record<string, string | undefined>;
type Parsed<T, F extends string> = { ok: true; value: T } | { ok: false; errors: Partial<Record<F, string>> };

const text = (raw: Raw, key: string) => (raw[key] ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function wholeNumber(v: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const SETTINGS_TEXT_FIELDS = [
  "seller_name",
  "seller_tax_id",
  "seller_address",
  "seller_email",
  "seller_phone",
  "bank_name",
  "bank_code",
  "bank_tax_id",
  "bank_swift",
  "bank_correspondent_account",
  "bank_account",
] as const;
export type SettingsField =
  | (typeof SETTINGS_TEXT_FIELDS)[number]
  | "invoice_prefix"
  | "tax_label"
  | "tax_rate_pct"
  | "payment_terms_days"
  | "grace_days"
  | "suspend_after_days";

export interface BillingSettingsInput {
  seller_name: string;
  seller_tax_id: string | null;
  seller_address: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  bank_name: string | null;
  bank_code: string | null;
  bank_tax_id: string | null;
  bank_swift: string | null;
  bank_correspondent_account: string | null;
  bank_account: string | null;
  invoice_prefix: string;
  tax_label: string;
  tax_rate_pct: number;
  payment_terms_days: number;
  grace_days: number;
  suspend_after_days: number;
}

export function parseBillingSettingsForm(raw: Raw): Parsed<BillingSettingsInput, SettingsField> {
  const errors: Partial<Record<SettingsField, string>> = {};
  const value = {} as BillingSettingsInput;
  for (const f of SETTINGS_TEXT_FIELDS) {
    const v = text(raw, f);
    if (v.length > (f === "seller_address" ? 500 : 200)) errors[f] = "tooLong";
    (value as unknown as Record<string, string | null>)[f] = f === "seller_name" ? v : v || null;
  }
  if (value.seller_email && !EMAIL.test(value.seller_email)) errors.seller_email = "emailInvalid";

  const prefix = text(raw, "invoice_prefix").toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(prefix)) errors.invoice_prefix = "prefixInvalid";
  value.invoice_prefix = prefix;

  value.tax_label = text(raw, "tax_label");
  if (!value.tax_label || value.tax_label.length > 20) errors.tax_label = "tooLong";

  const rate = Number(text(raw, "tax_rate_pct").replace(",", ".") || "0");
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || !/^\d+([.,]\d{1,2})?$/.test(text(raw, "tax_rate_pct") || "0")) {
    errors.tax_rate_pct = "percentInvalid";
  }
  value.tax_rate_pct = rate;

  const ranges: [Exclude<keyof BillingSettingsInput, "tax_rate_pct">, number, number][] = [
    ["payment_terms_days", 0, 60],
    ["grace_days", 0, 90],
    ["suspend_after_days", 1, 365],
  ];
  for (const [f, min, max] of ranges) {
    const n = wholeNumber(text(raw, f), min, max);
    if (n === null) errors[f as SettingsField] = "numberInvalid";
    (value as unknown as Record<string, number>)[f] = n ?? 0;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// ── A tenant's billing fields ────────────────────────────────────────────────

export type TenantBillingField = "billing_email" | "billing_tax_id" | "billing_address" | "billing_paused_until" | "payment_provider";

export interface TenantBillingInput {
  billing_email: string | null;
  billing_tax_id: string | null;
  billing_address: string | null;
  billing_paused_until: string | null;
  /** Only when the tenant has a live subscription. */
  auto_billing: boolean;
  payment_provider: string;
}

export function parseTenantBillingForm(raw: Raw, providerIds: readonly string[]): Parsed<TenantBillingInput, TenantBillingField> {
  const errors: Partial<Record<TenantBillingField, string>> = {};
  const email = text(raw, "billing_email").toLowerCase();
  if (email && (!EMAIL.test(email) || email.length > 200)) errors.billing_email = "emailInvalid";
  const taxId = text(raw, "billing_tax_id");
  if (taxId.length > 40) errors.billing_tax_id = "tooLong";
  const address = text(raw, "billing_address");
  if (address.length > 500) errors.billing_address = "tooLong";
  const paused = text(raw, "billing_paused_until");
  if (paused && !validDate(paused)) errors.billing_paused_until = "dateInvalid";
  const provider = text(raw, "payment_provider") || "manual_bank_transfer";
  if (!providerIds.includes(provider)) errors.payment_provider = "providerInvalid";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      billing_email: email || null,
      billing_tax_id: taxId || null,
      billing_address: address || null,
      billing_paused_until: paused || null,
      auto_billing: raw.auto_billing === "on" || raw.auto_billing === "true",
      payment_provider: provider,
    },
  };
}

// ── Recording a payment ──────────────────────────────────────────────────────

export const PAYMENT_METHODS = ["bank_transfer", "card", "cash", "other"] as const;
export type PaymentField = "amount" | "paid_on" | "method" | "reference";

export interface PaymentFormInput {
  amount: number;
  paid_on: string;
  method: (typeof PAYMENT_METHODS)[number];
  reference: string | null;
}

/** `owed` caps the amount: a payment never exceeds what is still open on the invoice. */
export function parsePaymentForm(raw: Raw, owed: number, today: string): Parsed<PaymentFormInput, PaymentField> {
  const errors: Partial<Record<PaymentField, string>> = {};
  const amountText = text(raw, "amount").replace(/\s/g, "").replace(",", ".");
  const amount = Number(amountText);
  if (!/^\d+(\.\d{1,2})?$/.test(amountText) || !(amount > 0) || Math.round(amount * 100) > Math.round(owed * 100)) {
    errors.amount = "amountInvalid";
  }
  const paidOn = text(raw, "paid_on") || today;
  if (!validDate(paidOn) || paidOn > today) errors.paid_on = "dateInvalid";
  const method = text(raw, "method") as PaymentFormInput["method"];
  if (!PAYMENT_METHODS.includes(method)) errors.method = "methodInvalid";
  const reference = text(raw, "reference");
  if (reference.length > 200) errors.reference = "tooLong";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { amount, paid_on: paidOn, method, reference: reference || null } };
}
