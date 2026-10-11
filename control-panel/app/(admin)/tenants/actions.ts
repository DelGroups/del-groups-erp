"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseTenantInput, type TenantErrors } from "@/lib/tenants";

export interface TenantFormState {
  status: "idle" | "error" | "saved";
  /** i18n keys under tenants.errors, per field */
  errors: TenantErrors;
  /** i18n key under tenants.errors for the whole form */
  formError: string | null;
  values: Record<string, string>;
}

const FIELDS = ["name", "slug", "status", "country", "language", "currency", "notes"] as const;

function formValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "")]));
}

function failure(values: Record<string, string>, errors: TenantErrors, formError: string | null = null): TenantFormState {
  return { status: "error", errors, formError, values };
}

const UNIQUE_VIOLATION = "23505";

export async function createTenant(_prev: TenantFormState, formData: FormData): Promise<TenantFormState> {
  await requireAdmin();
  const values = formValues(formData);
  const parsed = parseTenantInput(values);
  if (!parsed.ok) return failure(values, parsed.errors);

  const supabase = await createClient();
  const { data, error } = await supabase.from("tenants").insert(parsed.value).select("id").single();
  if (error || !data) {
    return error?.code === UNIQUE_VIOLATION
      ? failure(values, { slug: "slugTaken" })
      : failure(values, {}, "saveFailed");
  }

  revalidatePath("/tenants");
  redirect(`/tenants/${data.id}?created=1`);
}

export async function updateTenant(
  tenantId: string,
  _prev: TenantFormState,
  formData: FormData
): Promise<TenantFormState> {
  await requireAdmin();
  const values = formValues(formData);
  const parsed = parseTenantInput(values);
  if (!parsed.ok) return failure(values, parsed.errors);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .update(parsed.value)
    .eq("id", tenantId)
    .select("id")
    .maybeSingle();
  if (error) {
    return error.code === UNIQUE_VIOLATION
      ? failure(values, { slug: "slugTaken" })
      : failure(values, {}, "saveFailed");
  }
  if (!data) return failure(values, {}, "notFound");

  revalidatePath("/tenants");
  revalidatePath(`/tenants/${tenantId}`);
  return { status: "saved", errors: {}, formError: null, values };
}
