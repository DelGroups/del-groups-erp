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

export async function fetchCompositeAvailableStockAction(
  productId: string
): Promise<{ success: boolean; stock: number; error?: string }> {
  try {
    await requirePermissionAction("can_view_products");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("get_composite_available_stock", {
      p_product_id: productId,
    });

    if (error) return { success: false, stock: 0, error: error.message };
    const stock = Number(data);
    return { success: true, stock: Number.isFinite(stock) ? stock : 0 };
  } catch (err) {
    return {
      success: false,
      stock: 0,
      error: err instanceof Error ? err.message : "Komplekt stoku yüklənmədi",
    };
  }
}

export async function fetchProductStocksBatchAction(
  productIds: string[]
): Promise<{ success: boolean; stocks: Record<string, number>; error?: string }> {
  try {
    await requirePermissionAction("can_view_products");
    const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      return { success: true, stocks: {} };
    }

    const admin = createSupabaseAdminClient();
    const { data: productRows, error: productError } = await admin
      .from("products")
      .select("id, is_composite")
      .in("id", uniqueIds);

    if (productError) {
      return { success: false, stocks: {}, error: productError.message };
    }

    const compositeIds = new Set(
      (productRows || [])
        .filter((row) => Boolean(row.is_composite))
        .map((row) => String(row.id))
    );

    const stocks: Record<string, number> = {};
    await Promise.all(
      uniqueIds.map(async (productId) => {
        const rpcName = compositeIds.has(productId)
          ? "get_composite_available_stock"
          : "get_product_available_stock";
        const { data, error } = await admin.rpc(rpcName, { p_product_id: productId });
        stocks[productId] = !error && Number.isFinite(Number(data)) ? Number(data) : 0;
      })
    );

    return { success: true, stocks };
  } catch (err) {
    return {
      success: false,
      stocks: {},
      error: err instanceof Error ? err.message : "Stok yüklənmədi",
    };
  }
}

export async function fetchCompositeBomIndexAction(): Promise<{
  success: boolean;
  index: Array<{ productId: string; componentIds: string[] }>;
  error?: string;
}> {
  try {
    await requirePermissionAction("can_view_products");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("product_bom")
      .select("parent_product_id, component_product_id");

    if (error) return { success: false, index: [], error: error.message };

    const grouped = new Map<string, string[]>();
    for (const row of data || []) {
      const parentId = String(row.parent_product_id);
      const componentId = String(row.component_product_id);
      const list = grouped.get(parentId) || [];
      list.push(componentId);
      grouped.set(parentId, list);
    }

    const index = Array.from(grouped.entries()).map(([productId, componentIds]) => ({
      productId,
      componentIds,
    }));

    return { success: true, index };
  } catch (err) {
    return {
      success: false,
      index: [],
      error: err instanceof Error ? err.message : "BOM indeksi yüklənmədi",
    };
  }
}

function findCompositeParentId(
  bomRows: Array<{ parent_product_id: string; component_product_id: string }>,
  seatId: string,
  baseId: string
): string | null {
  const wanted = new Set([seatId, baseId]);
  const grouped = new Map<string, Set<string>>();

  for (const row of bomRows) {
    const parentId = String(row.parent_product_id);
    const componentId = String(row.component_product_id);
    const set = grouped.get(parentId) || new Set<string>();
    set.add(componentId);
    grouped.set(parentId, set);
  }

  for (const [parentId, componentIds] of grouped) {
    if (componentIds.size !== wanted.size) continue;
    if ([...wanted].every((id) => componentIds.has(id))) {
      return parentId;
    }
  }

  return null;
}

export async function resolveConfiguratorKitAction(
  seatId: string,
  baseId: string
): Promise<{
  success: boolean;
  product?: Record<string, unknown>;
  stock?: number;
  created?: boolean;
  error?: string;
}> {
  try {
    await requirePermissionAction("can_create_invoice");

    if (!seatId || !baseId) {
      return { success: false, error: "Oturacaq və ayaq seçilməlidir" };
    }
    if (seatId === baseId) {
      return { success: false, error: "Oturacaq və ayaq eyni məhsul ola bilməz" };
    }

    const admin = createSupabaseAdminClient();

    const [{ data: seat, error: seatError }, { data: base, error: baseError }] =
      await Promise.all([
        admin.from("products").select("*").eq("id", seatId).maybeSingle(),
        admin.from("products").select("*").eq("id", baseId).maybeSingle(),
      ]);

    if (seatError) return { success: false, error: seatError.message };
    if (baseError) return { success: false, error: baseError.message };
    if (!seat || !base) {
      return { success: false, error: "Komponent məhsullar tapılmadı" };
    }

    const { data: bomRows, error: bomError } = await admin
      .from("product_bom")
      .select("parent_product_id, component_product_id");

    if (bomError) return { success: false, error: bomError.message };

    const existingParentId = findCompositeParentId(bomRows || [], seatId, baseId);

    if (existingParentId) {
      const { data: product, error: productError } = await admin
        .from("products")
        .select("*")
        .eq("id", existingParentId)
        .maybeSingle();

      if (productError) return { success: false, error: productError.message };
      if (!product) return { success: false, error: "Komplekt məhsul tapılmadı" };

      const { data: stockData, error: stockError } = await admin.rpc(
        "get_composite_available_stock",
        { p_product_id: existingParentId }
      );

      if (stockError) return { success: false, error: stockError.message };

      return {
        success: true,
        product,
        stock: Number(stockData) || 0,
        created: false,
      };
    }

    const seatName = String(seat.name || "").trim();
    const baseName = String(base.name || "").trim();
    const seatCode = String(seat.code || "").trim();
    const baseCode = String(base.code || "").trim();
    const name = `${seatName} ${baseName}`.trim();
    const code = seatCode && baseCode ? `${seatCode}-${baseCode}` : seatCode || baseCode || null;
    const sellPrice =
      (Number(seat.sell_price) || 0) + (Number(base.sell_price) || 0);
    const buyPrice = (Number(seat.buy_price) || 0) + (Number(base.buy_price) || 0);

    const { data: newProduct, error: insertError } = await admin
      .from("products")
      .insert({
        name,
        code,
        category: seat.category || base.category || "Ümumi",
        subcategory: seat.subcategory || base.subcategory || null,
        unit: seat.unit || base.unit || "Ədəd",
        buy_price: buyPrice,
        sell_price: sellPrice,
        stock: 0,
        min_stock: 0,
        is_composite: true,
        is_service: false,
      })
      .select("*")
      .single();

    if (insertError || !newProduct) {
      return { success: false, error: insertError?.message || "Komplekt yaradılmadı" };
    }

    const { error: bomInsertError } = await admin.from("product_bom").insert([
      {
        parent_product_id: newProduct.id,
        component_product_id: seatId,
        quantity: 1,
      },
      {
        parent_product_id: newProduct.id,
        component_product_id: baseId,
        quantity: 1,
      },
    ]);

    if (bomInsertError) {
      await admin.from("products").delete().eq("id", newProduct.id);
      return { success: false, error: bomInsertError.message };
    }

    const { data: stockData, error: stockError } = await admin.rpc(
      "get_composite_available_stock",
      { p_product_id: newProduct.id }
    );

    if (stockError) {
      return { success: false, error: stockError.message };
    }

    return {
      success: true,
      product: newProduct,
      stock: Number(stockData) || 0,
      created: true,
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return {
      success: false,
      error: err instanceof Error ? err.message : "Komplekt hazırlanmadı",
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
