/**
 * --local stand-ins for the subscription sync and the usage job (prompt 12): the control
 * plane and the tenant databases are local Postgres databases reached with psql.
 * Tenant databases are keyed by slug (TENANT_DATABASE_URLS), so here a tenant's "project
 * ref" is its slug.
 */
import type { TenantTarget } from "../../control-panel/lib/migrations/plan.ts";
import type { EntitlementRow, SyncStore } from "../../control-panel/lib/billing/sync.ts";
import type { TenantUsage } from "../../control-panel/lib/billing/usage.ts";
import { psql } from "./local.ts";

export function localBilling(controlPlaneUrl: string, urls: Record<string, string>) {
  const tenantUrl = (key: string) => {
    const u = urls[key];
    if (!u) throw new Error(`no database URL for ${key} in TENANT_DATABASE_URLS`);
    return u;
  };

  const syncStore: SyncStore = {
    async entitlements(tenantId) {
      const rows = JSON.parse(
        psql(controlPlaneUrl, `select coalesce(json_agg(e), '[]') from public.tenant_entitlements(:'tid'::uuid) e;`, { tid: tenantId }) || "[]"
      ) as EntitlementRow[];
      return rows[0] ?? null;
    },
    async allModules() {
      return JSON.parse(psql(controlPlaneUrl, `select coalesce(json_agg(id order by id), '[]') from public.modules where is_active;`)) as string[];
    },
    async projectRef(tenantId) {
      const slug = psql(controlPlaneUrl, `select slug from public.tenants where id = :'tid'::uuid;`, { tid: tenantId });
      return slug && urls[slug] ? slug : null;
    },
    async recordSync(subscriptionId, result) {
      psql(
        controlPlaneUrl,
        `update public.subscriptions set sync_status = :'s', sync_error = nullif(:'e', ''),
           synced_at = case when :'s' = 'synced' then now() else synced_at end
         where id = :'id'::uuid;`,
        { id: subscriptionId, s: result.status, e: result.error ?? "" }
      );
    },
  };

  return {
    syncStore,
    /** Management-API-shaped: runs the SQL in the tenant database named by `ref` (its slug). */
    api: {
      async runQuery<T>(ref: string, query: string): Promise<T[]> {
        psql(tenantUrl(ref), query);
        return [];
      },
    },
    async readUsage(tenant: TenantTarget, sql: string): Promise<unknown> {
      return [{ usage: JSON.parse(psql(tenantUrl(tenant.slug), sql)) }];
    },
    async saveSnapshot(tenantId: string, date: string, u: TenantUsage) {
      psql(
        controlPlaneUrl,
        `insert into public.usage_snapshots (tenant_id, snapshot_date, active_users, storage_bytes, ai_requests, ai_cost)
         values (:'tid'::uuid, :'d'::date, :'u'::int, :'s'::bigint, :'r'::int, :'c'::numeric)
         on conflict (tenant_id, snapshot_date) do update set active_users = excluded.active_users,
           storage_bytes = excluded.storage_bytes, ai_requests = excluded.ai_requests, ai_cost = excluded.ai_cost;`,
        { tid: tenantId, d: date, u: String(u.active_users), s: String(u.storage_bytes), r: String(u.ai_requests), c: String(u.ai_cost) }
      );
    },
  };
}
