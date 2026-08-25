import { supabase } from "@/lib/supabase";
import type { Supplier } from "@/types/database.types";

export async function createSupplier(input: {
  full_name: string;
  company_name?: string;
  phone?: string;
}): Promise<{ ok: boolean; error?: string; supplier?: Supplier }> {
  if (!input.full_name.trim()) {
    return { ok: false, error: "Təchizatçı adı tələb olunur" };
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert([
      {
        code: `SUP-${Math.floor(1000 + Math.random() * 9000)}`,
        full_name: input.full_name.trim(),
        company_name: input.company_name?.trim() || null,
        phone: input.phone?.trim() || null,
        balance: 0,
      },
    ])
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, supplier: data as Supplier };
}
