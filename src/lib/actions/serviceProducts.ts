"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import type { Product } from "@/types/database.types";

export type ServiceProductsActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

const DEFAULT_SERVICE_PRODUCTS = [
  { code: "SRV-KESIM", name: "Kəsim Xidməti", sellPrice: 5 },
  { code: "SRV-BANT", name: "Kənar Bantlama Xidməti", sellPrice: 8 },
] as const;

async function resolveServicesCategoryId(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<string | null> {
  const { data: existing } = await admin
    .from("categories")
    .select("id, name")
    .is("parent_id", null)
    .in("name", ["Services", "Xidmət", "Xidmet"]);

  const row = existing?.[0];
  if (row?.id) return row.id as string;

  const { data: created, error } = await admin
    .from("categories")
    .insert([{ name: "Services", parent_id: null }])
    .select("id")
    .single();

  if (error || !created?.id) return null;
  return created.id as string;
}

/**
 * Ensures default billable service products exist (Kəsim, Kənar Bantlama).
 * Safe to call on every mixed-invoice page load — idempotent.
 */
export async function ensureDefaultServiceProductsAction(): Promise<
  ServiceProductsActionResult<{ products: Product[]; created: number }>
> {
  try {
    await requirePermissionAction("can_view_products");
    const admin = createSupabaseAdminClient();
    const categoryId = await resolveServicesCategoryId(admin);

    if (!categoryId) {
      return { success: false, error: "Services category could not be resolved" };
    }

    let created = 0;
    const ensured: Product[] = [];

    for (const seed of DEFAULT_SERVICE_PRODUCTS) {
      const { data: existing } = await admin
        .from("products")
        .select("*")
        .ilike("name", seed.name)
        .maybeSingle();

      if (existing) {
        if (!existing.is_service) {
          await admin.from("products").update({ is_service: true, category_id: categoryId }).eq("id", existing.id);
        }
        ensured.push(existing as Product);
        continue;
      }

      const { data: inserted, error } = await admin
        .from("products")
        .insert([
          {
            code: seed.code,
            name: seed.name,
            category: "Services",
            subcategory: "Services",
            unit: "Xidmət",
            buy_price: 0,
            sell_price: seed.sellPrice,
            stock: 0,
            min_stock: 0,
            category_id: categoryId,
            is_dimensional: false,
            is_service: true,
            inventory_mode: "standard",
          },
        ])
        .select("*")
        .single();

      if (error || !inserted) {
        return { success: false, error: error?.message || `Failed to seed ${seed.name}` };
      }

      created += 1;
      ensured.push(inserted as Product);
    }

    const { data: allServices } = await admin
      .from("products")
      .select("*")
      .or("is_service.eq.true,category.eq.Services,category.eq.Xidmət")
      .order("name", { ascending: true });

    return {
      success: true,
      data: {
        products: (allServices as Product[]) || ensured,
        created,
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed to seed services" };
  }
}
