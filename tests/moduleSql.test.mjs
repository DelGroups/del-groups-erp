// SaaS phase 2: each module's part of the schema lives in supabase/modules/<id>/install.sql.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { MODULES, moduleClosure } from "../src/modules/registry.ts";

const dir = new URL("../supabase/modules/", import.meta.url);
const order = readFileSync(new URL("ORDER", dir), "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const ids = new Set(MODULES.map((m) => m.id));

test("ORDER lists known modules once, each after the modules it depends on", () => {
  assert.equal(new Set(order).size, order.length, "duplicates in ORDER");
  order.forEach((id, i) => {
    assert.ok(ids.has(id), `${id} is not a module in src/modules`);
    for (const dep of moduleClosure(MODULES, id)) {
      const at = order.indexOf(dep);
      if (dep !== id && at !== -1) assert.ok(at < i, `${dep} must come before ${id}`);
    }
  });
});

test("every module folder with SQL is in ORDER and has objects.json and install.sql", () => {
  const folders = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const folder of folders) {
    assert.ok(order.includes(folder), `supabase/modules/${folder} is not listed in ORDER`);
    assert.ok(existsSync(new URL(`${folder}/objects.json`, dir)), `${folder}/objects.json missing`);
    assert.ok(existsSync(new URL(`${folder}/install.sql`, dir)), `${folder}/install.sql missing (run scripts/db/generate-baseline.py)`);
  }
});

test("a module's tables are no longer in the core baseline", () => {
  const coreTables = readFileSync(new URL("../supabase/baseline/03_tables.sql", import.meta.url), "utf8");
  for (const id of order) {
    const { tables = [] } = JSON.parse(readFileSync(new URL(`${id}/objects.json`, dir), "utf8"));
    const install = readFileSync(new URL(`${id}/install.sql`, dir), "utf8");
    for (const table of tables) {
      assert.ok(!coreTables.includes(`create table if not exists public.${table} (`), `${table} still in baseline`);
      assert.ok(install.includes(`create table if not exists public.${table} (`), `${table} missing from ${id}/install.sql`);
    }
  }
});
