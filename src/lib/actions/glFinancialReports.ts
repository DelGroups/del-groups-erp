"use server";

import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  mapBalanceSheet,
  mapGeneralLedger,
  mapPlSummary,
  type GlFinancialReportsData,
  type GlFinancialReportsQuery,
} from "@/lib/reports/glFinancialReports";
import { fetchGlAccounts } from "@/lib/accounting";

export type GlFinancialReportsActionResult =
  | { success: true; data: GlFinancialReportsData }
  | { success: false; error: string };

export type GlAccountOption = {
  id: string;
  code: string;
  name: string;
};

export async function fetchGlFinancialReportsAction(
  query: GlFinancialReportsQuery
): Promise<GlFinancialReportsActionResult> {
  try {
    await requirePermissionAction("can_view_financial_reports");

    if (!query.startDate || !query.endDate) {
      return { success: false, error: "Tarix aralığı tələb olunur" };
    }

    const admin = createSupabaseAdminClient();
    const limit = Math.min(Math.max(query.ledgerLimit ?? 50, 1), 200);
    const offset = Math.max(query.ledgerOffset ?? 0, 0);

    const [plResult, balanceResult, ledgerResult] = await Promise.all([
      admin.rpc("get_gl_pl_summary", {
        p_start_date: query.startDate,
        p_end_date: query.endDate,
      }),
      admin.rpc("get_gl_balance_sheet", {
        p_as_of_date: query.endDate,
      }),
      admin.rpc("get_gl_general_ledger", {
        p_start_date: query.startDate,
        p_end_date: query.endDate,
        p_account_id: query.accountId || null,
        p_partner_id: query.partnerId || null,
        p_limit: limit,
        p_offset: offset,
      }),
    ]);

    if (plResult.error) return { success: false, error: plResult.error.message };
    if (balanceResult.error) return { success: false, error: balanceResult.error.message };
    if (ledgerResult.error) return { success: false, error: ledgerResult.error.message };

    return {
      success: true,
      data: {
        profitAndLoss: mapPlSummary(plResult.data),
        balanceSheet: mapBalanceSheet(balanceResult.data),
        generalLedger: mapGeneralLedger(ledgerResult.data),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return {
      success: false,
      error: err instanceof Error ? err.message : "Maliyyə hesabatı yüklənmədi",
    };
  }
}

export async function fetchGlReportFilterOptionsAction(): Promise<{
  success: boolean;
  accounts: GlAccountOption[];
  partners: Array<{ id: string; name: string }>;
  error?: string;
}> {
  try {
    await requirePermissionAction("can_view_financial_reports");
    const admin = createSupabaseAdminClient();

    const accounts = await fetchGlAccounts({ useAdmin: true });

    const { data: partners, error } = await admin
      .from("partners")
      .select("id, name, full_name, company_name")
      .eq("is_deleted", false)
      .order("name", { ascending: true })
      .limit(500);

    if (error) {
      return { success: false, accounts: [], partners: [], error: error.message };
    }

    return {
      success: true,
      accounts: accounts.map((row) => ({ id: row.id, code: row.code, name: row.name })),
      partners: (partners || []).map((row) => ({
        id: String(row.id),
        name: String(row.full_name || row.company_name || row.name || row.id),
      })),
    };
  } catch (err) {
    return {
      success: false,
      accounts: [],
      partners: [],
      error: err instanceof Error ? err.message : "Filter seçimləri yüklənmədi",
    };
  }
}
