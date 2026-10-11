import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { POLYWOOD_WAREHOUSE_TYPE } from "@/lib/polywood/constants";
import type { Warehouse } from "@/types/database.types";

/**
 * The Polywood warehouse, created on first use. Server only (service role); callers check
 * permissions first. Used by the sales invoice form (core) and the polywood module's actions.
 */
export async function ensurePolywoodWarehouseAdmin(): Promise<Warehouse> {
  const admin = await createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("warehouses")
    .select("*")
    .eq("warehouse_type", POLYWOOD_WAREHOUSE_TYPE)
    .maybeSingle();

  if (existing) return existing as Warehouse;

  const { data: created, error } = await admin
    .from("warehouses")
    .insert([
      {
        code: "PW-001",
        name: "Polywood",
        location: "Polywood anbarı",
        is_default: false,
        warehouse_type: POLYWOOD_WAREHOUSE_TYPE,
      },
    ])
    .select("*")
    .single();

  if (error || !created) {
    throw new Error(error?.message || "Failed to create Polywood warehouse");
  }

  return created as Warehouse;
}
