import { ActionAuthError, mapRpcError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { isAccountingGuardEnabled } from "@/lib/features/accountingGuard";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { isAdminRole } from "@/types/database.types";

/**
 * Shared by the server actions of the Accounting Guard (GUARD-2 and GUARD-3): who may call them
 * and the database client they use. Admin only and only with ACCOUNTING_GUARD=true. The calls run
 * with the admin's own session (not the service role), so the database knows who scanned and who
 * decided: the guard functions check user_is_admin() again, and the guard tables are readable by
 * admins only (RLS). The guard only reads business data and writes its own tables.
 */

export type GuardActionResult<T> = { success: true; data: T } | { success: false; error: string };

export type GuardQuery = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  in: (column: string, values: unknown[]) => GuardQuery;
  eq: (column: string, value: unknown) => GuardQuery;
  order: (column: string, options?: { ascending?: boolean }) => GuardQuery;
  limit: (count: number) => GuardQuery;
  maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type GuardDb = {
  from: (table: string) => { select: (columns: string) => GuardQuery };
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** The signed-in admin when the flag is on; otherwise it throws an ActionAuthError with an i18n key. */
export async function requireGuardAdmin() {
  if (!isAccountingGuardEnabled()) throw new ActionAuthError("accountingGuard.errors.disabled");
  const ctx = await requirePermissionAction("can_manage_settings");
  if (!isAdminRole(ctx.profile?.role)) throw new ActionAuthError("accountingGuard.errors.adminOnly");
  return ctx;
}

/**
 * What a database error of a guard function means to a person: an i18n key for the ones we raise on
 * purpose (validation of a threshold, a missing reason, a finding that is gone), else the usual mapping.
 */
export function guardMessage(message: string): string {
  if (/invalid_param|unknown_param/.test(message)) return "guard.errors.invalidParam";
  if (/note_required/.test(message)) return "guard.errors.reasonRequired";
  if (/too_many_findings/.test(message)) return "guard.errors.tooMany";
  if (/rule_not_found|finding_not_found/.test(message)) return "guard.errors.notFound";
  if (/title_required/.test(message)) return "guard.errors.titleRequired";
  if (/invalid_schedule/.test(message)) return "guard.errors.invalidSchedule";
  if (/invalid_memory|invalid_suggestion/.test(message)) return "guard.errors.invalidMemory";
  if (/memory_full/.test(message)) return "guard.errors.memoryFull";
  if (/invalid_severity|invalid_status|invalid_kind|invalid_what|invalid_summary/.test(message)) return "guard.errors.invalidInput";
  return mapRpcError(message);
}

export function guardFail(err: unknown): { success: false; error: string } {
  if (err instanceof ActionAuthError) return { success: false, error: err.message };
  return { success: false, error: err instanceof Error ? guardMessage(err.message) : "Failed" };
}

export async function guardDb(): Promise<GuardDb> {
  return (await createSupabaseServerClient()) as unknown as GuardDb;
}

export function guardRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
