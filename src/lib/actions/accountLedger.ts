"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import type { ReconcileAccountBalancesResult } from "@/lib/finance/accountLedger";

export type { ReconcileAccountBalancesResult } from "@/lib/finance/accountLedger";

export async function reconcileAccountBalancesAction(
  accountId?: string | null
): Promise<ReconcileAccountBalancesResult> {
  try {
    await requirePermissionAction("can_manage_finance");
    const client = await createSupabaseServerClient();

    const { data, error } = await client.rpc("reconcile_account_balance_atomic", {
      p_account_id: accountId || null,
    });

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    const payload = (data ?? {}) as {
      accounts_checked?: number;
      accounts_adjusted?: number;
      results?: ReconcileAccountBalancesResult["results"];
    };

    return {
      success: true,
      accountsChecked: Number(payload.accounts_checked) || 0,
      accountsAdjusted: Number(payload.accounts_adjusted) || 0,
      results: payload.results || [],
    };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Balans uyğunlaşdırması alınmadı",
    };
  }
}
