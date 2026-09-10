"use server";

import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { ProductBomInput } from "@/lib/products/bom";

export async function saveProductBomAction(
  parentProductId: string,
  rows: ProductBomInput[],
  isComposite: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermissionAction("can_manage_products");
    const admin = createSupabaseAdminClient();

    const { error: productError } = await admin
      .from("products")
      .update({ is_composite: isComposite })
      .eq("id", parentProductId);

    if (productError) return { success: false, error: productError.message };

    const { error: deleteError } = await admin
      .from("product_bom")
      .delete()
      .eq("parent_product_id", parentProductId);

    if (deleteError) return { success: false, error: deleteError.message };

    if (!isComposite) {
      return { success: true };
    }

    const payload = rows
      .filter((row) => row.componentProductId && row.quantity > 0)
      .map((row) => ({
        parent_product_id: parentProductId,
        component_product_id: row.componentProductId,
        quantity: row.quantity,
      }));

    if (payload.length === 0) {
      return { success: false, error: "Komplekt üçün ən azı bir komponent tələb olunur" };
    }

    const { error: insertError } = await admin.from("product_bom").insert(payload);
    if (insertError) return { success: false, error: insertError.message };

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return {
      success: false,
      error: err instanceof Error ? err.message : "BOM saxlanmadı",
    };
  }
}

export async function fetchProductAvailableStockAction(
  productId: string
): Promise<{ success: boolean; stock: number; error?: string }> {
  try {
    await requirePermissionAction("can_view_products");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("get_product_available_stock", {
      p_product_id: productId,
    });

    if (error) return { success: false, stock: 0, error: error.message };
    const stock = Number(data);
    return { success: true, stock: Number.isFinite(stock) ? stock : 0 };
  } catch (err) {
    return {
      success: false,
      stock: 0,
      error: err instanceof Error ? err.message : "Stok yüklənmədi",
    };
  }
}

export async function fetchProductBomAction(parentProductId: string) {
  try {
    await requirePermissionAction("can_manage_products");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("product_bom")
      .select(
        "id, parent_product_id, component_product_id, quantity, component:products!product_bom_component_product_id_fkey(id, code, name, unit, stock)"
      )
      .eq("parent_product_id", parentProductId)
      .order("created_at", { ascending: true });

    if (error) return { success: false, rows: [], error: error.message };

    const rows = (data || []).map((row) => {
      const componentRaw = row.component as Record<string, unknown> | null;
      return {
        id: String(row.id),
        componentProductId: String(row.component_product_id),
        quantity: Number(row.quantity) || 1,
        componentCode: componentRaw ? String(componentRaw.code || "") : "",
        componentName: componentRaw ? String(componentRaw.name || "") : "",
      };
    });

    return { success: true, rows };
  } catch (err) {
    return {
      success: false,
      rows: [],
      error: err instanceof Error ? err.message : "BOM yüklənmədi",
    };
  }
}
