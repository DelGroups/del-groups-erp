// The control-plane migration matches the app's rules and locks every table down.   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { TENANT_STATUSES, TENANT_LANGUAGES, SLUG_PATTERN } from "../lib/tenants.ts";

const dir = new URL("../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

// The table names listed in `foreach t in array array[...]` right after a marker comment.
function arrayAfter(marker) {
  const at = sql.indexOf(marker);
  assert.ok(at >= 0, marker);
  const body = sql.slice(at, sql.indexOf("] loop", at));
  return [...body.matchAll(/'(\w+)'/g)].map((m) => m[1]);
}
const quotedList = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

test("migration file names are <14-digit version>_<name>.sql", () => {
  for (const f of readdirSync(dir)) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/);
});

test("all tables from the plan exist", () => {
  for (const t of [
    "tenants",
    "tenant_databases",
    "tenant_domains",
    "tenant_secrets",
    "modules",
    "plans",
    "plan_prices",
    "subscriptions",
    "subscription_items",
    "invoices",
    "payments",
    "usage_snapshots",
    "platform_admins",
    "platform_audit_log",
  ]) {
    assert.ok(tables.includes(t), t);
  }
});

test("every table has row level security", () => {
  const enabled = new Set([
    ...arrayAfter("-- Tables platform admins read and write directly."),
    ...[...sql.matchAll(/alter table public\.(\w+) enable row level security/g)].map((m) => m[1]),
  ]);
  for (const t of tables) assert.ok(enabled.has(t), `${t} has no RLS`);
});

test("every table except the log itself is audited", () => {
  const audited = arrayAfter("-- ── Triggers");
  for (const t of tables.filter((name) => name !== "platform_audit_log")) assert.ok(audited.includes(t), `${t} is not audited`);
});

test("anon is granted nothing", () => {
  for (const statement of sql.split(";")) {
    if (/^\s*grant\b/im.test(statement)) assert.doesNotMatch(statement, /\banon\b/, statement.trim());
  }
});

test("tenant status, language and slug rules match lib/tenants.ts", () => {
  const status = sql.match(/status in \(('provisioning'[^)]*)\)/);
  assert.deepEqual(quotedList(status[1]), [...TENANT_STATUSES]);
  const language = sql.match(/language in \(([^)]*)\)/);
  assert.deepEqual(quotedList(language[1]), [...TENANT_LANGUAGES]);
  assert.ok(sql.includes(`slug ~ '${SLUG_PATTERN.source}'`), "slug pattern differs");
});

test("no secret value column: secrets live in Vault", () => {
  const block = sql.slice(sql.indexOf("create table if not exists public.tenant_secrets"));
  const columns = block.slice(0, block.indexOf(");"));
  assert.match(columns, /vault_secret_id uuid not null/);
  assert.doesNotMatch(columns, /\b(value|secret|key_value)\s+text/);
});

test("seeded modules are the ERP's modules (src/modules/*/manifest.ts)", () => {
  const modulesDir = new URL("../../src/modules/", import.meta.url);
  const erp = readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/manifest.ts`, modulesDir)))
    .map((d) => readFileSync(new URL(`${d.name}/manifest.ts`, modulesDir), "utf8").match(/id:\s*"([a-z-]+)"/)[1])
    .sort();
  const seed = sql.slice(sql.indexOf("insert into public.modules"));
  const seeded = [...seed.matchAll(/\('([a-z-]+)', '/g)].map((m) => m[1]).sort();
  assert.deepEqual(seeded, erp);
});
