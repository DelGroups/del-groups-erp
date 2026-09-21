"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";

export type SupplierOpeningBalanceResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export interface SupplierOpeningBalanceRow {
  id: string;
  code: string;
  name: string;
  balance: number;
  opening_balance: number;
}

export async function fetchSupplierOpeningBalancesAction(): Promise<
  SupplierOpeningBalanceResult<SupplierOpeningBalanceRow[]>
> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("suppliers")
      .select("id, code, full_name, company_name, balance, opening_balance")
      .order("full_name", { ascending: true });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: (data || []).map((row) => ({
        id: row.id as string,
        code: (row.code as string) || "",
        name: (row.company_name as string) || (row.full_name as string) || "",
        balance: Number(row.balance) || 0,
        opening_balance: Number(row.opening_balance) || 0,
      })),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function setSupplierOpeningBalanceAction(
  supplierId: string,
  openingBalance: number
): Promise<SupplierOpeningBalanceResult<{ balance: number }>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("set_supplier_opening_balance_atomic", {
      p_supplier_id: supplierId,
      p_opening_balance: Math.max(0, Number(openingBalance) || 0),
    });
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true, data: { balance: Number(data) || 0 } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
