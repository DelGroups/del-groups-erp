"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import {
  DEFAULT_FULL_SHEET_LENGTH_M,
  POLYWOOD_INVENTORY_MODE,
  POLYWOOD_WAREHOUSE_TYPE,
  isFullSheetLength,
} from "@/lib/polywood/constants";
import { addPolywoodStockFromLengths } from "@/lib/polywood/inventory";
import type { PolywoodImportRow } from "@/lib/polywood/import";
import type { Warehouse } from "@/types/database.types";

export type PolywoodActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

async function ensurePolywoodWarehouseAdmin(): Promise<Warehouse> {
  const admin = createSupabaseAdminClient();
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

export async function ensurePolywoodWarehouseAction(): Promise<
  PolywoodActionResult<{ warehouse: Warehouse }>
> {
  try {
    await requirePermissionAction("can_view_products");
    const warehouse = await ensurePolywoodWarehouseAdmin();
    return { success: true, data: { warehouse } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function importPolywoodStockAction(
  rows: PolywoodImportRow[]
): Promise<PolywoodActionResult<{ imported: number; skipped: number }>> {
  try {
    await requirePermissionAction("can_manage_products");
    const admin = createSupabaseAdminClient();
    const warehouse = await ensurePolywoodWarehouseAdmin();

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.errors.length > 0 || row.parsedLengths.length === 0) {
        skipped += 1;
        continue;
      }

      const code = row.code.trim() || `PW-${Date.now().toString(36).slice(-5)}`;
      const fullSheetLengthM = row.fullSheetLengthM || DEFAULT_FULL_SHEET_LENGTH_M;

      let productId: string | null = null;

      if (code) {
        const { data: byCode } = await admin
          .from("products")
          .select("id")
          .eq("code", code)
          .maybeSingle();
        productId = (byCode?.id as string) || null;
      }

      if (!productId && row.barcode.trim()) {
        const { data: byBarcode } = await admin
          .from("products")
          .select("id")
          .eq("barcode", row.barcode.trim())
          .maybeSingle();
        productId = (byBarcode?.id as string) || null;
      }

      if (!productId) {
        const { data: createdProduct, error: createError } = await admin
          .from("products")
          .insert([
            {
              code,
              name: row.name.trim(),
              category: "Polywood",
              subcategory: "Polywood",
              unit: "Metr",
              buy_price: row.buyPrice,
              sell_price: row.sellPrice,
              stock: 0,
              min_stock: 0,
              barcode: row.barcode.trim() || null,
              inventory_mode: POLYWOOD_INVENTORY_MODE,
              full_sheet_length_m: fullSheetLengthM,
            },
          ])
          .select("id")
          .single();

        if (createError || !createdProduct) {
          return { success: false, error: createError?.message || `Failed to create ${row.name}` };
        }
        productId = createdProduct.id as string;
      } else {
        await admin
          .from("products")
          .update({
            inventory_mode: POLYWOOD_INVENTORY_MODE,
            full_sheet_length_m: fullSheetLengthM,
            unit: "Metr",
            category: "Polywood",
          })
          .eq("id", productId);
      }

      const pieceRows = row.parsedLengths.map((length) => ({
        product_id: productId!,
        warehouse_id: warehouse.id,
        length_m: Math.round(length * 1000) / 1000,
        piece_type: isFullSheetLength(length, fullSheetLengthM) ? "full" : "cut",
        status: "available",
      }));

      const { error: piecesError } = await admin.from("polywood_pieces").insert(pieceRows);
      if (piecesError) return { success: false, error: piecesError.message };

      const { data: allPieces } = await admin
        .from("polywood_pieces")
        .select("length_m")
        .eq("product_id", productId)
        .eq("warehouse_id", warehouse.id)
        .eq("status", "available");

      const totalLength = (allPieces || []).reduce(
        (sum, piece) => sum + (Number(piece.length_m) || 0),
        0
      );
      await admin.from("products").update({ stock: totalLength }).eq("id", productId);

      imported += 1;
    }

    return { success: true, data: { imported, skipped } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Import failed" };
  }
}

export async function addPolywoodPiecesAction(input: {
  productId: string;
  lengthsM: number[];
  fullSheetLengthM?: number;
}): Promise<PolywoodActionResult<{ added: number }>> {
  try {
    await requirePermissionAction("can_manage_products");
    const warehouse = await ensurePolywoodWarehouseAdmin();
    const admin = createSupabaseAdminClient();

    const fullSheetLengthM = input.fullSheetLengthM || DEFAULT_FULL_SHEET_LENGTH_M;
    const rows = input.lengthsM
      .filter((length) => length > 0)
      .map((length) => ({
        product_id: input.productId,
        warehouse_id: warehouse.id,
        length_m: Math.round(length * 1000) / 1000,
        piece_type: isFullSheetLength(length, fullSheetLengthM) ? "full" : "cut",
        status: "available",
      }));

    if (rows.length === 0) {
      return { success: false, error: "No valid lengths provided" };
    }

    const { error } = await admin.from("polywood_pieces").insert(rows);
    if (error) return { success: false, error: error.message };

    const { data: pieces } = await admin
      .from("polywood_pieces")
      .select("length_m")
      .eq("product_id", input.productId)
      .eq("warehouse_id", warehouse.id)
      .eq("status", "available");

    const totalLength = (pieces || []).reduce(
      (sum, piece) => sum + (Number(piece.length_m) || 0),
      0
    );
    await admin.from("products").update({ stock: totalLength }).eq("id", input.productId);

    return { success: true, data: { added: rows.length } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
