"use server";

import { voidSaleInvoice } from "@/lib/finance/customerAr";
import { supabase } from "@/lib/supabase";

export type DeleteActionResult = { success: boolean; error?: string };

export async function voidSaleAction(saleId: string, reason?: string): Promise<DeleteActionResult> {
  if (!saleId?.trim()) return { success: false, error: "Satış tapılmadı" };
  const result = await voidSaleInvoice(saleId, reason);
  return { success: result.success, error: result.error };
}

export async function deletePurchaseAction(purchaseId: string): Promise<DeleteActionResult> {
  if (!purchaseId?.trim()) return { success: false, error: "Alış tapılmadı" };

  const { data: purchase, error: fetchError } = await supabase
    .from("purchases")
    .select("id, paid_amount, invoice_number")
    .eq("id", purchaseId)
    .single();

  if (fetchError || !purchase) {
    return { success: false, error: fetchError?.message || "Alış tapılmadı" };
  }

  if (Number(purchase.paid_amount) > 0.001) {
    return {
      success: false,
      error: "Ödəniş edilmiş alış fakturası silinə bilməz. Əvvəlcə ödənişləri geri qaytarın.",
    };
  }

  const { data: items, error: itemsError } = await supabase
    .from("purchase_items")
    .select("product_id, quantity")
    .eq("purchase_id", purchaseId);

  if (itemsError) {
    return { success: false, error: itemsError.message };
  }

  for (const item of items || []) {
    if (!item.product_id) continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    const { data: product } = await supabase
      .from("products")
      .select("stock")
      .eq("id", item.product_id)
      .single();

    if (!product) continue;
    const nextStock = Math.max(0, (Number(product.stock) || 0) - qty);
    const { error: stockError } = await supabase
      .from("products")
      .update({ stock: nextStock })
      .eq("id", item.product_id);

    if (stockError) {
      return { success: false, error: stockError.message };
    }
  }

  const { error: deleteItemsError } = await supabase
    .from("purchase_items")
    .delete()
    .eq("purchase_id", purchaseId);

  if (deleteItemsError) {
    return { success: false, error: deleteItemsError.message };
  }

  const { error: deleteError } = await supabase.from("purchases").delete().eq("id", purchaseId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  return { success: true };
}

export async function deleteCustomerAction(customerId: string): Promise<DeleteActionResult> {
  if (!customerId?.trim()) return { success: false, error: "Müştəri tapılmadı" };

  const { data: customer } = await supabase
    .from("customers")
    .select("balance, full_name")
    .eq("id", customerId)
    .single();

  if (!customer) return { success: false, error: "Müştəri tapılmadı" };
  if (Number(customer.balance) > 0.001) {
    return { success: false, error: "Açıq borcu olan müştəri silinə bilməz" };
  }

  const { count } = await supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);

  if ((count ?? 0) > 0) {
    return { success: false, error: "Satış fakturası olan müştəri silinə bilməz" };
  }

  const { error } = await supabase.from("customers").delete().eq("id", customerId);
  return error ? { success: false, error: error.message } : { success: true };
}

export async function deleteSupplierAction(supplierId: string): Promise<DeleteActionResult> {
  if (!supplierId?.trim()) return { success: false, error: "Təchizatçı tapılmadı" };

  const { count } = await supabase
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId);

  if ((count ?? 0) > 0) {
    return { success: false, error: "Alış fakturası olan təchizatçı silinə bilməz" };
  }

  const { error } = await supabase.from("suppliers").delete().eq("id", supplierId);
  return error ? { success: false, error: error.message } : { success: true };
}

export async function deleteProductAction(productId: string): Promise<DeleteActionResult> {
  if (!productId?.trim()) return { success: false, error: "Məhsul tapılmadı" };

  const { count: saleItemCount } = await supabase
    .from("sale_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if ((saleItemCount ?? 0) > 0) {
    return { success: false, error: "Satış sətri olan məhsul silinə bilməz" };
  }

  const { count: purchaseItemCount } = await supabase
    .from("purchase_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if ((purchaseItemCount ?? 0) > 0) {
    return { success: false, error: "Alış sətri olan məhsul silinə bilməz" };
  }

  const { error } = await supabase.from("products").delete().eq("id", productId);
  return error ? { success: false, error: error.message } : { success: true };
}

export async function deleteContractAction(contractId: string): Promise<DeleteActionResult> {
  if (!contractId?.trim()) return { success: false, error: "Müqavilə tapılmadı" };

  const { count: salesCount } = await supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);

  if ((salesCount ?? 0) > 0) {
    return { success: false, error: "Satış fakturası bağlı müqavilə silinə bilməz" };
  }

  const { count: purchaseCount } = await supabase
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);

  if ((purchaseCount ?? 0) > 0) {
    return { success: false, error: "Alış fakturası bağlı müqavilə silinə bilməz" };
  }

  const { error } = await supabase.from("contracts").delete().eq("id", contractId);
  return error ? { success: false, error: error.message } : { success: true };
}
