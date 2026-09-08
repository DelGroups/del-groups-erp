/** Untyped admin client — stock_movements may not be in generated Database yet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (table: string) => any };

export interface StockMovementInput {
  productId: string;
  warehouseId?: string | null;
  movementType: "in" | "out";
  quantity: number;
  unit?: string | null;
  referenceType: string;
  referenceId?: string | null;
  sourceLineId?: string | null;
  description?: string | null;
  createdBy?: string | null;
}

function isMissingStockMovementsTable(error?: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = (error.message || "").toLowerCase();
  return message.includes("stock_movements") && message.includes("does not exist");
}

export async function recordStockMovement(
  admin: DbClient,
  input: StockMovementInput
): Promise<void> {
  const quantity = Number(input.quantity);
  if (!input.productId || !Number.isFinite(quantity) || quantity <= 0) return;

  const { error } = await admin.from("stock_movements").insert([
    {
      product_id: input.productId,
      warehouse_id: input.warehouseId || null,
      movement_type: input.movementType,
      quantity,
      unit: input.unit || "Ədəd",
      reference_type: input.referenceType,
      reference_id: input.referenceId || null,
      source_line_id: input.sourceLineId || null,
      description: input.description || null,
      created_by: input.createdBy || null,
    },
  ]);

  if (error && !isMissingStockMovementsTable(error)) {
    throw new Error(error.message);
  }
}
