"use server";

import { ActionAuthError, mapRpcError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isAdminRole } from "@/types/database.types";
import { AUTO_FIX_KINDS, isStockIssueKind, type StockIssue, type StockIssueKind } from "../lib/stockIntegrity";

export type StockIntegrityResult<T = void> = { success: true; data?: T } | { success: false; error: string };

/** stock_integrity_* are newer than the generated Database types. */
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** Settings > Stock integrity is for admins only (the RPCs check it again). */
async function requireAdmin() {
  const ctx = await requirePermissionAction("can_manage_settings");
  if (!isAdminRole(ctx.profile?.role)) throw new ActionAuthError("İcazəniz yoxdur");
  return ctx;
}

function fail(err: unknown): { success: false; error: string } {
  if (err instanceof ActionAuthError) return { success: false, error: err.message };
  return { success: false, error: err instanceof Error ? mapRpcError(err.message) : "Failed" };
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Every issue of supabase/scripts/product_integrity_check.sql, one row per product and issue. */
export async function fetchStockIntegrityAction(): Promise<StockIntegrityResult<StockIssue[]>> {
  try {
    await requireAdmin();
    const client = (await createSupabaseAdminClient()) as unknown as RpcClient;
    const { data, error } = await client.rpc("stock_integrity_report");
    if (error) return { success: false, error: mapRpcError(error.message) };
    const rows = ((data as Record<string, unknown>[]) || []).filter((row) => isStockIssueKind(row.issue));
    return {
      success: true,
      data: rows.map((row) => ({
        issue: row.issue as StockIssueKind,
        product_id: row.product_id as string,
        product_code: (row.product_code as string) || null,
        product_name: (row.product_name as string) || "",
        details: (row.details as string) || "",
        fixable: Boolean(row.fixable),
        stock_before: numOrNull(row.stock_before),
        stock_after: numOrNull(row.stock_after),
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

/** Fixes one safe kind, for the given products or (null) every product with it. */
export async function fixStockIntegrityAction(
  issue: StockIssueKind,
  productIds: string[] | null
): Promise<StockIntegrityResult<{ fixed: number }>> {
  try {
    const { user } = await requireAdmin();
    if (!isStockIssueKind(issue) || !AUTO_FIX_KINDS.includes(issue)) {
      return { success: false, error: "stockIntegrity.notAutoFixable" };
    }
    if (productIds && (productIds.length === 0 || !productIds.every(isValidUuid))) {
      return { success: false, error: "stockIntegrity.notAutoFixable" };
    }
    const client = (await createSupabaseAdminClient()) as unknown as RpcClient;
    const { data, error } = await client.rpc("stock_integrity_fix", {
      p_issue: issue,
      p_product_ids: productIds,
      p_actor: user.id,
    });
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true, data: { fixed: Number((data as { fixed?: number } | null)?.fixed) || 0 } };
  } catch (err) {
    return fail(err);
  }
}
