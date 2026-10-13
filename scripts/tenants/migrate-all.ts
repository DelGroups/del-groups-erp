/**
 * Applies new supabase/migrations files to every tenant database (prompt 10).
 *
 *   npm run tenants:migrate -- --dry-run            # what each tenant would get, no change
 *   npm run tenants:migrate                          # canary first, then batches of 5
 *   npm run tenants:migrate -- --tenant acme         # one tenant only
 *   npm run tenants:migrate -- --canary acme --batch-size 3
 *
 * Tenants come from the control plane (CONTROL_PLANE_URL + CONTROL_PLANE_SERVICE_ROLE_KEY);
 * their databases are reached through the Supabase Management API
 * (SUPABASE_MANAGEMENT_API_TOKEN). The canary is the tenant marked "canary" in the panel
 * (or --canary). It runs first and alone; then the others run in batches. The run stops at
 * the first failure, and tenants after it are not touched. Each tenant's version is
 * recorded in tenant_databases and every step in tenant_migration_log.
 *
 * Skipped: tenants in status provisioning (their job installs everything) or cancelled,
 * and tenants without a database. Only files newer than supabase/baseline/VERSION count.
 *
 * --local: rehearsal on local Postgres, no Supabase. The control plane is
 * CONTROL_PLANE_DB_URL, the tenant databases TENANT_DATABASE_URLS ({"<slug>": "<url>"}),
 * both reached with psql. Hosted Supabase URLs are refused. See scripts/tenants/e2e-local.sh.
 *
 * Exit code: 0 all good, 1 a tenant failed (or was busy), 2 bad options or settings.
 */
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baselineVersion } from "../../control-panel/lib/provisioning/plan.ts";
import { createManagementApi, redactSecrets } from "../../control-panel/lib/provisioning/managementApi.ts";
import { migrationFiles } from "../../control-panel/lib/migrations/plan.ts";
import { migrateAll, type MigrationDeps, type MigrationStore, type RunSummary, type TenantExecutor } from "../../control-panel/lib/migrations/runner.ts";
import { managementApiExecutor, supabaseMigrationStore } from "../../control-panel/lib/migrations/store.ts";
import { localExecutor, localStore, refuseHosted } from "./local.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Options {
  dryRun: boolean;
  local: boolean;
  only: string | null;
  canarySlug: string | null;
  batchSize: number;
  sqlDir: string;
}

function usage(message?: string): never {
  if (message) console.error(`migrate-all: ${message}`);
  console.error("usage: migrate-all [--dry-run] [--tenant <slug>] [--canary <slug>] [--batch-size <n>] [--sql-dir <dir>] [--local]");
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    local: false,
    only: null,
    canarySlug: null,
    batchSize: 5,
    sqlDir: (process.env.ERP_SQL_DIR ?? "").trim() || path.join(ROOT, "supabase"),
  };
  const value = (i: number) => {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) usage(`${argv[i]} needs a value`);
    return v.trim();
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--local") options.local = true;
    else if (arg === "--tenant") options.only = value(i++) || null;
    else if (arg === "--canary") options.canarySlug = value(i++) || null;
    else if (arg === "--sql-dir") options.sqlDir = path.resolve(value(i++));
    else if (arg === "--batch-size") {
      const n = Number(value(i++));
      if (!Number.isInteger(n) || n < 1 || n > 50) usage("--batch-size must be 1-50");
      options.batchSize = n;
    } else if (arg === "-h" || arg === "--help") usage();
    else usage(`unknown option ${arg}`);
  }
  return options;
}

function env(name: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!v) usage(`${name} is not set`);
  return v;
}

async function remoteDeps(): Promise<{ store: MigrationStore; executor: TenantExecutor; secrets: string[] }> {
  const url = env("CONTROL_PLANE_URL");
  const serviceKey = env("CONTROL_PLANE_SERVICE_ROLE_KEY");
  const token = env("SUPABASE_MANAGEMENT_API_TOKEN");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const api = createManagementApi({ token, fetch: (input, init) => fetch(input, init) });
  // The repo root and control-panel/ each have their own copy of supabase-js; same API.
  const store = supabaseMigrationStore(supabase as unknown as Parameters<typeof supabaseMigrationStore>[0]);
  return { store, executor: managementApiExecutor(api), secrets: [serviceKey, token] };
}

function localDeps(): { store: MigrationStore; executor: TenantExecutor; secrets: string[] } {
  const controlPlane = env("CONTROL_PLANE_DB_URL");
  let urls: Record<string, string>;
  try {
    urls = JSON.parse(env("TENANT_DATABASE_URLS"));
  } catch {
    usage('TENANT_DATABASE_URLS must be JSON: {"<slug>": "postgresql://..."}');
  }
  for (const u of [controlPlane, ...Object.values(urls)]) refuseHosted(u, usage);
  return { store: localStore(controlPlane), executor: localExecutor(urls), secrets: [] };
}

function runId(): string {
  const gh = process.env.GITHUB_RUN_ID;
  if (gh) return `gh-${gh}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
  return `cli-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

const PLAN_ERRORS: Record<string, string> = {
  no_canary: "no canary tenant: mark one tenant as canary in the control panel, or pass --canary <slug>",
  canary_not_found: "the --canary tenant does not exist or cannot be migrated (status provisioning/cancelled, or no database)",
  tenant_not_found: "the --tenant tenant does not exist or cannot be migrated (status provisioning/cancelled, or no database)",
};

function report(summary: RunSummary, options: Options, id: string): string {
  const lines = [
    `### Tenant migrations ${options.dryRun ? "(dry run) " : ""}— run ${id}`,
    "",
    "| Tenant | Result | Version | Files | Error |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of summary.results) {
    const files = options.dryRun || r.outcome === "failed" ? r.pending : r.applied;
    lines.push(`| ${r.tenant.slug} | ${r.outcome} | ${r.version ?? "—"} | ${files.join("<br>") || "—"} | ${(r.error ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`);
  }
  for (const slug of summary.notRun) lines.push(`| ${slug} | not run (stopped) | | | |`);
  for (const e of summary.excluded) lines.push(`| ${e.slug} | skipped (${e.reason === "status" ? "status" : "no database"}) | | | |`);
  lines.push("", summary.ok ? "Result: OK" : "Result: FAILED");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { store, executor, secrets } = options.local ? localDeps() : await remoteDeps();
  const files = migrationFiles(options.sqlDir);
  const id = runId();
  console.log(
    `${options.dryRun ? "Dry run: " : ""}${files.length} migration file(s) newer than baseline ${baselineVersion(options.sqlDir)}: ${files.map((f) => f.name).join(", ") || "none"}`
  );

  const deps: MigrationDeps = {
    store,
    executor,
    files,
    baselineVersion: baselineVersion(options.sqlDir),
    readFile: (p) => readFileSync(p, "utf8"),
    now: Date.now,
    secrets,
    onEvent: (line) => console.log(line),
  };
  const summary = await migrateAll(deps, { runId: id, ...options });
  if (summary.planError) {
    console.error(`migrate-all: ${PLAN_ERRORS[summary.planError]}`);
    process.exit(2);
  }
  const text = report(summary, options, id);
  console.log(`\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  const keys = ["CONTROL_PLANE_SERVICE_ROLE_KEY", "SUPABASE_MANAGEMENT_API_TOKEN"].map((k) => process.env[k] ?? "");
  console.error(`migrate-all: ${redactSecrets(error instanceof Error ? error.message : String(error), keys)}`);
  process.exit(1);
});
