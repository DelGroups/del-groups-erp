/**
 * Applies pending ERP migration files to tenant databases (prompt 10).
 *
 * migrateTenant() brings one tenant up to date, file by file, under that tenant's lock, and
 * records the new version after every file. migrateAll() does the canary first, then the
 * other tenants in batches, and stops at the first failure: a broken migration reaches
 * the canary only.
 *
 * Errors are redacted before they are logged or stored; no key ever reaches the log.
 */
import { redactSecrets } from "../provisioning/managementApi.ts";
import {
  newestApplied,
  pendingFiles,
  planRun,
  type AppliedRow,
  type MigrationFile,
  type PlanError,
  type TenantTarget,
} from "./plan.ts";

export interface MigrationStore {
  listTenants(): Promise<TenantTarget[]>;
  /** Takes the tenant's lock and marks it running; false when another run holds it. */
  claim(tenantId: string, seconds: number): Promise<boolean>;
  /** After each file: the version the database now has. */
  recordVersion(tenantId: string, patch: { schema_version: string; last_migration: string | null; last_migrated_at?: string }): Promise<void>;
  /** Ends the run for the tenant: status, error, lock released. */
  finish(tenantId: string, status: "succeeded" | "failed", error: string | null): Promise<void>;
  log(entry: { tenantId: string; runId: string; migration: string | null; level: "info" | "warn" | "error"; message: string }): Promise<void>;
}

/** Runs SQL in a tenant database. */
export interface TenantExecutor {
  /** supabase_migrations.schema_migrations; throws when the table is missing. */
  appliedMigrations(tenant: TenantTarget): Promise<AppliedRow[]>;
  /** Applies one file in one transaction and records it in schema_migrations. */
  apply(tenant: TenantTarget, file: MigrationFile, sql: string): Promise<void>;
}

export interface MigrationDeps {
  store: MigrationStore;
  executor: TenantExecutor;
  files: MigrationFile[];
  /** Baseline VERSION: the tenant's version when it has no newer file yet. */
  baselineVersion: string;
  readFile(path: string): string;
  now(): number;
  /** Values that must never appear in a log line (tokens, keys). */
  secrets: string[];
  /** Progress lines for the CLI (optional). */
  onEvent?(line: string): void;
}

export type TenantOutcome = "up_to_date" | "migrated" | "planned" | "failed" | "busy";

export interface TenantResult {
  tenant: Pick<TenantTarget, "id" | "slug">;
  outcome: TenantOutcome;
  /** Files applied in this run (or, for a dry run, that would be). */
  applied: string[];
  pending: string[];
  version: string | null;
  error: string | null;
}

/** A tenant holds the lock for at most this long; renewed by every claim. */
const LOCK_SECONDS = 1800;

function clean(error: unknown, secrets: readonly string[]): string {
  return redactSecrets(error instanceof Error ? error.message : String(error), secrets);
}

export async function migrateTenant(
  deps: MigrationDeps,
  tenant: TenantTarget,
  options: { runId: string; dryRun: boolean }
): Promise<TenantResult> {
  const { store, executor, files } = deps;
  const say = (line: string) => deps.onEvent?.(`[${tenant.slug}] ${line}`);
  const result: TenantResult = {
    tenant: { id: tenant.id, slug: tenant.slug },
    outcome: "up_to_date",
    applied: [],
    pending: [],
    version: null,
    error: null,
  };

  if (options.dryRun) {
    try {
      const rows = await executor.appliedMigrations(tenant);
      result.pending = pendingFiles(files, rows).map((f) => f.name);
      result.version = newestApplied(files, rows)?.version ?? deps.baselineVersion;
      result.outcome = result.pending.length ? "planned" : "up_to_date";
      say(result.pending.length ? `would apply ${result.pending.join(", ")}` : "up to date");
    } catch (error) {
      result.outcome = "failed";
      result.error = clean(error, deps.secrets);
      say(`cannot read its migrations: ${result.error}`);
    }
    return result;
  }

  if (!(await store.claim(tenant.id, LOCK_SECONDS))) {
    result.outcome = "busy";
    result.error = "another migration run holds this tenant";
    say(result.error);
    return result;
  }

  const log = (migration: string | null, level: "info" | "warn" | "error", message: string) =>
    store.log({ tenantId: tenant.id, runId: options.runId, migration, level, message: clean(message, deps.secrets) });

  let current: MigrationFile | null = null;
  try {
    const rows = await executor.appliedMigrations(tenant);
    const pending = pendingFiles(files, rows);
    result.pending = pending.map((f) => f.name);
    const newest = newestApplied(files, rows);
    result.version = newest?.version ?? deps.baselineVersion;

    if (pending.length === 0) {
      // Nothing to do; keep the recorded version in step with the database.
      if (tenant.schemaVersion !== result.version || (newest && tenant.lastMigration !== newest.name)) {
        await store.recordVersion(tenant.id, {
          schema_version: result.version,
          last_migration: newest?.name ?? tenant.lastMigration,
        });
      }
      await log(null, "info", `up to date at ${result.version}`);
      say(`up to date at ${result.version}`);
      await store.finish(tenant.id, "succeeded", null);
      return result;
    }

    await log(null, "info", `${pending.length} pending: ${result.pending.join(", ")}`);
    for (const file of pending) {
      current = file;
      say(`applying ${file.name}`);
      await executor.apply(tenant, file, deps.readFile(file.path));
      result.applied.push(file.name);
      result.version = file.version;
      await store.recordVersion(tenant.id, {
        schema_version: file.version,
        last_migration: file.name,
        last_migrated_at: new Date(deps.now()).toISOString(),
      });
      await log(file.name, "info", `applied ${file.name}`);
    }
    current = null;
    result.outcome = "migrated";
    await store.finish(tenant.id, "succeeded", null);
    say(`done at ${result.version}`);
    return result;
  } catch (error) {
    result.outcome = "failed";
    const message = clean(error, deps.secrets);
    result.error = current ? `${current.name}: ${message}` : message;
    say(`FAILED ${result.error}`);
    // Recording the failure must not hide it.
    try {
      await log(current?.name ?? null, "error", result.error);
    } catch {
      // the store is down too; the result still carries the error
    }
    try {
      await store.finish(tenant.id, "failed", result.error.slice(0, 2000));
    } catch {
      // same as above
    }
    return result;
  }
}

export interface RunSummary {
  ok: boolean;
  /** Set when the run could not start (no canary, unknown tenant). */
  planError: PlanError | null;
  results: TenantResult[];
  /** Tenants not run because an earlier one failed. */
  notRun: string[];
  excluded: { slug: string; reason: "status" | "no_database" }[];
}

const FAILED: readonly TenantOutcome[] = ["failed", "busy"];

export async function migrateAll(
  deps: MigrationDeps,
  options: { runId: string; dryRun: boolean; batchSize: number; canarySlug?: string | null; only?: string | null }
): Promise<RunSummary> {
  const planned = planRun(await deps.store.listTenants(), options);
  if (!planned.ok) return { ok: false, planError: planned.error, results: [], notRun: [], excluded: [] };
  const { canary, batches, excluded } = planned.plan;
  const summary: RunSummary = {
    ok: true,
    planError: null,
    results: [],
    notRun: [],
    excluded: excluded.map((e) => ({ slug: e.tenant.slug, reason: e.reason })),
  };

  const groups: TenantTarget[][] = canary ? [[canary], ...batches] : batches;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (canary && i === 0) deps.onEvent?.(`canary: ${canary.slug}`);
    else deps.onEvent?.(`batch: ${group.map((t) => t.slug).join(", ")}`);
    const results = await Promise.all(group.map((t) => migrateTenant(deps, t, options)));
    summary.results.push(...results);
    // A dry run looks at every tenant; a real run stops at the first failure.
    if (!options.dryRun && results.some((r) => FAILED.includes(r.outcome))) {
      summary.ok = false;
      summary.notRun = groups.slice(i + 1).flat().map((t) => t.slug);
      deps.onEvent?.(`stopped: ${summary.notRun.length} tenant(s) not run`);
      break;
    }
  }
  if (summary.results.some((r) => FAILED.includes(r.outcome))) summary.ok = false;
  return summary;
}
