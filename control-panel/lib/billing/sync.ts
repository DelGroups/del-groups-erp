/**
 * Copies a tenant's subscription into its own database (prompt 12): which modules are on
 * (public.tenant_modules) and the plan limits (public.tenant_limits). Runs after every
 * subscription save in the panel and daily in the usage job.
 *
 * The values come from public.tenant_entitlements() in the control plane, so the panel, the
 * ERP's /api/users check and the tenant's own trigger all use the same numbers. Without a
 * live subscription the limits row is removed (no limits) and the modules are left as they
 * are: a cancelled tenant is handled by its status, not by switching modules off.
 */
import { tenantModulesSql } from "../provisioning/plan.ts";
import { redactSecrets, type ManagementApi } from "../provisioning/managementApi.ts";

export interface EntitlementRow {
  subscription_id: string;
  status: string;
  seat_limit: number;
  storage_limit_bytes: number | string | null;
  ai_limit_usd: number | string | null;
  custom_domain: boolean;
  modules: string[];
}

const int = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`not a whole number: ${String(v)}`);
  return String(n);
};
const money = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`not an amount: ${String(v)}`);
  return n.toFixed(2);
};

/** SQL for the tenant database: limits row from the entitlements, or no row. Values are validated numbers. */
export function tenantLimitsSql(e: EntitlementRow | null): string {
  // No subscription: no limits. Guarded, so a tenant without the ERP migration is not an error.
  if (!e) return "do $$ begin if to_regclass('public.tenant_limits') is not null then delete from public.tenant_limits; end if; end $$;";
  const storage = e.storage_limit_bytes === null ? "null" : int(e.storage_limit_bytes);
  const ai = e.ai_limit_usd === null ? "null" : money(e.ai_limit_usd);
  return [
    "insert into public.tenant_limits (id, max_users, storage_limit_bytes, ai_monthly_limit_usd, synced_at, updated_at)",
    `values (true, ${int(e.seat_limit)}, ${storage}, ${ai}, now(), now())`,
    "on conflict (id) do update set max_users = excluded.max_users, storage_limit_bytes = excluded.storage_limit_bytes,",
    "  ai_monthly_limit_usd = excluded.ai_monthly_limit_usd, synced_at = now(), updated_at = now();",
  ].join("\n");
}

/** The whole sync as one statement batch (runs in one transaction through the Management API). */
export function tenantSyncSql(e: EntitlementRow | null, allModules: readonly string[]): string {
  const parts = ["begin;"];
  if (e) parts.push(tenantModulesSql(allModules, e.modules));
  parts.push(tenantLimitsSql(e), "commit;");
  return parts.join("\n");
}

export interface SyncStore {
  entitlements(tenantId: string): Promise<EntitlementRow | null>;
  allModules(): Promise<string[]>;
  projectRef(tenantId: string): Promise<string | null>;
  recordSync(subscriptionId: string, result: { status: "synced" | "failed"; error: string | null }): Promise<void>;
}

export type SyncOutcome =
  | { status: "synced"; modules: string[] | null; seatLimit: number | null }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: "no_database" };

export async function syncTenant(
  deps: { store: SyncStore; api: ManagementApi; secrets: string[] },
  tenantId: string
): Promise<SyncOutcome> {
  const ref = await deps.store.projectRef(tenantId);
  if (!ref) return { status: "skipped", reason: "no_database" };
  const e = await deps.store.entitlements(tenantId);
  try {
    await deps.api.runQuery(ref, tenantSyncSql(e, await deps.store.allModules()));
    if (e) await deps.store.recordSync(e.subscription_id, { status: "synced", error: null });
    return { status: "synced", modules: e?.modules ?? null, seatLimit: e?.seat_limit ?? null };
  } catch (error) {
    let message = redactSecrets(error instanceof Error ? error.message : String(error), deps.secrets);
    if (/tenant_limits/.test(message) && /does not exist/.test(message)) {
      message = `the tenant database lacks migration 20261014100000_tenant_limits; run the tenant-migrations workflow first (${message})`;
    }
    if (e) await deps.store.recordSync(e.subscription_id, { status: "failed", error: message.slice(0, 1000) });
    return { status: "failed", error: message };
  }
}
