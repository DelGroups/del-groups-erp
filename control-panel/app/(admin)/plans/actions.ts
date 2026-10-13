"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadModules } from "@/lib/billing/catalog";
import { parsePlanForm } from "@/lib/billing/forms";

export interface PlanFormState {
  status: "idle" | "error" | "saved";
  /** i18n keys under billing.errors, per field */
  errors: Partial<Record<string, string>>;
  formError: string | null;
}

const UNIQUE_VIOLATION = "23505";

/** Creates (id null) or updates a plan with its module and add-on prices, in one transaction. */
export async function savePlan(id: string | null, _prev: PlanFormState, formData: FormData): Promise<PlanFormState> {
  await requireAdmin();
  const supabase = await createClient();
  const modules = await loadModules(supabase);
  const raw = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const parsed = parsePlanForm(raw, modules.map((m) => m.id), id);
  if (!parsed.ok) return { status: "error", errors: parsed.errors, formError: null };

  const { data, error } = await supabase.rpc("save_plan", { p: parsed.value });
  if (error || !data) {
    return error?.code === UNIQUE_VIOLATION
      ? { status: "error", errors: { code: "codeTaken" }, formError: null }
      : { status: "error", errors: {}, formError: "saveFailed" };
  }
  revalidatePath("/plans");
  if (!id) redirect(`/plans/${data as string}?saved=1`);
  revalidatePath(`/plans/${id}`);
  return { status: "saved", errors: {}, formError: null };
}
