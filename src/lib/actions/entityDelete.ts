"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  voidPurchaseInvoiceDirect,
  voidSaleInvoiceDirect,
} from "@/lib/invoices/voidInvoiceDirect";

export type DeleteActionResult = { success: boolean; error?: string };

export async function voidSaleAction(saleId: string, reason?: string): Promise<DeleteActionResult> {
  return voidSaleInvoiceDirect(saleId, reason);
}

export async function voidPurchaseAction(
  purchaseId: string,
  reason?: string
): Promise<DeleteActionResult> {
  return voidPurchaseInvoiceDirect(purchaseId, reason);
}

/** @deprecated Use voidPurchaseAction — kept for imports during transition */
export async function deletePurchaseAction(
  purchaseId: string,
  reason?: string
): Promise<DeleteActionResult> {
  return voidPurchaseAction(purchaseId, reason);
}

export async function deleteCustomerAction(customerId: string): Promise<DeleteActionResult> {
  if (!customerId?.trim()) return { success: false, error: "Müştəri tapılmadı" };

  const client = await createSupabaseServerClient();
  const { data: customer } = await client
    .from("customers")
    .select("balance, full_name")
    .eq("id", customerId)
    .single();

  if (!customer) return { success: false, error: "Müştəri tapılmadı" };
  if (Number(customer.balance) > 0.001) {
    return { success: false, error: "Açıq borcu olan müştəri silinə bilməz" };
  }

  const { count } = await client
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);

  if ((count ?? 0) > 0) {
    return { success: false, error: "Satış fakturası olan müştəri silinə bilməz" };
  }

  const { error } = await client.from("customers").delete().eq("id", customerId);
  return error ? { success: false, error: error.message } : { success: true };
}

export async function deleteSupplierAction(supplierId: string): Promise<DeleteActionResult> {
  if (!supplierId?.trim()) return { success: false, error: "Təchizatçı tapılmadı" };

  const client = await createSupabaseServerClient();
  const { count } = await client
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId);

  if ((count ?? 0) > 0) {
    return { success: false, error: "Alış fakturası olan təchizatçı silinə bilməz" };
  }

  const { error } = await client.from("suppliers").delete().eq("id", supplierId);
  return error ? { success: false, error: error.message } : { success: true };
}

export async function deleteProductAction(productId: string): Promise<DeleteActionResult> {
  if (!productId?.trim()) return { success: false, error: "Məhsul tapılmadı" };

  const client = await createSupabaseServerClient();
  const { count: saleItemCount } = await client
    .from("sale_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if ((saleItemCount ?? 0) > 0) {
    return { success: false, error: "Satış sətri olan məhsul silinə bilməz" };
  }

  const { count: purchaseItemCount } = await client
    .from("purchase_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  if ((purchaseItemCount ?? 0) > 0) {
    return { success: false, error: "Alış sətri olan məhsul silinə bilməz" };
  }

  const { error } = await client.from("products").delete().eq("id", productId);
  return error ? { success: false, error: error.message } : { success: true };
}

export async function deleteContractAction(contractId: string): Promise<DeleteActionResult> {
  if (!contractId?.trim()) return { success: false, error: "Müqavilə tapılmadı" };

  const client = await createSupabaseServerClient();
  const { count: salesCount } = await client
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);

  if ((salesCount ?? 0) > 0) {
    return { success: false, error: "Satış fakturası bağlı müqavilə silinə bilməz" };
  }

  const { count: purchaseCount } = await client
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);

  if ((purchaseCount ?? 0) > 0) {
    return { success: false, error: "Alış fakturası bağlı müqavilə silinə bilməz" };
  }

  const { error } = await client.from("contracts").delete().eq("id", contractId);
  return error ? { success: false, error: error.message } : { success: true };
}
