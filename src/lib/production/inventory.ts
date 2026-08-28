import { DEFAULT_FULL_SHEET_LENGTH_M, POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import { planPolywoodSaleCut } from "@/lib/polywood/cutting";
import type { PolywoodPiece, PolywoodCutResult } from "@/lib/polywood/types";
import type { Product } from "@/types/database.types";

/** Untyped query builder — production tables may not be in generated Database yet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (table: string) => any };

export async function fetchProductById(admin: DbClient, productId: string): Promise<Product | null> {
  const { data, error } = await admin.from("products").select("*").eq("id", productId).maybeSingle();
  if (error || !data) return null;
  return data as Product;
}

export async function decrementStandardStock(
  admin: DbClient,
  productId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string }> {
  const product = await fetchProductById(admin, productId);
  if (!product) return { ok: false, error: "Məhsul tapılmadı" };
  const current = Number(product.stock) || 0;
  if (current + 1e-9 < quantity) {
    return { ok: false, error: `${product.name}: stok kifayət etmir (mövcud: ${current})` };
  }
  const { error } = await admin
    .from("products")
    .update({ stock: current - quantity })
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function incrementStandardStock(
  admin: DbClient,
  productId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string }> {
  const product = await fetchProductById(admin, productId);
  if (!product) return { ok: false, error: "Məhsul tapılmadı" };
  const { error } = await admin
    .from("products")
    .update({ stock: (Number(product.stock) || 0) + quantity })
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function fetchAvailablePieces(
  admin: DbClient,
  productId: string,
  warehouseId: string
): Promise<PolywoodPiece[]> {
  const { data, error } = await admin
    .from("polywood_pieces")
    .select("*")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("status", "available")
    .order("piece_type", { ascending: true })
    .order("length_m", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as PolywoodPiece[]) || [];
}

async function syncPolywoodProductStock(
  admin: DbClient,
  productId: string,
  warehouseId: string
): Promise<void> {
  const pieces = await fetchAvailablePieces(admin, productId, warehouseId);
  const total = pieces.reduce((sum, piece) => sum + Number(piece.length_m || 0), 0);
  await admin
    .from("products")
    .update({ stock: Math.round(total * 1000) / 1000 })
    .eq("id", productId);
}

export async function allocatePolywoodForProduction(
  admin: DbClient,
  input: {
    productId: string;
    warehouseId: string;
    referenceId: string;
    mode: "linear_m" | "full_sheet";
    quantity: number;
    fullSheetLengthM: number;
  }
): Promise<{ ok: boolean; error?: string; cutResult?: PolywoodCutResult; usedLengthM?: number }> {
  try {
    const pieces = await fetchAvailablePieces(admin, input.productId, input.warehouseId);
    const cutResult = planPolywoodSaleCut(
      input.mode,
      input.quantity,
      pieces,
      input.fullSheetLengthM
    );
    const now = new Date().toISOString();

    for (const step of cutResult.steps) {
      if (step.action === "consume") {
        const { error } = await admin
          .from("polywood_pieces")
          .update({
            status: "sold",
            sale_item_id: input.referenceId,
            notes: `Production ${input.referenceId}`,
            updated_at: now,
          })
          .eq("id", step.pieceId)
          .eq("status", "available");
        if (error) return { ok: false, error: error.message };
        continue;
      }

      if (step.action === "partial") {
        const { error } = await admin
          .from("polywood_pieces")
          .update({
            length_m: step.remainingOnPiece,
            piece_type: "cut",
            updated_at: now,
          })
          .eq("id", step.pieceId)
          .eq("status", "available");
        if (error) return { ok: false, error: error.message };
        continue;
      }

      if (step.action === "split_full") {
        const { error: consumeError } = await admin
          .from("polywood_pieces")
          .update({
            status: "consumed",
            sale_item_id: input.referenceId,
            notes: `Production ${input.referenceId}`,
            updated_at: now,
          })
          .eq("id", step.pieceId)
          .eq("status", "available");
        if (consumeError) return { ok: false, error: consumeError.message };

        if (step.scrapLength && step.scrapLength > 0) {
          const { error: scrapError } = await admin
            .from("polywood_pieces")
            .insert([
              {
                product_id: input.productId,
                warehouse_id: input.warehouseId,
                length_m: step.scrapLength,
                piece_type: "cut",
                status: "available",
                notes: `Cut remainder from production ${input.referenceId}`,
                sale_item_id: null,
                updated_at: now,
              },
            ]);
          if (scrapError) return { ok: false, error: scrapError.message };
        }
      }
    }

    await syncPolywoodProductStock(admin, input.productId, input.warehouseId);
    return {
      ok: true,
      cutResult: { ...cutResult, scrapCreated: cutResult.scrapCreated },
      usedLengthM:
        input.mode === "full_sheet"
          ? input.quantity * input.fullSheetLengthM
          : input.quantity,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Polywood kəsimi alınmadı" };
  }
}

export async function allocateProductionMaterial(
  admin: DbClient,
  input: {
    productId: string;
    warehouseId: string;
    quantity: number;
    polywoodMode?: "linear_m" | "full_sheet" | null;
    referenceId: string;
  }
): Promise<{
  ok: boolean;
  error?: string;
  inventoryMode: string;
  polywoodLengthM?: number;
  cutDetails?: PolywoodCutResult;
}> {
  const product = await fetchProductById(admin, input.productId);
  if (!product) return { ok: false, error: "Məhsul tapılmadı", inventoryMode: "standard" };

  if (product.inventory_mode === POLYWOOD_INVENTORY_MODE) {
    if (!input.warehouseId) {
      return { ok: false, error: "Polywood üçün anbar seçin", inventoryMode: POLYWOOD_INVENTORY_MODE };
    }
    const mode = input.polywoodMode || "linear_m";
    const cut = await allocatePolywoodForProduction(admin, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      referenceId: input.referenceId,
      mode,
      quantity: input.quantity,
      fullSheetLengthM: Number(product.full_sheet_length_m) || DEFAULT_FULL_SHEET_LENGTH_M,
    });
    if (!cut.ok) {
      return {
        ok: false,
        error: cut.error || "Polywood kəsimi alınmadı",
        inventoryMode: POLYWOOD_INVENTORY_MODE,
      };
    }
    return {
      ok: true,
      inventoryMode: POLYWOOD_INVENTORY_MODE,
      polywoodLengthM: cut.usedLengthM,
      cutDetails: cut.cutResult,
    };
  }

  const result = await decrementStandardStock(admin, input.productId, input.quantity);
  if (!result.ok) return { ok: false, error: result.error, inventoryMode: "standard" };
  return { ok: true, inventoryMode: "standard" };
}
