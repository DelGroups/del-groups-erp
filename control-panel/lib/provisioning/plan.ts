/**
 * What a new tenant database gets, in order (same as scripts/db/build-fresh.sh):
 * 1. the core baseline (supabase/baseline/NN_*.sql),
 * 2. the install scripts of the chosen modules and their dependencies, in
 *    supabase/modules/ORDER order,
 * 3. every supabase/migrations file newer than supabase/baseline/VERSION.
 * Server only (reads files).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export interface ModuleRow {
  id: string;
  depends: string[];
}

/** The chosen modules plus everything they depend on (core always). */
export function moduleClosure(chosen: readonly string[], modules: readonly ModuleRow[]): string[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id) || !byId.has(id)) return;
    result.add(id);
    for (const dep of byId.get(id)!.depends) visit(dep);
  };
  visit("core");
  for (const id of chosen) visit(id);
  return modules.map((m) => m.id).filter((id) => result.has(id));
}

export interface SchemaFile {
  /** Migration name recorded in the tenant database, e.g. "baseline_04_functions". */
  name: string;
  path: string;
}

function readLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
}

export function baselineVersion(sqlDir: string): string {
  return readFileSync(path.join(sqlDir, "baseline", "VERSION"), "utf8").trim();
}

/** Ordered SQL files for a tenant with these modules (already closed over dependencies). */
export function schemaFiles(sqlDir: string, modules: readonly string[]): SchemaFile[] {
  const baselineDir = path.join(sqlDir, "baseline");
  const files: SchemaFile[] = readdirSync(baselineDir)
    .filter((f) => /^\d{2}_[a-z_]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: `baseline_${f.replace(/\.sql$/, "")}`, path: path.join(baselineDir, f) }));

  const orderFile = path.join(sqlDir, "modules", "ORDER");
  const order = existsSync(orderFile) ? readLines(orderFile) : [];
  for (const id of order) {
    if (modules.includes(id)) {
      files.push({ name: `module_${id.replace(/-/g, "_")}`, path: path.join(sqlDir, "modules", id, "install.sql") });
    }
  }

  const version = baselineVersion(sqlDir);
  const migrationsDir = path.join(sqlDir, "migrations");
  for (const f of readdirSync(migrationsDir).sort()) {
    const m = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(f);
    if (m && m[1] > version) files.push({ name: `${m[1]}_${m[2]}`, path: path.join(migrationsDir, f) });
  }
  return files;
}

/** Storage buckets the files create (insert into storage.buckets ... values ('id', ...)). */
export function expectedBuckets(files: readonly SchemaFile[]): string[] {
  const ids = new Set<string>();
  for (const file of files) {
    const sql = readFileSync(file.path, "utf8");
    for (const m of sql.matchAll(/insert into storage\.buckets[^;]*?values\s*\(\s*'([a-z0-9-]+)'/gi)) ids.add(m[1]);
  }
  return [...ids].sort();
}

/** SQL that makes tenant_modules match the chosen modules (every known module gets a row). */
export function tenantModulesSql(allModules: readonly string[], enabled: readonly string[]): string {
  const rows = allModules
    .filter((id) => /^[a-z][a-z0-9-]*$/.test(id))
    .map((id) => `('${id}', ${enabled.includes(id) ? "true" : "false"})`)
    .join(",\n  ");
  return [
    "insert into public.tenant_modules (module_id, enabled) values",
    `  ${rows}`,
    "on conflict (module_id) do update set enabled = excluded.enabled, updated_at = now();",
  ].join("\n");
}
