"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePaymentForm, parseTenantBillingForm } from "@/lib/billing/billingForms";
import { billingDeps, billingSetup } from "@/lib/billing/billingServer";
import { afterPayment, runBilling } from "@/lib/billing/run";

export interface FormState {
  status: "idle" | "error" | "saved";
  /** i18n keys under billingAdmin.errors */
  errors: Partial<Record<string, string>>;
  formError: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const raw = (formData: FormData) => Object.fromEntries([...formData.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));

function revalidate(tenantId: string) {
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/billing`);
  revalidatePath("/billing");
}

/** Billing contact, dunning pause, and automatic billing / payment method of the live subscription. */
export async function saveTenantBilling(tenantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = parseTenantBillingForm(raw(formData), billingSetup().providers);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, formError: null };
  const v = parsed.value;
  const supabase = await createClient();
  const tenant = await supabase.from("tenants").select("billing_exempt").eq("id", tenantId).maybeSingle();
  if (tenant.error || !tenant.data) return { status: "error", errors: {}, formError: "saveFailed" };
  if ((tenant.data as { billing_exempt: boolean }).billing_exempt && v.auto_billing) {
    return { status: "error", errors: {}, formError: "exempt" };
  }

  const { error } = await supabase
    .from("tenants")
    .update({
      billing_email: v.billing_email,
      billing_tax_id: v.billing_tax_id,
      billing_address: v.billing_address,
      billing_paused_until: v.billing_paused_until,
    })
    .eq("id", tenantId);
  if (error) return { status: "error", errors: {}, formError: "saveFailed" };
  const sub = await supabase
    .from("subscriptions")
    .update({ auto_billing: v.auto_billing, payment_provider: v.payment_provider })
    .eq("tenant_id", tenantId)
    .in("status", ["trial", "active", "past_due"]);
  if (sub.error) return { status: "error", errors: {}, formError: "saveFailed" };
  revalidate(tenantId);
  return { status: "saved", errors: {}, formError: null };
}

export interface RunResult {
  ok: boolean;
  issued: string[];
  status: string | null;
  error: string | null;
}

/** What the daily job does, for this tenant only, today. */
export async function runTenantBilling(tenantId: string): Promise<RunResult> {
  await requireAdmin();
  const supabase = await createClient();
  try {
    const summary = await runBilling(billingDeps(supabase), today(), { tenantId });
    const r = summary.results[0];
    await supabase.rpc("log_platform_action", {
      p_action: "billing_run",
      p_entity_table: "tenants",
      p_entity_id: tenantId,
      p_details: { issued: r?.issued ?? [], status: r?.statusTo ?? null, ok: r?.ok ?? true },
    });
    revalidate(tenantId);
    return { ok: r?.ok ?? true, issued: r?.issued ?? [], status: r?.statusTo ?? null, error: r?.error ?? null };
  } catch (e) {
    return { ok: false, issued: [], status: null, error: e instanceof Error ? e.message.slice(0, 300) : "failed" };
  }
}

/** A payment that arrived outside the system (bank transfer, cash), recorded by an admin. */
export async function recordInvoicePayment(tenantId: string, invoiceId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const supabase = await createClient();
  const inv = await supabase.from("invoices").select("tenant_id, status, total, amount_paid").eq("id", invoiceId).maybeSingle();
  const row = inv.data as { tenant_id: string; status: string; total: number; amount_paid: number } | null;
  if (!row || row.tenant_id !== tenantId) return { status: "error", errors: {}, formError: "saveFailed" };
  if (!["issued", "overdue"].includes(row.status)) return { status: "error", errors: {}, formError: "notOpen" };

  const parsed = parsePaymentForm(raw(formData), Number(row.total) - Number(row.amount_paid), today());
  if (!parsed.ok) return { status: "error", errors: parsed.errors, formError: null };
  const p = parsed.value;
  const { error } = await supabase.rpc("record_payment", {
    p: {
      invoice_id: invoiceId,
      amount: p.amount,
      method: p.method,
      provider: p.reference ? "manual_bank_transfer" : null,
      provider_reference: p.reference,
      paid_at: `${p.paid_on}T12:00:00Z`,
    },
  });
  if (error) return { status: "error", errors: {}, formError: /not open/.test(error.message) ? "notOpen" : "saveFailed" };
  // Thank the tenant and lift billing restrictions now, not at the next daily run.
  await afterPayment(billingDeps(supabase), invoiceId, tenantId, today());
  revalidate(tenantId);
  return { status: "saved", errors: {}, formError: null };
}

/** Voids an open invoice (it no longer counts as owed); dunning is re-evaluated at once. */
export async function voidInvoice(tenantId: string, invoiceId: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .update({ status: "void", voided_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .in("status", ["issued", "overdue"])
    .select("id");
  if (data?.length) await afterPayment(billingDeps(supabase), invoiceId, tenantId, today());
  revalidate(tenantId);
}
