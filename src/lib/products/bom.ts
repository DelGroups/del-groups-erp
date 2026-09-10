import { supabase } from "@/lib/supabase";

export type ProductBomRow = {
  id: string;
  parent_product_id: string;
  component_product_id: string;
  quantity: number;
  component?: {
    id: string;
    code: string;
    name: string;
    unit: string | null;
    stock: number | null;
  };
};

export type ProductBomInput = {
  componentProductId: string;
  quantity: number;
};

export async function fetchProductBom(parentProductId: string): Promise<ProductBomRow[]> {
  const { data, error } = await supabase
    .from("product_bom")
    .select(
      "id, parent_product_id, component_product_id, quantity, component:products!product_bom_component_product_id_fkey(id, code, name, unit, stock)"
    )
    .eq("parent_product_id", parentProductId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[bom] fetch", error.message);
    return [];
  }

  return (data || []).map((row) => {
    const componentRaw = row.component as Record<string, unknown> | null;
    return {
      id: String(row.id),
      parent_product_id: String(row.parent_product_id),
      component_product_id: String(row.component_product_id),
      quantity: Number(row.quantity) || 1,
      component: componentRaw
        ? {
            id: String(componentRaw.id || ""),
            code: String(componentRaw.code || ""),
            name: String(componentRaw.name || ""),
            unit: typeof componentRaw.unit === "string" ? componentRaw.unit : null,
            stock: Number(componentRaw.stock) || 0,
          }
        : undefined,
    };
  });
}

export async function saveProductBom(
  parentProductId: string,
  rows: ProductBomInput[]
): Promise<{ ok: boolean; error?: string }> {
  const { error: deleteError } = await supabase
    .from("product_bom")
    .delete()
    .eq("parent_product_id", parentProductId);

  if (deleteError) return { ok: false, error: deleteError.message };

  const payload = rows
    .filter((row) => row.componentProductId && row.quantity > 0)
    .map((row) => ({
      parent_product_id: parentProductId,
      component_product_id: row.componentProductId,
      quantity: row.quantity,
    }));

  if (payload.length === 0) {
    return { ok: true };
  }

  const { error: insertError } = await supabase.from("product_bom").insert(payload);
  if (insertError) return { ok: false, error: insertError.message };
  return { ok: true };
}

export async function fetchProductAvailableStock(productId: string): Promise<number> {
  const { data, error } = await supabase.rpc("get_product_available_stock", {
    p_product_id: productId,
  });

  if (error) {
    console.error("[bom] available stock", error.message);
    return 0;
  }

  const parsed = Number(data);
  return Number.isFinite(parsed) ? parsed : 0;
}
