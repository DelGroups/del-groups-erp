// A module may import another module only if it depends on it (manifest `depends`).
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES, moduleClosure } from "../src/modules/registry.ts";

const root = fileURLToPath(new URL("../src/modules/", import.meta.url));

// Known imports against the dependency direction, each to be removed later. Do not add to this list:
// use a hook or a slot passed in by the route file (see SaleSavedHook, EmployeesPageTab) or erp_events.
const KNOWN = new Map([
  ["crm -> production", "CRM's 'send to production' (fails cleanly when production is off)"],
  ["payroll -> commissions", "unused PayrollModal"],
  ["purchases -> production", "type-only import of PurchaseRequest"],
]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function moduleImports() {
  const found = new Set();
  for (const { id } of MODULES) {
    let dir;
    try {
      dir = statSync(join(root, id)).isDirectory() ? join(root, id) : null;
    } catch {
      dir = null;
    }
    if (!dir) continue;
    for (const file of files(dir)) {
      for (const [, other] of readFileSync(file, "utf8").matchAll(/from ["']@\/modules\/([a-z-]+)/g)) {
        if (other !== id) found.add(`${id} -> ${other}`);
      }
    }
  }
  return found;
}

test("modules import only the modules they depend on", () => {
  for (const link of moduleImports()) {
    const [from, to] = link.split(" -> ");
    if (KNOWN.has(link)) continue;
    assert.ok(moduleClosure(MODULES, from).has(to), `${link}: ${from} does not depend on ${to}`);
  }
});

test("sales does not import commissions (commissions hooks into a saved sale instead)", () => {
  assert.ok(!moduleImports().has("sales -> commissions"));
});

test("the list of known exceptions holds no link that is gone or allowed", () => {
  const found = moduleImports();
  for (const link of KNOWN.keys()) {
    const [from, to] = link.split(" -> ");
    assert.ok(found.has(link), `${link} no longer exists: remove it from KNOWN`);
    assert.ok(!moduleClosure(MODULES, from).has(to), `${link} is a declared dependency now: remove it from KNOWN`);
  }
});
