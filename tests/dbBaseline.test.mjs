// SaaS phase 1: the database baseline is generated from the production catalog and
// checked by scripts/db/compare-catalog.py. These tests need python3 and skip without it.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const python = ["python3", "python"].find(
  (cmd) => spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0,
);
const skip = python ? false : "python3 is not installed";
const live = "supabase/baseline/live-catalog.json";

function compare(a, b) {
  return spawnSync(python, ["scripts/db/compare-catalog.py", a, b], { encoding: "utf8" });
}

function tempCatalog(mutate) {
  const catalog = JSON.parse(readFileSync(live, "utf8"));
  mutate(catalog);
  const path = join(mkdtempSync(join(tmpdir(), "catalog-")), "fresh.json");
  writeFileSync(path, JSON.stringify(catalog));
  return path;
}

test("the snapshot matches itself", { skip }, () => {
  const result = compare(live, live);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No differences/);
});

test("a missing policy is reported", { skip }, () => {
  const fresh = tempCatalog((c) => c.policies.pop());
  const result = compare(live, fresh);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[policies\] missing in fresh DB/);
});

test("a changed function body is reported", { skip }, () => {
  const fresh = tempCatalog((c) => {
    c.functions[0].def += "-- changed\n";
  });
  const result = compare(live, fresh);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[functions\] differs/);
});

test("a NULL acl equals the explicit owner-only acl", { skip }, () => {
  const fresh = tempCatalog((c) => {
    const table = c.tables.find((t) => t.acl === null);
    if (table) table.acl = ["postgres=arwdDxtm/postgres"];
  });
  assert.equal(compare(live, fresh).status, 0);
});

test("re-created varchar check constraints compare equal", { skip }, () => {
  const fresh = tempCatalog((c) => {
    const con = c.constraints.find((x) => x.def.includes("::character varying, "));
    assert.ok(con, "snapshot has a varchar ANY(ARRAY) check");
    con.def = con.def
      .replace(/ANY \(\((ARRAY\[[^\]]*\])\)::text\[\]\)/, "ANY ($1)")
      .replace(/('(?:[^']|'')*'::character varying)/g, "($1)::text");
  });
  const result = compare(live, fresh);
  assert.equal(result.status, 0, result.stdout);
});
