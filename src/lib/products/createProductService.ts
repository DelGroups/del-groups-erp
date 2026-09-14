import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  buildDimensionalPieceRows,
  buildProductInsert,
  calculateDimensionalInitialStockMeters,
  type DimensionalInitialStockInput,
} from "@/lib/products/api";
import type { ProductBomInput } from "@/lib/products/bom";
import { insertPolywoodPieces } from "@/lib/polywood/inventory";
import type { Database, Product, ProductInsert } from "@/types/database.types";

export type CreateProductErrorCode = "duplicate" | "validation" | "unknown";

export interface CreateProductWithRelationsInput {
  product: Partial<ProductInsert> & Pick<ProductInsert, "name">;
  bomRows?: ProductBomInput[];
  isComposite?: boolean;
  dimensionalInitialStock?: DimensionalInitialStockInput | null;
}

export interface CreateProductWithRelationsResult {
  ok: boolean;
  product?: Product;
  error?: string;
  errorCode?: CreateProductErrorCode;
}

function isDuplicateKeyError(message: string, code?: string): boolean {
  return code === "23505" || message.toLowerCase().includes("duplicate key");
}

async function saveProductBomBatch(
  admin: SupabaseClient<Database>,
  parentProductId: string,
  rows: ProductBomInput[],
  isComposite: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { error: productError } = await admin
    .from("products")
    .update({ is_composite: isComposite })
    .eq("id", parentProductId);

  if (productError) return { ok: false, error: productError.message };

  const { error: deleteError } = await admin
    .from("product_bom")
    .delete()
    .eq("parent_product_id", parentProductId);

  if (deleteError) return { ok: false, error: deleteError.message };

  if (!isComposite) {
    return { ok: true };
  }

  const payload = rows
    .filter((row) => row.componentProductId && row.quantity > 0)
    .map((row) => ({
      parent_product_id: parentProductId,
      component_product_id: row.componentProductId,
      quantity: row.quantity,
    }));

  if (payload.length === 0) {
    return { ok: false, error: "Komplekt üçün ən azı bir komponent tələb olunur" };
  }

  const { error: insertError } = await admin.from("product_bom").insert(payload);
  if (insertError) return { ok: false, error: insertError.message };

  return { ok: true };
}

export async function createProductWithRelations(
  input: CreateProductWithRelationsInput,
  adminClient?: SupabaseClient<Database>
): Promise<CreateProductWithRelationsResult> {
  const admin = adminClient ?? createSupabaseAdminClient();
  const isDimensional = Boolean(input.product.is_dimensional);
  const baseLengthM = isDimensional ? Number(input.product.base_length) || 0 : 0;
  const productInput = { ...input.product };

  if (isDimensional && input.dimensionalInitialStock) {
    if (!input.dimensionalInitialStock.warehouseId) {
      return {
        ok: false,
        error: "Dimensional initial stock requires a warehouse",
        errorCode: "validation",
      };
    }
    if (baseLengthM <= 0) {
      return {
        ok: false,
        error: "Base length is required for dimensional initial stock",
        errorCode: "validation",
      };
    }
    productInput.stock = calculateDimensionalInitialStockMeters(
      baseLengthM,
      input.dimensionalInitialStock.fullSheetCount,
      input.dimensionalInitialStock.offCuts
    );
  }

  const payload = buildProductInsert(productInput);
  const isComposite = Boolean(input.isComposite) && !payload.is_service;

  const { data, error } = await admin.from("products").insert([payload]).select("*").single();

  if (error) {
    if (isDuplicateKeyError(error.message, error.code)) {
      return {
        ok: false,
        error: error.message,
        errorCode: "duplicate",
      };
    }
    return { ok: false, error: error.message, errorCode: "unknown" };
  }

  const product = data as Product;

  try {
    if (isDimensional && input.dimensionalInitialStock && baseLengthM > 0) {
      const pieceRows = buildDimensionalPieceRows(
        product.id,
        input.dimensionalInitialStock.warehouseId,
        baseLengthM,
        input.dimensionalInitialStock
      );

      if (pieceRows.length > 0) {
        await insertPolywoodPieces(pieceRows);
      }
    }

    const bomRows = input.bomRows ?? [];
    if (isComposite || bomRows.length > 0) {
      const bomResult = await saveProductBomBatch(admin, product.id, bomRows, isComposite);
      if (!bomResult.ok) {
        await admin.from("products").delete().eq("id", product.id);
        return { ok: false, error: bomResult.error, errorCode: "unknown" };
      }
    }
  } catch (relationError) {
    await admin.from("products").delete().eq("id", product.id);
    return {
      ok: false,
      error:
        relationError instanceof Error
          ? relationError.message
          : "Related product data could not be saved",
      errorCode: "unknown",
    };
  }

  return { ok: true, product };
}
