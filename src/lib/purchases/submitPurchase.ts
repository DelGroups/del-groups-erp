import { supabase } from "@/lib/supabase";
import type { PurchaseInsert, PurchaseLineItem } from "@/types/database.types";
import { purchaseLineItemsToRows, type PurchasePaymentRow } from "@/lib/purchases/helpers";

export interface SubmitPurchasePayload {
  header: PurchaseInsert;
  items: PurchaseLineItem[];
  invoiceNumber: string;
  payments?: PurchasePaymentRow[];
}

export interface SubmitPurchaseResult {
  success: boolean;
  error?: string;
  purchaseId?: string;
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

async function increaseProductStock(
  productId: string,
  quantity: number,
  unitPrice: number
): Promise<{ ok: boolean; error?: string; previous?: number }> {
  const current = await fetchProductStock(productId);
  if (current === null) return { ok: false, error: "Məhsul tapılmadı" };

  const { error } = await supabase
    .from("products")
    .update({ stock: current + quantity, buy_price: unitPrice })
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, previous: current };
}

async function decreaseProductStock(
  productId: string,
  quantity: number,
  previousBuyPrice: number
): Promise<{ ok: boolean; error?: string }> {
  const current = await fetchProductStock(productId);
  if (current === null) return { ok: false, error: "Məhsul tapılmadı" };
  if (current < quantity) {
    return { ok: false, error: `Stok geri qaytarıla bilməz (mövcud: ${current})` };
  }
  const { error } = await supabase
    .from("products")
    .update({ stock: current - quantity, buy_price: previousBuyPrice })
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function deletePurchaseCascade(purchaseId: string): Promise<void> {
  await supabase.from("purchase_items").delete().eq("purchase_id", purchaseId);
  await supabase.from("purchases").delete().eq("id", purchaseId);
}

async function processPurchasePayments(
  payments: PurchasePaymentRow[],
  invoiceNumber: string
): Promise<{ ok: boolean; error?: string }> {
  const validPayments = payments.filter((p) => p.account_id && p.amount > 0);

  for (const pay of validPayments) {
    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .select("id, name, balance")
      .eq("id", pay.account_id)
      .single();

    if (accErr || !account) {
      return { ok: false, error: "Hesab tapılmadı" };
    }

    const noteText = [
      pay.payment_date,
      pay.note.trim() || `Alış fakturası ${invoiceNumber}`,
      account.name,
    ]
      .filter(Boolean)
      .join(" — ");

    const { error: txError } = await supabase.from("transactions").insert([
      {
        account_id: pay.account_id,
        type: "Məxaric",
        amount: pay.amount,
        category: "Alış Ödənişi",
        notes: noteText,
      },
    ]);

    if (txError) return { ok: false, error: txError.message };

    const { error: balErr } = await supabase
      .from("accounts")
      .update({ balance: (Number(account.balance) || 0) - pay.amount })
      .eq("id", pay.account_id);

    if (balErr) return { ok: false, error: balErr.message };
  }

  return { ok: true };
}

async function adjustSupplierBalance(
  supplierId: string,
  delta: number
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("balance")
    .eq("id", supplierId)
    .single();
  if (error || !data) return { ok: false, error: "Təchizatçı tapılmadı" };
  const newBalance = (Number(data.balance) || 0) + delta;
  const { error: updErr } = await supabase
    .from("suppliers")
    .update({ balance: newBalance })
    .eq("id", supplierId);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true };
}

export async function submitPurchase(
  payload: SubmitPurchasePayload
): Promise<SubmitPurchaseResult> {
  const validItems = payload.items.filter((i) => i.product_id && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul tələb olunur" };
  }

  const { data: purchaseRow, error: purchaseError } = await supabase
    .from("purchases")
    .insert([payload.header])
    .select("id")
    .single();

  if (purchaseError || !purchaseRow) {
    return { success: false, error: purchaseError?.message || "Alış qeydə alınmadı" };
  }

  const purchaseId = purchaseRow.id as string;
  const lineRows = purchaseLineItemsToRows(purchaseId, validItems);

  const { error: itemsError } = await supabase.from("purchase_items").insert(lineRows);
  if (itemsError) {
    await deletePurchaseCascade(purchaseId);
    return { success: false, error: itemsError.message };
  }

  const stockRollbacks: {
    productId: string;
    quantity: number;
    previousStock: number;
    previousBuyPrice: number;
  }[] = [];

  for (const item of validItems) {
    const result = await increaseProductStock(
      item.product_id,
      item.quantity,
      item.unit_price
    );
    if (!result.ok) {
      for (const rb of stockRollbacks.reverse()) {
        await supabase
          .from("products")
          .update({ stock: rb.previousStock, buy_price: rb.previousBuyPrice })
          .eq("id", rb.productId);
      }
      await deletePurchaseCascade(purchaseId);
      return { success: false, error: `${item.product_name}: ${result.error}` };
    }
    stockRollbacks.push({
      productId: item.product_id,
      quantity: item.quantity,
      previousStock: result.previous!,
      previousBuyPrice: item.unit_price,
    });
  }

  if (payload.header.debt_amount > 0) {
    const balResult = await adjustSupplierBalance(
      payload.header.supplier_id,
      payload.header.debt_amount
    );
    if (!balResult.ok) {
      for (const rb of stockRollbacks.reverse()) {
        await supabase
          .from("products")
          .update({ stock: rb.previousStock })
          .eq("id", rb.productId);
      }
      await deletePurchaseCascade(purchaseId);
      return { success: false, error: balResult.error };
    }
  }

  if (payload.payments?.length) {
    const payResult = await processPurchasePayments(
      payload.payments,
      payload.invoiceNumber
    );
    if (!payResult.ok) {
      return { success: false, error: payResult.error };
    }
  }

  return { success: true, purchaseId };
}

export async function updatePurchase(
  purchaseId: string,
  payload: SubmitPurchasePayload,
  previousItems: PurchaseLineItem[],
  previousDebt: number,
  previousSupplierId: string
): Promise<SubmitPurchaseResult> {
  const validItems = payload.items.filter((i) => i.product_id && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, error: "Ən azı bir məhsul tələb olunur" };
  }

  for (const item of previousItems) {
    if (!item.product_id || item.quantity <= 0) continue;
    const result = await decreaseProductStock(
      item.product_id,
      item.quantity,
      item.unit_price
    );
    if (!result.ok) {
      return { success: false, error: `${item.product_name} (geri qaytarma): ${result.error}` };
    }
  }

  if (previousDebt > 0 && previousSupplierId) {
    await adjustSupplierBalance(previousSupplierId, -previousDebt);
  }

  for (const item of validItems) {
    const result = await increaseProductStock(
      item.product_id,
      item.quantity,
      item.unit_price
    );
    if (!result.ok) {
      return { success: false, error: `${item.product_name}: ${result.error}` };
    }
  }

  if (payload.header.debt_amount > 0) {
    const balResult = await adjustSupplierBalance(
      payload.header.supplier_id,
      payload.header.debt_amount
    );
    if (!balResult.ok) return { success: false, error: balResult.error };
  }

  const { error: itemsDelErr } = await supabase
    .from("purchase_items")
    .delete()
    .eq("purchase_id", purchaseId);
  if (itemsDelErr) return { success: false, error: itemsDelErr.message };

  const { error: itemsInsErr } = await supabase
    .from("purchase_items")
    .insert(purchaseLineItemsToRows(purchaseId, validItems));
  if (itemsInsErr) return { success: false, error: itemsInsErr.message };

  const { error: updErr } = await supabase
    .from("purchases")
    .update({
      supplier_id: payload.header.supplier_id,
      warehouse_id: payload.header.warehouse_id,
      doc_date: payload.header.doc_date,
      responsible_id: payload.header.responsible_id,
      responsible_name: payload.header.responsible_name,
      total_amount: payload.header.total_amount,
      paid_amount: payload.header.paid_amount,
      debt_amount: payload.header.debt_amount,
      status: payload.header.status,
      notes: payload.header.notes,
    })
    .eq("id", purchaseId);

  if (updErr) return { success: false, error: updErr.message };

  if (payload.payments?.length) {
    const payResult = await processPurchasePayments(
      payload.payments,
      payload.invoiceNumber
    );
    if (!payResult.ok) return { success: false, error: payResult.error };
  }

  return { success: true, purchaseId };
}
