"use server";

import { ActionAuthError, mapRpcError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { isAccountingGuardEnabled } from "@/lib/features/accountingGuard";
import { NAME_OPEN_STATUSES, NAME_RULES, normalizeReason, openNameFindings, type NameFinding } from "@/lib/guard/nameFindings";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { isAdminRole } from "@/types/database.types";

/**
 * GUARD-2: server actions of the "Find duplicate or wrong names" drawer. Admin only and only with
 * ACCOUNTING_GUARD=true. The calls run with the admin's own session (not the service role), so the
 * database knows who scanned and who decided: guard_scan and guard_set_finding_status check
 * user_is_admin() again, and the guard tables are readable by admins only (RLS).
 * The guard only reads business data; "Not a duplicate" changes the finding, never a product.
 */

export type GuardActionResult<T> = { success: true; data: T } | { success: false; error: string };

type Q = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  in: (column: string, values: unknown[]) => Q;
  eq: (column: string, value: unknown) => Q;
  order: (column: string, options?: { ascending?: boolean }) => Q;
  limit: (count: number) => Q;
  maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
type Db = {
  from: (table: string) => { select: (columns: string) => Q };
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** The most findings one drawer lists; more means "narrow it in the Accounting Guard". */
const NAME_FINDINGS_LIMIT = 500;

async function requireGuardAdmin() {
  if (!isAccountingGuardEnabled()) throw new ActionAuthError("accountingGuard.errors.disabled");
  const ctx = await requirePermissionAction("can_manage_settings");
  if (!isAdminRole(ctx.profile?.role)) throw new ActionAuthError("accountingGuard.errors.adminOnly");
  return ctx;
}

function fail(err: unknown): { success: false; error: string } {
  if (err instanceof ActionAuthError) return { success: false, error: err.message };
  return { success: false, error: err instanceof Error ? mapRpcError(err.message) : "Failed" };
}

async function userDb(): Promise<Db> {
  return (await createSupabaseServerClient()) as unknown as Db;
}

export interface ProductNameScan {
  runId: string;
  /** ok, or partial when a rule failed (see failedRules). */
  status: string;
  failedRules: string[];
  findings: NameFinding[];
  /** True when there were more findings than the drawer lists. */
  truncated: boolean;
}

/**
 * The button: guard_scan(['products']) (F1-F5), then the open findings of the name rules
 * (F1 same name, F2 similar name, F3 name or code that looks wrong, F5 duplicate code or barcode).
 */
export async function scanProductNamesAction(): Promise<GuardActionResult<ProductNameScan>> {
  try {
    await requireGuardAdmin();
    const db = await userDb();
    const { data: runId, error } = await db.rpc("guard_scan", { p_scope: ["products"], p_trigger: "button" });
    if (error) return { success: false, error: mapRpcError(error.message) };
    if (typeof runId !== "string" || !isValidUuid(runId)) return { success: false, error: "Failed" };

    const [run, found] = await Promise.all([
      db.from("guard_runs").select("id, status, rule_errors").eq("id", runId).maybeSingle(),
      db
        .from("guard_findings")
        .select("id, rule_code, severity, status, note, details")
        .in("rule_code", [...NAME_RULES])
        .in("status", [...NAME_OPEN_STATUSES])
        .order("first_seen_at", { ascending: false })
        .limit(NAME_FINDINGS_LIMIT),
    ]);
    if (found.error) return { success: false, error: mapRpcError(found.error.message) };
    const rows = Array.isArray(found.data) ? (found.data as Record<string, unknown>[]) : [];
    const runRow = (run.data ?? {}) as { status?: string; rule_errors?: Record<string, unknown> | null };
    return {
      success: true,
      data: {
        runId,
        status: typeof runRow.status === "string" ? runRow.status : "ok",
        failedRules: Object.keys(runRow.rule_errors ?? {}).filter((code) => (NAME_RULES as readonly string[]).includes(code) || code === "F4"),
        findings: openNameFindings(rows),
        truncated: rows.length >= NAME_FINDINGS_LIMIT,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * "Not a duplicate": the finding becomes false_positive with the reason (required, at least three
 * characters). It stays closed until the group changes (a product joins or leaves it).
 */
export async function markNotDuplicateAction(findingId: string, reason: string): Promise<GuardActionResult<{ id: string }>> {
  try {
    await requireGuardAdmin();
    if (!isValidUuid(findingId)) return { success: false, error: "accountingGuard.errors.invalidFinding" };
    const note = normalizeReason(reason);
    if (!note) return { success: false, error: "accountingGuard.names.reasonRequired" };
    const db = await userDb();
    const { error } = await db.rpc("guard_set_finding_status", { p_id: findingId, p_status: "false_positive", p_note: note });
    if (error) return { success: false, error: mapRpcError(error.message) };
    return { success: true, data: { id: findingId } };
  } catch (err) {
    return fail(err);
  }
}
