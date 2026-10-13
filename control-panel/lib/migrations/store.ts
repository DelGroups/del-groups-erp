/**
 * The control-plane side of tenant migrations through a Supabase client: the signed-in
 * admin's client in the panel (RLS, audited), or a service-role client in
 * scripts/tenants/migrate-all.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ManagementApi } from "../provisioning/managementApi.ts";
import type { AppliedRow, TenantTarget } from "./plan.ts";
import type { MigrationStore, TenantExecutor } from "./runner.ts";

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

interface DatabaseRow {
  supabase_project_ref: string | null;
  is_canary: boolean | null;
  schema_version: string | null;
  last_migration: string | null;
}

export function toTarget(row: Record<string, unknown>): TenantTarget {
  // One-to-one embed: PostgREST returns an object (older versions an array).
  const raw = row.tenant_databases as DatabaseRow | DatabaseRow[] | null | undefined;
  const db = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
  return {
    id: String(row.id),
    slug: String(row.slug),
    status: String(row.status),
    projectRef: db?.supabase_project_ref ?? null,
    isCanary: db?.is_canary === true,
    schemaVersion: db?.schema_version ?? null,
    lastMigration: db?.last_migration ?? null,
  };
}

export const TENANT_TARGET_SELECT =
  "id, slug, status, tenant_databases(supabase_project_ref, is_canary, schema_version, last_migration)";

export function supabaseMigrationStore(supabase: SupabaseClient): MigrationStore {
  return {
    async listTenants() {
      const rows = check(await supabase.from("tenants").select(TENANT_TARGET_SELECT).order("slug")) as Record<string, unknown>[];
      return rows.map(toTarget);
    },
    async claim(tenantId, seconds) {
      return check(await supabase.rpc("claim_tenant_migration", { p_tenant_id: tenantId, p_seconds: seconds })) === true;
    },
    async recordVersion(tenantId, patch) {
      check(await supabase.from("tenant_databases").update(patch).eq("tenant_id", tenantId));
    },
    async finish(tenantId, status, error) {
      check(
        await supabase
          .from("tenant_databases")
          .update({ migration_status: status, migration_error: error, migration_locked_until: null })
          .eq("tenant_id", tenantId)
      );
    },
    async log(entry) {
      check(
        await supabase.from("tenant_migration_log").insert({
          tenant_id: entry.tenantId,
          run_id: entry.runId,
          migration: entry.migration,
          level: entry.level,
          message: entry.message.slice(0, 2000),
        })
      );
    },
  };
}

export const APPLIED_MIGRATIONS_SQL =
  "select version::text as version, name::text as name from supabase_migrations.schema_migrations order by version;";

/**
 * Tenant databases on Supabase Cloud, through the Management API (the same calls
 * provisioning uses): each file is one recorded migration named after the file.
 */
export function managementApiExecutor(api: ManagementApi): TenantExecutor {
  const ref = (tenant: TenantTarget) => {
    if (!tenant.projectRef) throw new Error("the tenant has no Supabase project");
    return tenant.projectRef;
  };
  return {
    async appliedMigrations(tenant) {
      try {
        return await api.runQuery<AppliedRow>(ref(tenant), APPLIED_MIGRATIONS_SQL);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/schema_migrations/.test(message) && /does not exist/.test(message)) {
          throw new Error("the database has no supabase_migrations.schema_migrations table; register its migration history first");
        }
        throw error;
      }
    },
    async apply(tenant, file, sql) {
      await api.applyMigration(ref(tenant), file.name, sql);
    },
  };
}
