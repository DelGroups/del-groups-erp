/**
 * Which ERP migration files a tenant database still needs, and in which order the tenants
 * get them (prompt 10). Pure functions except migrationFiles(), which reads the folder.
 *
 * Only files newer than supabase/baseline/VERSION count: a tenant built from the baseline
 * already has everything up to that version, and Del Groups' own database had the older
 * files applied before the baseline was taken.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { baselineVersion } from "../provisioning/plan.ts";

export interface MigrationFile {
  /** 14-digit version, e.g. "20261011150000". */
  version: string;
  /** Full name as recorded in the tenant database, e.g. "20261011150000_enable_rls_on_remaining_tables". */
  name: string;
  path: string;
}

/** A row of supabase_migrations.schema_migrations in a tenant database. */
export interface AppliedRow {
  version: string;
  name: string | null;
}

const FILE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
export const VERSION_RE = /^\d{14}$/;

/** supabase/migrations files newer than the baseline, oldest first. */
export function migrationFiles(sqlDir: string): MigrationFile[] {
  const version = baselineVersion(sqlDir);
  const dir = path.join(sqlDir, "migrations");
  return readdirSync(dir)
    .sort()
    .flatMap((f) => {
      const m = FILE.exec(f);
      return m && m[1] > version ? [{ version: m[1], name: `${m[1]}_${m[2]}`, path: path.join(dir, f) }] : [];
    });
}

/**
 * Whether a file is already in the tenant database. Two ways it gets recorded:
 * - the Management API (provisioning, migrate-all) stores the full file name as `name`
 *   and the time it ran as `version`;
 * - `supabase db push` / scripts/db/build-fresh.sh store the file's own version, and the
 *   rest of the name (or nothing) as `name`.
 * A bare version match is not enough: a Management API row's time stamp could equal a
 * later file's version by chance.
 */
export function isApplied(file: MigrationFile, rows: readonly AppliedRow[]): boolean {
  const suffix = file.name.slice(15);
  return rows.some(
    (r) => r.name === file.name || (r.version === file.version && (r.name === null || r.name === "" || r.name === suffix))
  );
}

export function pendingFiles(files: readonly MigrationFile[], rows: readonly AppliedRow[]): MigrationFile[] {
  return files.filter((f) => !isApplied(f, rows));
}

/** The newest file the tenant has, or null when it has none newer than the baseline. */
export function newestApplied(files: readonly MigrationFile[], rows: readonly AppliedRow[]): MigrationFile | null {
  const applied = files.filter((f) => isApplied(f, rows));
  return applied.length ? applied[applied.length - 1] : null;
}

/**
 * The tenant's DB version as the panel shows it: the newest 14-digit version among
 * schema_version and the prefix of last_migration (provisioning stores the baseline
 * version in schema_version and the last file in last_migration).
 */
export function dbVersion(row: { schema_version: string | null; last_migration: string | null } | null): string | null {
  if (!row) return null;
  const candidates = [row.schema_version, row.last_migration?.slice(0, 14) ?? null].filter(
    (v): v is string => typeof v === "string" && VERSION_RE.test(v)
  );
  return candidates.length ? candidates.sort().at(-1)! : null;
}

/** The version a fully migrated tenant has: the newest migration file, else the baseline. */
export function latestVersion(sqlDir: string): string {
  const files = migrationFiles(sqlDir);
  return files.length ? files[files.length - 1].version : baselineVersion(sqlDir);
}

export interface TenantTarget {
  id: string;
  slug: string;
  status: string;
  projectRef: string | null;
  isCanary: boolean;
  schemaVersion: string | null;
  lastMigration: string | null;
}

/** Tenant statuses whose database is not migrated: still being built, or gone. */
export const SKIPPED_STATUSES = ["provisioning", "cancelled"] as const;

export interface RunPlan {
  canary: TenantTarget | null;
  /** The other tenants, in batches; a batch runs in parallel. */
  batches: TenantTarget[][];
  /** Tenants left out, with the reason (for the summary). */
  excluded: { tenant: TenantTarget; reason: "status" | "no_database" }[];
}

export type PlanError = "no_canary" | "canary_not_found" | "tenant_not_found";

/**
 * Canary first (the tenant marked is_canary, or the one named with --canary), then the
 * rest by slug in batches of `batchSize`. With `only`, just that tenant (no canary needed).
 */
export function planRun(
  tenants: readonly TenantTarget[],
  options: { batchSize: number; canarySlug?: string | null; only?: string | null }
): { ok: true; plan: RunPlan } | { ok: false; error: PlanError } {
  const excluded: RunPlan["excluded"] = [];
  const eligible: TenantTarget[] = [];
  for (const t of [...tenants].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if ((SKIPPED_STATUSES as readonly string[]).includes(t.status)) excluded.push({ tenant: t, reason: "status" });
    else if (!t.projectRef) excluded.push({ tenant: t, reason: "no_database" });
    else eligible.push(t);
  }

  if (options.only) {
    const one = eligible.find((t) => t.slug === options.only);
    if (!one) return { ok: false, error: "tenant_not_found" };
    return { ok: true, plan: { canary: null, batches: [[one]], excluded: [] } };
  }
  if (eligible.length === 0) return { ok: true, plan: { canary: null, batches: [], excluded } };

  const canary = options.canarySlug
    ? eligible.find((t) => t.slug === options.canarySlug)
    : eligible.find((t) => t.isCanary);
  if (!canary) return { ok: false, error: options.canarySlug ? "canary_not_found" : "no_canary" };

  const rest = eligible.filter((t) => t !== canary);
  const size = Math.max(1, Math.floor(options.batchSize) || 1);
  const batches: TenantTarget[][] = [];
  for (let i = 0; i < rest.length; i += size) batches.push(rest.slice(i, i + size));
  return { ok: true, plan: { canary, batches, excluded } };
}
