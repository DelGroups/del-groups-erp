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

function mapRpcError(message: string): CreateProductErrorCode {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("product_name_required") ||
    normalized.includes("bom_rows_required") ||
    normalized.includes("bom_self_reference")
  ) {
    return "validation";
  }
  if (isDuplicateKeyError(message)) {
    return "duplicate";
  }
  return "unknown";
}

function serializeBomRows(rows: ProductBomInput[]) {
  return rows
    .filter((row) => row.componentProductId && row.quantity > 0)
    .map((row) => ({
      component_product_id: row.componentProductId,
      quantity: row.quantity,
    }));
}

async function createProductViaRpc(
  admin: SupabaseClient<Database>,
  payload: ProductInsert,
  bomRows: ProductBomInput[],
  isComposite: boolean
): Promise<CreateProductWithRelationsResult> {
  const { data, error } = await admin.rpc("create_product_with_bom_atomic", {
    p_product: payload as unknown as Record<string, unknown>,
    p_bom_rows: serializeBomRows(bomRows),
    p_is_composite: isComposite,
  });

  if (error) {
    return {
      ok: false,
      error: error.message,
      errorCode: mapRpcError(error.message),
    };
  }

  if (!data || typeof data !== "object") {
    return {
      ok: false,
      error: "Product RPC returned an empty response",
      errorCode: "unknown",
    };
  }

  return { ok: true, product: data as Product };
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
  const bomRows = input.bomRows ?? [];

  const rpcResult = await createProductViaRpc(admin, payload, bomRows, isComposite);
  if (!rpcResult.ok || !rpcResult.product) {
    return rpcResult;
  }

  const product = rpcResult.product;

  if (isDimensional && input.dimensionalInitialStock && baseLengthM > 0) {
    const pieceRows = buildDimensionalPieceRows(
      product.id,
      input.dimensionalInitialStock.warehouseId,
      baseLengthM,
      input.dimensionalInitialStock
    );

    if (pieceRows.length > 0) {
      try {
        await insertPolywoodPieces(pieceRows);
      } catch (pieceError) {
        await admin.from("products").delete().eq("id", product.id);
        return {
          ok: false,
          error:
            pieceError instanceof Error
              ? pieceError.message
              : "Failed to insert polywood pieces",
          errorCode: "unknown",
        };
      }
    }
  }

  return { ok: true, product };
}
