import { supabase } from "@/lib/supabase";
import type { Supplier } from "@/types/database.types";
import type { EntityType } from "@/lib/customers/entityType";

export interface SupplierUpsertInput {
  id?: string | null;
  code: string;
  full_name: string;
  phone: string;
  company_name: string;
  address: string;
  voen: string | null;
  entity_type: EntityType;
  balance: number;
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as Supplier[]) || [];
}

export async function createSupplier(input: {
  full_name: string;
  company_name?: string;
  phone?: string;
  entity_type?: EntityType;
}): Promise<{ ok: boolean; error?: string; supplier?: Supplier }> {
  try {
    const supplier = await upsertSupplier({
      code: `SUP-${Math.floor(1000 + Math.random() * 9000)}`,
      full_name: input.full_name,
      phone: input.phone || "",
      company_name: input.company_name || "",
      address: "",
      voen: null,
      entity_type: input.entity_type || "physical",
      balance: 0,
    });
    return { ok: true, supplier };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Supplier create failed",
    };
  }
}

export async function upsertSupplier(input: SupplierUpsertInput): Promise<Supplier> {
  const payload = {
    code: input.code,
    full_name: input.full_name,
    phone: input.phone,
    company_name: input.company_name,
    address: input.address,
    voen: input.voen,
    entity_type: input.entity_type,
    balance: input.balance,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("suppliers")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as Supplier;
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert([payload])
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Supplier;
}
