/**
 * --local mode of migrate-all: the control plane and the tenant databases are plain local
 * Postgres databases reached with psql (rehearsals and CI, never Supabase Cloud).
 */
import { spawnSync } from "node:child_process";
import type { AppliedRow, TenantTarget } from "../../control-panel/lib/migrations/plan.ts";
import type { MigrationStore, TenantExecutor } from "../../control-panel/lib/migrations/runner.ts";

/** Stops on a hosted Supabase URL: local mode is for local databases only. */
export function refuseHosted(url: string, fail: (message: string) => never): void {
  if (/supabase\.(co|com)\b/i.test(url) || /pooler\.supabase/i.test(url)) fail("--local only works with local databases, not Supabase Cloud");
}

/** Runs a psql script (stdin) with `-v name=value` variables; returns stdout. */
export function psql(url: string, script: string, vars: Record<string, string> = {}, singleTransaction = false): string {
  const args = [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
  if (singleTransaction) args.push("--single-transaction");
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  const run = spawnSync("psql", args, {
    input: script,
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ""} -c client_min_messages=warning`.trim() },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error((run.stderr || `psql exited with ${run.status}`).trim());
  return run.stdout.trim();
}

function json<T>(text: string): T {
  return JSON.parse(text || "null") as T;
}

export function localStore(url: string): MigrationStore {
  return {
    async listTenants() {
      const rows = json<Record<string, unknown>[]>(
        psql(
          url,
          `select coalesce(json_agg(x order by x.slug), '[]') from (
             select t.id, t.slug, t.status, d.supabase_project_ref, coalesce(d.is_canary, false) as is_canary,
                    d.schema_version, d.last_migration
               from public.tenants t left join public.tenant_databases d on d.tenant_id = t.id
           ) x;`
        )
      );
      return rows.map(
        (r): TenantTarget => ({
          id: String(r.id),
          slug: String(r.slug),
          status: String(r.status),
          projectRef: (r.supabase_project_ref as string | null) ?? null,
          isCanary: r.is_canary === true,
          schemaVersion: (r.schema_version as string | null) ?? null,
          lastMigration: (r.last_migration as string | null) ?? null,
        })
      );
    },
    async claim(tenantId, seconds) {
      return psql(url, `select public.claim_tenant_migration(:'tid'::uuid, :'secs'::integer);`, { tid: tenantId, secs: String(seconds) }) === "t";
    },
    async recordVersion(tenantId, patch) {
      psql(
        url,
        `update public.tenant_databases
            set schema_version = :'v', last_migration = nullif(:'m', ''),
                last_migrated_at = coalesce(nullif(:'at', '')::timestamptz, last_migrated_at)
          where tenant_id = :'tid'::uuid;`,
        { tid: tenantId, v: patch.schema_version, m: patch.last_migration ?? "", at: patch.last_migrated_at ?? "" }
      );
    },
    async finish(tenantId, status, error) {
      psql(
        url,
        `update public.tenant_databases
            set migration_status = :'s', migration_error = nullif(:'e', ''), migration_locked_until = null
          where tenant_id = :'tid'::uuid;`,
        { tid: tenantId, s: status, e: error ?? "" }
      );
    },
    async log(entry) {
      psql(
        url,
        `insert into public.tenant_migration_log (tenant_id, run_id, migration, level, message)
         values (:'tid'::uuid, :'run', nullif(:'mig', ''), :'lvl', :'msg');`,
        { tid: entry.tenantId, run: entry.runId, mig: entry.migration ?? "", lvl: entry.level, msg: entry.message.slice(0, 2000) }
      );
    },
  };
}

/** Tenant databases by slug. Files are recorded like `supabase db push` does (version, name). */
export function localExecutor(urls: Record<string, string>): TenantExecutor {
  const url = (tenant: TenantTarget) => {
    const u = urls[tenant.slug];
    if (!u) throw new Error(`no database URL for ${tenant.slug} in TENANT_DATABASE_URLS`);
    return u;
  };
  return {
    async appliedMigrations(tenant) {
      return json<AppliedRow[]>(
        psql(
          url(tenant),
          `select coalesce(json_agg(json_build_object('version', version, 'name', name) order by version), '[]')
             from supabase_migrations.schema_migrations;`
        )
      );
    },
    async apply(tenant, file) {
      // psql reads the file itself (\i), in one transaction with its schema_migrations row.
      psql(
        url(tenant),
        `\\i '${file.path.replace(/\\/g, "/").replace(/'/g, "''")}'
insert into supabase_migrations.schema_migrations (version, name) values (:'v', :'n') on conflict (version) do nothing;`,
        { v: file.version, n: file.name.slice(15) },
        true
      );
    },
  };
}
