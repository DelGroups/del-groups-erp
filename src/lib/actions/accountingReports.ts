"use server";

import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { mapInventoryTurnover, type InventoryTurnoverReport } from "@/lib/reports/inventoryTurnover";
import { mapPartnerReconciliation, type PartnerReconciliationReport } from "@/lib/reports/partnerReconciliation";
import { mapTrialBalance, type TrialBalanceReport } from "@/lib/reports/trialBalance";

export type ReportActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function fetchTrialBalanceAction(
  startDate: string,
  endDate: string
): Promise<ReportActionResult<TrialBalanceReport>> {
  try {
    await requirePermissionAction("can_view_financial_reports");
    if (!startDate || !endDate) {
      return { success: false, error: "Tarix aralığı tələb olunur" };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("get_gl_trial_balance", {
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: mapTrialBalance(data) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return {
      success: false,
      error: err instanceof Error ? err.message : "OSV hesabatı yüklənmədi",
    };
  }
}

export async function fetchPartnerReconciliationAction(
  partnerId: string,
  startDate: string,
  endDate: string
): Promise<ReportActionResult<PartnerReconciliationReport>> {
  try {
    await requirePermissionAction("can_view_financial_reports");
    if (!partnerId) return { success: false, error: "Tərəfdaş seçilməlidir" };
    if (!startDate || !endDate) {
      return { success: false, error: "Tarix aralığı tələb olunur" };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("get_partner_reconciliation_act", {
      p_partner_id: partnerId,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: mapPartnerReconciliation(data) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return {
      success: false,
      error: err instanceof Error ? err.message : "Üzləşmə aktı yüklənmədi",
    };
  }
}

export async function fetchInventoryTurnoverAction(
  startDate: string,
  endDate: string,
  categoryId?: string | null
): Promise<ReportActionResult<InventoryTurnoverReport>> {
  try {
    await requirePermissionAction("can_view_reports");
    if (!startDate || !endDate) {
      return { success: false, error: "Tarix aralığı tələb olunur" };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("get_inventory_turnover_report", {
      p_start_date: startDate,
      p_end_date: endDate,
      p_category_id: categoryId || null,
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data: mapInventoryTurnover(data) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return {
      success: false,
      error: err instanceof Error ? err.message : "Anbar dövriyyə hesabatı yüklənmədi",
    };
  }
}
