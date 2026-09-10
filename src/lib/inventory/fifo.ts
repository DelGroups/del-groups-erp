import { supabase } from "@/lib/supabase";

export type InventoryBatch = {
  id: string;
  product_id: string;
  document_id: string | null;
  document_type: string;
  unit_cost: number;
  initial_qty: number;
  remaining_qty: number;
  created_at: string;
};

export type InventoryBatchConsumption = {
  id: string;
  sale_id: string;
  sale_item_id: string | null;
  batch_id: string | null;
  product_id: string;
  quantity: number;
  unit_cost: number;
  cogs_amount: number;
};

export type SaleProfitability = {
  revenue: number;
  totalCogs: number;
  grossProfit: number;
  marginPercent: number;
};

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Read profitability metrics for a sale (COGS computed at posting time in PostgreSQL). */
export async function fetchSaleProfitability(saleId: string): Promise<SaleProfitability | null> {
  const { data, error } = await supabase
    .from("sales")
    .select("total_amount, total_cogs")
    .eq("id", saleId)
    .maybeSingle();

  if (error || !data) {
    console.error("[fifo] profitability", error?.message || "not found");
    return null;
  }

  const revenue = toAmount(data.total_amount);
  const totalCogs = toAmount(data.total_cogs);
  const grossProfit = revenue - totalCogs;
  const marginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

  return {
    revenue,
    totalCogs,
    grossProfit,
    marginPercent,
  };
}

/** Load FIFO batch consumption audit rows for a sale. */
export async function fetchSaleBatchConsumptions(
  saleId: string
): Promise<InventoryBatchConsumption[]> {
  const { data, error } = await supabase
    .from("inventory_batch_consumptions")
    .select("id, sale_id, sale_item_id, batch_id, product_id, quantity, unit_cost, cogs_amount")
    .eq("sale_id", saleId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[fifo] consumptions", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    sale_id: String(row.sale_id),
    sale_item_id: typeof row.sale_item_id === "string" ? row.sale_item_id : null,
    batch_id: typeof row.batch_id === "string" ? row.batch_id : null,
    product_id: String(row.product_id),
    quantity: toAmount(row.quantity),
    unit_cost: toAmount(row.unit_cost),
    cogs_amount: toAmount(row.cogs_amount),
  }));
}

/** List open FIFO batches for a product (oldest first). */
export async function fetchProductInventoryBatches(
  productId: string
): Promise<InventoryBatch[]> {
  const { data, error } = await supabase
    .from("inventory_batches")
    .select("id, product_id, document_id, document_type, unit_cost, initial_qty, remaining_qty, created_at")
    .eq("product_id", productId)
    .gt("remaining_qty", 0)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[fifo] batches", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    product_id: String(row.product_id),
    document_id: typeof row.document_id === "string" ? row.document_id : null,
    document_type: String(row.document_type || "purchase"),
    unit_cost: toAmount(row.unit_cost),
    initial_qty: toAmount(row.initial_qty),
    remaining_qty: toAmount(row.remaining_qty),
    created_at: String(row.created_at || ""),
  }));
}
