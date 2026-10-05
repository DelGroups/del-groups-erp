import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import type { PermissionKey } from "@/types/database.types";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export type VoidInvoiceResult = { success: boolean; error?: string };

async function requireAnyPermission(...permissions: PermissionKey[]): Promise<void> {
  let lastError: ActionAuthError | null = null;
  for (const permission of permissions) {
    try {
      await requirePermissionAction(permission);
      return;
    } catch (err) {
      if (err instanceof ActionAuthError) {
        lastError = err;
      } else {
        throw err;
      }
    }
  }
  throw lastError ?? new ActionAuthError("İcazəniz yoxdur");
}

/**
 * Cancels a sales invoice in one database transaction
 * (`cancel_sales_invoice_atomic`): a draft is only marked cancelled; a posted
 * invoice gets its stock, FIFO layers, cash (storno, never deleted) and
 * journals reversed. Cancelling twice is refused.
 */
export async function voidSaleInvoiceDirect(saleId: string): Promise<VoidInvoiceResult> {
  if (!saleId?.trim()) {
    return { success: false, error: "Satış tapılmadı" };
  }

  try {
    await requireAnyPermission("can_delete_sales", "can_edit_sales");
    const client = await createSupabaseServerClient();

    const { error } = await client.rpc("cancel_sales_invoice_atomic", {
      p_sale_id: saleId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Satış fakturası ləğv edilmədi",
    };
  }
}

/**
 * Cancels a purchase invoice in one database transaction
 * (`cancel_purchase_invoice_atomic`). Refused when goods from the purchase
 * have already been sold or used.
 */
export async function voidPurchaseInvoiceDirect(
  purchaseId: string
): Promise<VoidInvoiceResult> {
  if (!purchaseId?.trim()) {
    return { success: false, error: "Alış tapılmadı" };
  }

  try {
    await requireAnyPermission("can_delete_purchases", "can_edit_purchases");
    const client = await createSupabaseServerClient();

    const { error } = await client.rpc("cancel_purchase_invoice_atomic", {
      p_purchase_id: purchaseId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Alış fakturası ləğv edilmədi",
    };
  }
}
