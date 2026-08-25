import { supabase } from "@/lib/supabase";
import { recordSaleCommissions } from "@/lib/commissions/recordSaleCommissions";
import type {
  SaleInsert,
  SaleItem,
  SalePayment,
  SaleTotals,
} from "@/types/database.types";
import { saleLineItemsToRows, toSalePaymentsJson } from "@/types/database.types";

export interface SubmitSalePayload {
  header: SaleInsert;
  items: SaleItem[];
  payments: SalePayment[];
  totals: SaleTotals;
  docNo: string;
  decrementStock?: boolean;
}

export interface SubmitSaleResult {
  success: boolean;
  error?: string;
  saleId?: string;
}

async function fetchProductStock(productId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("products")
    .select("stock")
    .eq("id", productId)
    .single();
  if (error || !data) return null;
  return Number(data.stock) || 0;
}

async function decrementStock(productId: string, quantity: number): Promise<{ ok: boolean; error?: string; previous?: number }> {
  const current = await fetchProductStock(productId);
  if (current === null) return { ok: false, error: "Məhsul tapılmadı" };
  if (current < quantity) {
    return { ok: false, error: `Stok kifayət etmir (mövcud: ${current})` };
  }
  const { error } = await supabase
    .from("products")
    .update({ stock: current - quantity })
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, previous: current };
}

async function restoreStock(productId: string, previous: number): Promise<void> {
  await supabase.from("products").update({ stock: previous }).eq("id", productId);
}

async function deleteSaleCascade(saleId: string): Promise<void> {
  await supabase.from("sale_items").delete().eq("sale_id", saleId);
  await supabase.from("sales").delete().eq("id", saleId);
}

export async function submitSale(payload: SubmitSalePayload): Promise<SubmitSaleResult> {
  const validItems = payload.items.filter((i) => i.product_id || i.product_name.trim());
  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul tələb olunur" };
  }

  const header: SaleInsert = {
    ...payload.header,
    payments: toSalePaymentsJson(payload.payments),
  };

  const { data: saleRow, error: saleError } = await supabase
    .from("sales")
    .insert([header])
    .select("id")
    .single();

  if (saleError || !saleRow) {
    return { success: false, error: saleError?.message || "Satış qeydə alınmadı" };
  }

  const saleId = saleRow.id as string;
  const lineRows = saleLineItemsToRows(saleId, validItems);

  const { error: itemsError } = await supabase.from("sale_items").insert(lineRows);
  if (itemsError) {
    await deleteSaleCascade(saleId);
    return { success: false, error: itemsError.message };
  }

  const stockRollbacks: { productId: string; previous: number }[] = [];

  if (payload.decrementStock !== false) {
    for (const item of validItems) {
      if (!item.product_id || item.quantity <= 0) continue;
      const result = await decrementStock(item.product_id, item.quantity);
      if (!result.ok) {
        for (const rb of stockRollbacks.reverse()) {
          await restoreStock(rb.productId, rb.previous);
        }
        await deleteSaleCascade(saleId);
        return {
          success: false,
          error: `${item.product_name}: ${result.error}`,
        };
      }
      stockRollbacks.push({ productId: item.product_id, previous: result.previous! });
    }
  }

  for (const pay of payload.payments) {
    if (!pay.amount || pay.amount <= 0) continue;
    const { error: txError } = await supabase.from("transactions").insert([
      {
        account_id: pay.account_id || null,
        type: "Mədaxil",
        amount: pay.amount,
        category: "Satış Ödənişi",
        notes: `Satış fakturası ${payload.docNo} — ${pay.method}`,
      },
    ]);
    if (txError) {
      for (const rb of stockRollbacks.reverse()) {
        await restoreStock(rb.productId, rb.previous);
      }
      await deleteSaleCascade(saleId);
      return { success: false, error: txError.message };
    }
  }

  await recordSaleCommissions(
    saleId,
    payload.docNo,
    payload.header.seller_id,
    payload.header.seller_name,
    validItems
  );

  return { success: true, saleId };
}
