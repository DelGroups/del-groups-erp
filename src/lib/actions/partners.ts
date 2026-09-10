"use server";

import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { PartnerFormInput } from "@/lib/partners/types";

export type PartnerActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

function trim(value: string | undefined | null): string {
  return (value || "").trim();
}

function partnerCode(input: PartnerFormInput): string {
  return trim(input.code) || `PTR-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

async function syncCustomerRecord(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: PartnerFormInput,
  existingCustomerId: string | null
): Promise<string | null> {
  if (!input.is_customer) return existingCustomerId;

  const payload = {
    code: partnerCode(input),
    full_name: trim(input.name),
    name: trim(input.name),
    phone: trim(input.phone) || null,
    company_name: trim(input.name),
    address: trim(input.address) || null,
    voen: trim(input.voen) || null,
    entity_type: trim(input.voen) ? "legal" : "physical",
  };

  if (existingCustomerId) {
    const { error } = await admin.from("customers").update(payload).eq("id", existingCustomerId);
    if (error) throw new Error(error.message);
    return existingCustomerId;
  }

  const { data, error } = await admin
    .from("customers")
    .insert([{ ...payload, balance: 0 }])
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message || "Müştəri yaradılmadı");
  return data.id as string;
}

async function syncSupplierRecord(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: PartnerFormInput,
  existingSupplierId: string | null
): Promise<string | null> {
  if (!input.is_supplier) return existingSupplierId;

  const payload = {
    full_name: trim(input.name),
    company_name: trim(input.name),
    phone: trim(input.phone) || null,
    address: trim(input.address) || null,
    voen: trim(input.voen) || null,
    entity_type: trim(input.voen) ? "legal" : "physical",
    code: partnerCode(input),
  };

  if (existingSupplierId) {
    const { error } = await admin.from("suppliers").update(payload).eq("id", existingSupplierId);
    if (error) throw new Error(error.message);
    return existingSupplierId;
  }

  const { data, error } = await admin
    .from("suppliers")
    .insert([{ ...payload, balance: 0 }])
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message || "Təchizatçı yaradılmadı");
  return data.id as string;
}

function buildPartnerPayload(
  input: PartnerFormInput,
  customerId: string | null,
  supplierId: string | null
) {
  const name = trim(input.name);
  return {
    name,
    full_name: name,
    company_name: name,
    code: partnerCode(input),
    phone: trim(input.phone) || null,
    email: trim(input.email) || null,
    address: trim(input.address) || null,
    voen: trim(input.voen) || null,
    bank_name: trim(input.bank_name) || null,
    iban: trim(input.iban) || null,
    credit_limit: Math.max(0, Number(input.credit_limit) || 0),
    is_customer: input.is_customer,
    is_supplier: input.is_supplier,
    customer_id: input.is_customer ? customerId : null,
    supplier_id: input.is_supplier ? supplierId : null,
    entity_type: trim(input.voen) ? "legal" : "physical",
    is_deleted: false,
  };
}

export async function createPartnerAction(
  input: PartnerFormInput
): Promise<PartnerActionResult<{ id: string }>> {
  try {
    await requirePermissionAction("can_manage_customers");
    if (!trim(input.name)) return { success: false, error: "Ad məcburidir" };
    if (!input.is_customer && !input.is_supplier) {
      return { success: false, error: "Ən azı bir rol seçilməlidir" };
    }

    const admin = createSupabaseAdminClient();
    const customerId = await syncCustomerRecord(admin, input, null);
    const supplierId = await syncSupplierRecord(admin, input, null);

    const { data, error } = await admin
      .from("partners")
      .insert([buildPartnerPayload(input, customerId, supplierId)])
      .select("id")
      .single();

    if (error || !data) return { success: false, error: error?.message || "Tərəfdaş yaradılmadı" };
    return { success: true, data: { id: data.id as string } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Xəta baş verdi" };
  }
}

export async function updatePartnerAction(
  partnerId: string,
  input: PartnerFormInput
): Promise<PartnerActionResult> {
  try {
    await requirePermissionAction("can_manage_customers");
    if (!trim(input.name)) return { success: false, error: "Ad məcburidir" };
    if (!input.is_customer && !input.is_supplier) {
      return { success: false, error: "Ən azı bir rol seçilməlidir" };
    }

    const admin = createSupabaseAdminClient();
    const { data: existing, error: fetchError } = await admin
      .from("partners")
      .select("id, customer_id, supplier_id")
      .eq("id", partnerId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (fetchError || !existing) return { success: false, error: "Tərəfdaş tapılmadı" };

    const customerId = await syncCustomerRecord(
      admin,
      input,
      (existing.customer_id as string) || null
    );
    const supplierId = await syncSupplierRecord(
      admin,
      input,
      (existing.supplier_id as string) || null
    );

    const { error } = await admin
      .from("partners")
      .update(buildPartnerPayload(input, customerId, supplierId))
      .eq("id", partnerId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Xəta baş verdi" };
  }
}

export async function deletePartnerAction(partnerId: string): Promise<PartnerActionResult> {
  try {
    await requirePermissionAction("can_manage_customers");
    const admin = createSupabaseAdminClient();

    const [{ count: salesCount }, { count: purchasesCount }] = await Promise.all([
      admin
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", partnerId),
      admin
        .from("purchases")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", partnerId),
    ]);

    if ((salesCount ?? 0) > 0 || (purchasesCount ?? 0) > 0) {
      return {
        success: false,
        error: "Maliyyə sənədi olan tərəfdaş silinə bilməz. Əvvəlcə birləşdirmə edin.",
      };
    }

    const { error } = await admin
      .from("partners")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", partnerId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Xəta baş verdi" };
  }
}

export async function mergePartnersAction(
  sourcePartnerId: string,
  targetPartnerId: string
): Promise<PartnerActionResult<{ salesMoved: number; purchasesMoved: number }>> {
  try {
    await requirePermissionAction("can_manage_customers");
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin.rpc("merge_partners", {
      p_source_partner_id: sourcePartnerId,
      p_target_partner_id: targetPartnerId,
    });

    if (error) return { success: false, error: error.message };

    const payload = (data || {}) as {
      sales_moved?: number;
      purchases_moved?: number;
    };

    return {
      success: true,
      data: {
        salesMoved: Number(payload.sales_moved) || 0,
        purchasesMoved: Number(payload.purchases_moved) || 0,
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Birləşdirmə uğursuz oldu" };
  }
}
