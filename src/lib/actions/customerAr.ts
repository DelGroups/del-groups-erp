"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import type {
  CustomerArCheckResult,
  CustomerArReconcileResult,
} from "@/lib/finance/customerAr";

export type CustomerOpeningBalanceResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export interface CustomerOpeningBalanceRow {
  id: string;
  code: string;
  name: string;
  balance: number;
  opening_balance: number;
}

export async function fetchCustomerOpeningBalancesAction(): Promise<
  CustomerOpeningBalanceResult<CustomerOpeningBalanceRow[]>
> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("customers")
      .select("id, code, full_name, balance, opening_balance")
      .order("full_name", { ascending: true });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: (data || []).map((row) => ({
        id: row.id as string,
        code: (row.code as string) || "",
        name: (row.full_name as string) || "",
        balance: Number(row.balance) || 0,
        opening_balance: Number(row.opening_balance) || 0,
      })),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function setCustomerOpeningBalanceAction(
  customerId: string,
  openingBalance: number
): Promise<CustomerOpeningBalanceResult<{ balance: number }>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("set_customer_opening_balance_atomic", {
      p_customer_id: customerId,
      p_opening_balance: Math.max(0, Number(openingBalance) || 0),
    });
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true, data: { balance: Number(data) || 0 } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

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
