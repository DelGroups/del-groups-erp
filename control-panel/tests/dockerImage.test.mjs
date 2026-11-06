// SAAS-1: the control panel's Docker image can provision a tenant on its own. It must carry every
// SQL file provisioning and tenant migrations read (ERP_SQL_DIR=/app/supabase: baseline/, modules/,
// migrations/), and no migration may be silently skipped because of its file name.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { schemaFiles, baselineVersion } from "../lib/provisioning/plan.ts";
import { migrationFiles } from "../lib/migrations/plan.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SQL_DIR = path.join(ROOT, "supabase");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

test("the image copies baseline, modules and migrations and points ERP_SQL_DIR at them", () => {
  const dockerfile = read("control-panel/Dockerfile");
  for (const dir of ["baseline", "modules", "migrations"]) {
    assert.match(dockerfile, new RegExp(`^COPY supabase/${dir} \\./supabase/${dir}$`, "m"), `COPY supabase/${dir}`);
  }
  assert.match(dockerfile, /^ENV ERP_SQL_DIR=\/app\/supabase$/m);
  assert.match(dockerfile, /^WORKDIR \/app$/m);
  // The build context is cut down by Dockerfile.dockerignore: the three folders must stay in it.
  const ignore = read("control-panel/Dockerfile.dockerignore").split("\n").map((l) => l.trim());
  for (const dir of ["baseline", "modules", "migrations"]) assert.ok(ignore.includes(`!supabase/${dir}`), `!supabase/${dir} in the dockerignore`);
});

test("every migration file name is one provisioning applies (none skipped silently)", () => {
  const names = readdirSync(path.join(SQL_DIR, "migrations")).filter((f) => f.endsWith(".sql"));
  const odd = names.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
  assert.deepEqual(odd, [], "rename these: provisioning and tenant migrations only apply <14 digits>_<a-z0-9_>.sql");
  const prefixes = names.map((f) => f.slice(0, 14));
  assert.equal(new Set(prefixes).size, prefixes.length, "every migration has its own timestamp prefix");
});

test("a new tenant gets the baseline, every module's install script and every newer migration", () => {
  const version = baselineVersion(SQL_DIR);
  const newer = readdirSync(path.join(SQL_DIR, "migrations"))
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f) && f.slice(0, 14) > version)
    .sort();
  const order = read("supabase/modules/ORDER")
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
  for (const id of order) assert.ok(existsSync(path.join(SQL_DIR, "modules", id, "install.sql")), `modules/${id}/install.sql`);

  const files = schemaFiles(SQL_DIR, order).map((f) => path.basename(f.path));
  const migrations = files.filter((f) => /^\d{14}_/.test(f));
  assert.deepEqual(migrations, newer, "provisioning applies exactly the migrations newer than the baseline, in order");
  assert.ok(files.some((f) => /^\d{2}_[a-z_]+\.sql$/.test(f)), "baseline files first");
  // The newest migration in the repo (e.g. the latest imports or GL change) is part of it.
  assert.equal(migrations.at(-1), newer.at(-1));
  // Tenant migrations (the "Migrate" button) see the same files.
  assert.deepEqual(migrationFiles(SQL_DIR).map((f) => `${f.name}.sql`), newer);
});
