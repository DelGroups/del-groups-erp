"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import type {
  CustomerArCheckResult,
  CustomerArReconcileResult,
} from "@/lib/finance/customerAr";

export type {
  CustomerArCheckResult,
  CustomerArDiscrepancy,
  CustomerArReconcileResult,
} from "@/lib/finance/customerAr";

async function requireArReconcilePermission(): Promise<void> {
  try {
    await requirePermissionAction("can_manage_finance");
    return;
  } catch {
    /* fall through */
  }
  try {
    await requirePermissionAction("can_edit_sales");
    return;
  } catch {
    /* fall through */
  }
  await requirePermissionAction("can_manage_settings");
}

export async function checkCustomerArDiscrepanciesAction(): Promise<CustomerArCheckResult> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("check_customer_ar_discrepancies");

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    const payload = (data ?? {}) as {
      discrepancy_count?: number;
      discrepancies?: CustomerArCheckResult["discrepancies"];
    };

    return {
      success: true,
      discrepancyCount: Number(payload.discrepancy_count) || 0,
      discrepancies: (payload.discrepancies || []).map((row) => ({
        customer_id: String(row.customer_id),
        customer_name: String(row.customer_name || ""),
        stored_balance: Number(row.stored_balance) || 0,
        ledger_balance: Number(row.ledger_balance) || 0,
        delta: Number(row.delta) || 0,
      })),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Müştəri borc yoxlaması alınmadı",
    };
  }
}

export async function reconcileCustomerArBalancesAction(
  customerId?: string | null
): Promise<CustomerArReconcileResult> {
  try {
    await requireArReconcilePermission();
    const client = await createSupabaseServerClient();

    const { data, error } = await client.rpc("reconcile_customer_ar_balances", {
      p_customer_id: customerId || null,
    });

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    const payload = (data ?? {}) as {
      customers_checked?: number;
      customers_adjusted?: number;
    };

    return {
      success: true,
      customersChecked: Number(payload.customers_checked) || 0,
      customersAdjusted: Number(payload.customers_adjusted) || 0,
    };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Müştəri borc uyğunlaşdırması alınmadı",
    };
  }
}
