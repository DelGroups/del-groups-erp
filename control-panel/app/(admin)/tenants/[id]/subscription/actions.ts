"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadModules, loadPlans, toPlanPricing } from "@/lib/billing/catalog";
import { parseSubscriptionForm } from "@/lib/billing/forms";
import { validateChoice, type AddonCode } from "@/lib/billing/pricing";
import { syncTenantNow, type SyncView } from "@/lib/billing/server";
import { notifyErpTenantChanged } from "@/lib/erpWebhook";

export interface SubscriptionFormState {
  status: "idle" | "error" | "saved";
  /** i18n keys under billing.errors */
  errors: Partial<Record<string, string>>;
  formError: string | null;
  sync: SyncView | null;
}

/** Saves the tenant's live subscription, then copies modules and limits to its database. */
export async function saveSubscription(
  tenantId: string,
  _prev: SubscriptionFormState,
  formData: FormData
): Promise<SubscriptionFormState> {
  await requireAdmin();
  const supabase = await createClient();
  const [plans, modules] = await Promise.all([loadPlans(supabase), loadModules(supabase)]);
  const raw = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const parsed = parseSubscriptionForm(raw, tenantId, plans.map((p) => p.id), modules.map((m) => m.id));
  if (!parsed.ok) return { status: "error", errors: parsed.errors, formError: null, sync: null };

  const input = parsed.value;
  const plan = plans.find((p) => p.id === input.plan_id)!;
  if (input.status !== "cancelled") {
    const addons = Object.fromEntries(input.addons.map((a) => [a.addon_code, a.quantity])) as Partial<Record<AddonCode, number>>;
    const check = validateChoice(
      toPlanPricing(plan),
      { period: input.billing_period, userCount: input.user_count, modules: input.modules, addons },
      modules
    );
    if (check.errors.length) {
      return { status: "error", errors: { form: check.errors[0] }, formError: check.errors[0], sync: null };
    }
  }

  const { error } = await supabase.rpc("save_subscription", { p: input });
  if (error) return { status: "error", errors: {}, formError: "saveFailed", sync: null };

  await supabase.rpc("log_platform_action", {
    p_action: "subscription",
    p_entity_table: "tenants",
    p_entity_id: tenantId,
    p_details: {
      plan: plan.code,
      status: input.status,
      period: input.billing_period,
      users: input.user_count,
      modules: input.modules,
      addons: input.addons,
    },
  });
  const sync = await syncTenantNow(supabase, tenantId);
  if (sync.status === "synced") await notifyErpTenantChanged(tenantId);
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/subscription`);
  return { status: "saved", errors: {}, formError: null, sync };
}

/** Copies the current subscription to the tenant database again (after a failure). */
export async function resyncSubscription(tenantId: string): Promise<SyncView> {
  await requireAdmin();
  const supabase = await createClient();
  const sync = await syncTenantNow(supabase, tenantId);
  revalidatePath(`/tenants/${tenantId}`);
  revalidatePath(`/tenants/${tenantId}/subscription`);
  return sync;
}
