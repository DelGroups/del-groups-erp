"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseBillingSettingsForm } from "@/lib/billing/billingForms";

export interface SettingsFormState {
  status: "idle" | "error" | "saved";
  /** i18n keys under billingAdmin.errors */
  errors: Partial<Record<string, string>>;
  formError: string | null;
}

export async function saveBillingSettings(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireAdmin();
  const raw = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const parsed = parseBillingSettingsForm(raw);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, formError: null };
  const supabase = await createClient();
  const { error } = await supabase.from("billing_settings").update(parsed.value).eq("id", true);
  if (error) return { status: "error", errors: {}, formError: "saveFailed" };
  revalidatePath("/billing");
  return { status: "saved", errors: {}, formError: null };
}

/** Marks a plan change request done (the admin changed the subscription) or rejects it. */
export async function handlePlanRequest(requestId: string, status: "approved" | "rejected"): Promise<void> {
  const admin = await requireAdmin();
  if (status !== "approved" && status !== "rejected") return;
  const supabase = await createClient();
  await supabase
    .from("plan_change_requests")
    .update({ status, handled_by: admin.userId, handled_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");
  revalidatePath("/billing");
}
