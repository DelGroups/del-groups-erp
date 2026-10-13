// Tenant migrations (prompt 10): pending files, run plan, canary-first run that stops on failure.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dbVersion,
  isApplied,
  latestVersion,
  migrationFiles,
  newestApplied,
  pendingFiles,
  planRun,
} from "../lib/migrations/plan.ts";
import { migrateAll, migrateTenant } from "../lib/migrations/runner.ts";
import { managementApiExecutor, toTarget } from "../lib/migrations/store.ts";
import { migrationConfigFromEnv } from "../lib/migrations/config.ts";
import { baselineVersion } from "../lib/provisioning/plan.ts";

const SQL_DIR = fileURLToPath(new URL("../../supabase/", import.meta.url));
const TOKEN = "test-management-token-not-real-0002";

const file = (version, name) => ({ version, name: `${version}_${name}`, path: `/sql/${version}_${name}.sql` });
const A = file("20261011120000", "company_profile");
const B = file("20261011130000", "tenant_modules");
const C = file("20261020100000", "new_thing");
const FILES = [A, B, C];

// ── Files and versions ───────────────────────────────────────────────────────

test("migration files are the repo files newer than the baseline, oldest first", () => {
  const files = migrationFiles(SQL_DIR);
  const version = baselineVersion(SQL_DIR);
  assert.ok(files.length > 0);
  for (const f of files) {
    assert.ok(f.version > version, f.name);
    assert.match(f.name, /^\d{14}_[a-z0-9_]+$/);
    assert.equal(path.basename(f.path), `${f.name}.sql`);
  }
  assert.deepEqual(files.map((f) => f.name), files.map((f) => f.name).sort());
  assert.equal(latestVersion(SQL_DIR), files.at(-1).version);
});

test("without newer files the latest version is the baseline", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "erp-sql-"));
  mkdirSync(path.join(dir, "baseline"));
  mkdirSync(path.join(dir, "migrations"));
  writeFileSync(path.join(dir, "baseline", "VERSION"), "20261006100000\n");
  writeFileSync(path.join(dir, "migrations", "20261001000000_old.sql"), "select 1;");
  writeFileSync(path.join(dir, "migrations", "README.md"), "");
  assert.deepEqual(migrationFiles(dir), []);
  assert.equal(latestVersion(dir), "20261006100000");
});

test("a file counts as applied by full name (Management API) or by version + short name (db push)", () => {
  assert.ok(isApplied(A, [{ version: "20261012093011", name: "20261011120000_company_profile" }]));
  assert.ok(isApplied(A, [{ version: "20261011120000", name: "company_profile" }]));
  assert.ok(isApplied(A, [{ version: "20261011120000", name: null }]));
  // A Management API row whose run time equals the file's version is not the file.
  assert.ok(!isApplied(A, [{ version: "20261011120000", name: "baseline_04_functions" }]));
  assert.ok(!isApplied(A, [{ version: "20261011130000", name: "tenant_modules" }]));
});

test("pending files keep their order; newest applied is the last applied file", () => {
  const rows = [
    { version: "1", name: "baseline_00_extensions" },
    { version: "2", name: "20261011120000_company_profile" },
    { version: "20261020100000", name: "new_thing" },
  ];
  assert.deepEqual(pendingFiles(FILES, rows).map((f) => f.name), [B.name]);
  assert.equal(newestApplied(FILES, rows).name, C.name);
  assert.equal(newestApplied(FILES, []), null);
});

test("the DB version is the newest of schema_version and the last migration's prefix", () => {
  assert.equal(dbVersion(null), null);
  assert.equal(dbVersion({ schema_version: "20261006100000", last_migration: "20261011150000_enable_rls" }), "20261011150000");
  assert.equal(dbVersion({ schema_version: "20261011150000", last_migration: "baseline_13_seed" }), "20261011150000");
  assert.equal(dbVersion({ schema_version: null, last_migration: null }), null);
});

// ── Plan ─────────────────────────────────────────────────────────────────────

const tenant = (slug, extra = {}) => ({
  id: `id-${slug}`,
  slug,
  status: "active",
  projectRef: `ref${slug}`,
  isCanary: false,
  schemaVersion: null,
  lastMigration: null,
  ...extra,
});

test("the canary runs alone first, the rest by slug in batches; provisioning, cancelled and DB-less tenants are left out", () => {
  const tenants = [
    tenant("delta"), tenant("alpha"), tenant("canary", { isCanary: true }), tenant("beta", { status: "suspended" }),
    tenant("gamma", { status: "read_only" }), tenant("new", { status: "provisioning" }), tenant("gone", { status: "cancelled" }),
    tenant("nodb", { projectRef: null }),
  ];
  const r = planRun(tenants, { batchSize: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.plan.canary.slug, "canary");
  assert.deepEqual(r.plan.batches.map((b) => b.map((t) => t.slug)), [["alpha", "beta"], ["delta", "gamma"]]);
  assert.deepEqual(r.plan.excluded.map((e) => [e.tenant.slug, e.reason]), [["gone", "status"], ["new", "status"], ["nodb", "no_database"]]);
});

test("a run needs a canary unless one tenant is named", () => {
  const tenants = [tenant("a"), tenant("b")];
  assert.deepEqual(planRun(tenants, { batchSize: 5 }), { ok: false, error: "no_canary" });
  assert.equal(planRun(tenants, { batchSize: 5, canarySlug: "b" }).plan.canary.slug, "b");
  assert.deepEqual(planRun(tenants, { batchSize: 5, canarySlug: "zzz" }), { ok: false, error: "canary_not_found" });
  const one = planRun(tenants, { batchSize: 5, only: "a" });
  assert.deepEqual(one.plan.batches.map((b) => b.map((t) => t.slug)), [["a"]]);
  assert.equal(one.plan.canary, null);
  assert.deepEqual(planRun([tenant("p", { status: "provisioning" })], { batchSize: 5, only: "p" }), { ok: false, error: "tenant_not_found" });
  assert.deepEqual(planRun([], { batchSize: 5 }), { ok: true, plan: { canary: null, batches: [], excluded: [] } });
});

// ── Runner ───────────────────────────────────────────────────────────────────

/** In-memory control plane + tenant databases; `events` records the order of everything. */
function fakeWorld(tenants, applied, { failOn = null, busy = [] } = {}) {
  const events = [];
  const db = Object.fromEntries(tenants.map((t) => [t.id, { migration_status: "idle", locked: false }]));
  const rows = Object.fromEntries(tenants.map((t) => [t.slug, [...(applied[t.slug] ?? [])]]));
  const store = {
    async listTenants() {
      return tenants;
    },
    async claim(id) {
      if (busy.includes(id) || db[id].locked) return false;
      db[id].locked = true;
      db[id].migration_status = "running";
      return true;
    },
    async recordVersion(id, patch) {
      Object.assign(db[id], patch);
    },
    async finish(id, status, error) {
      Object.assign(db[id], { migration_status: status, migration_error: error, locked: false });
    },
    async log(entry) {
      events.push(`log ${entry.tenantId} ${entry.level} ${entry.message}`);
    },
  };
  const executor = {
    async appliedMigrations(t) {
      return rows[t.slug];
    },
    async apply(t, f, sql) {
      events.push(`apply ${t.slug} ${f.name}`);
      if (failOn && failOn(t, f)) throw new Error(`syntax error near "oops" (token ${TOKEN})`);
      assert.equal(sql, `-- ${f.name}`);
      rows[t.slug].push({ version: "20261013000000", name: f.name });
    },
  };
  const deps = {
    store,
    executor,
    files: FILES,
    baselineVersion: "20261006100000",
    readFile: (p) => `-- ${path.basename(p, ".sql")}`,
    now: () => Date.parse("2026-10-13T10:00:00Z"),
    secrets: [TOKEN],
  };
  return { deps, db, rows, events };
}

test("migrateTenant applies the pending files in order and records the version after each", async () => {
  const t = tenant("acme");
  const w = fakeWorld([t], { acme: [{ version: "x", name: A.name }] });
  const r = await migrateTenant(w.deps, t, { runId: "run-1", dryRun: false });
  assert.equal(r.outcome, "migrated");
  assert.deepEqual(r.applied, [B.name, C.name]);
  assert.equal(r.version, C.version);
  assert.deepEqual(w.events.filter((e) => e.startsWith("apply")), [`apply acme ${B.name}`, `apply acme ${C.name}`]);
  assert.equal(w.db[t.id].schema_version, C.version);
  assert.equal(w.db[t.id].last_migration, C.name);
  assert.equal(w.db[t.id].last_migrated_at, "2026-10-13T10:00:00.000Z");
  assert.equal(w.db[t.id].migration_status, "succeeded");
  assert.equal(w.db[t.id].locked, false);

  // Second run: nothing to do.
  const again = await migrateTenant(w.deps, t, { runId: "run-2", dryRun: false });
  assert.equal(again.outcome, "up_to_date");
  assert.deepEqual(again.applied, []);
});

test("an up-to-date tenant gets its recorded version synced without touching last_migrated_at", async () => {
  const t = tenant("acme", { schemaVersion: "20261006100000", lastMigration: "baseline_13_seed" });
  const w = fakeWorld([t], { acme: FILES.map((f) => ({ version: "x", name: f.name })) });
  const r = await migrateTenant(w.deps, t, { runId: "run-1", dryRun: false });
  assert.equal(r.outcome, "up_to_date");
  assert.equal(w.db[t.id].schema_version, C.version);
  assert.equal(w.db[t.id].last_migration, C.name);
  assert.equal("last_migrated_at" in w.db[t.id], false);
});

test("a failed file stops the tenant, is recorded redacted, and releases the lock", async () => {
  const t = tenant("acme");
  const w = fakeWorld([t], {}, { failOn: (_t, f) => f === B });
  const r = await migrateTenant(w.deps, t, { runId: "run-1", dryRun: false });
  assert.equal(r.outcome, "failed");
  assert.deepEqual(r.applied, [A.name]);
  assert.match(r.error, new RegExp(`^${B.name}: syntax error`));
  assert.ok(!r.error.includes(TOKEN));
  assert.equal(w.db[t.id].migration_status, "failed");
  assert.equal(w.db[t.id].schema_version, A.version);
  assert.equal(w.db[t.id].locked, false);
  assert.ok(!w.events.some((e) => e.includes(TOKEN)));
  assert.ok(!w.events.includes(`apply acme ${C.name}`));
});

test("a tenant locked by another run is reported busy and not touched", async () => {
  const t = tenant("acme");
  const w = fakeWorld([t], {}, { busy: [t.id] });
  const r = await migrateTenant(w.deps, t, { runId: "run-1", dryRun: false });
  assert.equal(r.outcome, "busy");
  assert.deepEqual(w.events, []);
});

test("migrateAll: canary first, then batches", async () => {
  const tenants = [tenant("b"), tenant("a"), tenant("c"), tenant("canary", { isCanary: true })];
  const w = fakeWorld(tenants, {});
  const s = await migrateAll(w.deps, { runId: "run-1", dryRun: false, batchSize: 2 });
  assert.equal(s.ok, true);
  assert.deepEqual(s.results.map((r) => [r.tenant.slug, r.outcome]), [["canary", "migrated"], ["a", "migrated"], ["b", "migrated"], ["c", "migrated"]]);
  const applies = w.events.filter((e) => e.startsWith("apply")).map((e) => e.split(" ")[1]);
  assert.deepEqual(applies.slice(0, 3), ["canary", "canary", "canary"], "the canary gets every file before anyone else");
  assert.deepEqual(applies.slice(-3), ["c", "c", "c"], "the last batch runs last");
});

test("migrateAll: a broken migration stops the run after the canary", async () => {
  const tenants = [tenant("a"), tenant("b"), tenant("canary", { isCanary: true })];
  const w = fakeWorld(tenants, {}, { failOn: (_t, f) => f === C });
  const s = await migrateAll(w.deps, { runId: "run-1", dryRun: false, batchSize: 5 });
  assert.equal(s.ok, false);
  assert.deepEqual(s.results.map((r) => [r.tenant.slug, r.outcome]), [["canary", "failed"]]);
  assert.deepEqual(s.notRun, ["a", "b"]);
  assert.ok(!w.events.some((e) => e.startsWith("apply a") || e.startsWith("apply b")));
  assert.equal(w.db["id-a"].migration_status, "idle");
});

test("migrateAll: a failure in a batch stops the later batches", async () => {
  const tenants = [tenant("a"), tenant("b"), tenant("c"), tenant("canary", { isCanary: true })];
  const w = fakeWorld(tenants, {}, { failOn: (t, f) => t.slug === "a" && f === A });
  const s = await migrateAll(w.deps, { runId: "run-1", dryRun: false, batchSize: 1 });
  assert.equal(s.ok, false);
  assert.deepEqual(s.results.map((r) => r.outcome), ["migrated", "failed"]);
  assert.deepEqual(s.notRun, ["b", "c"]);
});

test("migrateAll dry run changes nothing and reports every tenant's pending files", async () => {
  const tenants = [tenant("a"), tenant("canary", { isCanary: true })];
  const w = fakeWorld(tenants, { a: FILES.map((f) => ({ version: "x", name: f.name })) });
  const s = await migrateAll(w.deps, { runId: "run-1", dryRun: true, batchSize: 5 });
  assert.equal(s.ok, true);
  assert.deepEqual(s.results.map((r) => [r.tenant.slug, r.outcome, r.pending.length]), [["canary", "planned", 3], ["a", "up_to_date", 0]]);
  assert.deepEqual(w.events, []);
  assert.equal(w.db["id-canary"].migration_status, "idle");
});

test("migrateAll without a canary does not start", async () => {
  const w = fakeWorld([tenant("a")], {});
  const s = await migrateAll(w.deps, { runId: "run-1", dryRun: false, batchSize: 5 });
  assert.deepEqual(s, { ok: false, planError: "no_canary", results: [], notRun: [], excluded: [] });
  assert.deepEqual(w.events, []);
});

// ── Adapters ─────────────────────────────────────────────────────────────────

test("the Management API executor reads schema_migrations and applies a file as a named migration", async () => {
  const calls = [];
  const api = {
    async runQuery(ref, query) {
      calls.push(["query", ref, query]);
      return [{ version: "1", name: "baseline_00_extensions" }];
    },
    async applyMigration(ref, name, query) {
      calls.push(["apply", ref, name, query]);
    },
  };
  const ex = managementApiExecutor(api);
  assert.deepEqual(await ex.appliedMigrations(tenant("acme")), [{ version: "1", name: "baseline_00_extensions" }]);
  await ex.apply(tenant("acme"), C, "select 1;");
  assert.match(calls[0][2], /from supabase_migrations\.schema_migrations/);
  assert.deepEqual(calls[1], ["apply", "refacme", C.name, "select 1;"]);
  await assert.rejects(ex.apply(tenant("x", { projectRef: null }), C, ""), /no Supabase project/);
});

test("a database without migration history fails with a clear message", async () => {
  const api = {
    async runQuery() {
      throw new Error('POST /v1/projects/x/database/query: HTTP 400 relation "supabase_migrations.schema_migrations" does not exist');
    },
  };
  await assert.rejects(managementApiExecutor(api).appliedMigrations(tenant("x")), /register its migration history first/);
});

test("control-plane rows map to targets (object or array embed)", () => {
  const db = { supabase_project_ref: "abc", is_canary: true, schema_version: "20261006100000", last_migration: "baseline_13_seed" };
  const expected = { id: "1", slug: "acme", status: "trial", projectRef: "abc", isCanary: true, schemaVersion: "20261006100000", lastMigration: "baseline_13_seed" };
  assert.deepEqual(toTarget({ id: "1", slug: "acme", status: "trial", tenant_databases: db }), expected);
  assert.deepEqual(toTarget({ id: "1", slug: "acme", status: "trial", tenant_databases: [db] }), expected);
  assert.equal(toTarget({ id: "1", slug: "acme", status: "trial", tenant_databases: null }).projectRef, null);
});

test("the migrate button needs only the Management API token", () => {
  assert.deepEqual(migrationConfigFromEnv({}, "/app"), { config: null, missing: ["SUPABASE_MANAGEMENT_API_TOKEN"] });
  const { config } = migrationConfigFromEnv({ SUPABASE_MANAGEMENT_API_TOKEN: ` ${TOKEN} `, ERP_SQL_DIR: "/app/supabase" }, "/app");
  assert.deepEqual(config, { managementToken: TOKEN, sqlDir: "/app/supabase" });
});
