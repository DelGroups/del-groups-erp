import { mapRpcError } from "@/lib/auth/serverActionAuth";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export type VoidInvoiceResult = { success: boolean; error?: string };

type VoidRpcPayload = {
  already_void?: boolean;
  success?: boolean;
  error?: string;
};

async function runVoidRpc(
  rpcName: "void_sale_atomic" | "void_purchase_atomic",
  documentId: string,
  reason?: string
): Promise<VoidInvoiceResult> {
  if (!documentId?.trim()) {
    return { success: false, error: "Sənəd tapılmadı" };
  }

  try {
    const client = await createSupabaseServerClient();
    const params =
      rpcName === "void_sale_atomic"
        ? { p_sale_id: documentId, p_reason: reason || null }
        : { p_purchase_id: documentId, p_reason: reason || null };

    const { data, error } = await client.rpc(rpcName, params);

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    const payload = (data ?? {}) as VoidRpcPayload;
    if (payload.success === false) {
      return {
        success: false,
        error: String(payload.error || "Sənəd ləğv edilmədi"),
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Sənəd ləğv edilmədi",
    };
  }
}

/** Cancels a sales invoice via `void_sale_atomic` (p_sale_id, p_reason). */
export async function voidSaleInvoiceRpc(
  saleId: string,
  reason?: string
): Promise<VoidInvoiceResult> {
  return runVoidRpc("void_sale_atomic", saleId, reason);
}

/** Cancels a purchase invoice via `void_purchase_atomic` (p_purchase_id, p_reason). */
export async function voidPurchaseInvoiceRpc(
  purchaseId: string,
  reason?: string
): Promise<VoidInvoiceResult> {
  return runVoidRpc("void_purchase_atomic", purchaseId, reason);
}
