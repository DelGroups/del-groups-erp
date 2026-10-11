// SaaS phase 2: menu, route permissions and the permission matrix come from module manifests.
// The generated structures must equal the hand-written ones they replaced
// (tests/fixtures/module-registry-baseline.json, captured from main before the registry).
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODULES,
  buildNavSections,
  moduleClosure,
  validateRegistry,
} from "../src/modules/registry.ts";
import { NAV_SECTIONS } from "../src/lib/navigation/navConfig.ts";
import {
  NAV_PATH_PERMISSIONS,
  ROUTE_RULES,
  getRequiredPermission,
} from "../src/lib/auth/routePermissions.ts";
import { GRANULAR_PERMISSION_MODULES } from "../src/lib/auth/permissionMatrix.ts";
import { allPermissionKeys } from "../src/types/database.types.ts";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/module-registry-baseline.json", import.meta.url), "utf8"));
const iconName = (icon) => icon.displayName || icon.name;

/** The old matcher: first hand-written rule that matches, in its original order. */
function baselinePermission(pathname) {
  for (const rule of baseline.routeRules) {
    if (rule.exact) {
      if (pathname === rule.prefix) return rule.permission;
      continue;
    }
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) return rule.permission;
  }
  return null;
}

// ── Generated == hand-written ───────────────────────────────────────────────

test("sidebar sections, items, order and icons are unchanged", () => {
  const actual = NAV_SECTIONS.map((s) => ({
    id: s.id,
    titleKey: s.titleKey,
    icon: iconName(s.icon),
    items: s.items.map((i) => ({
      titleKey: i.titleKey,
      path: i.path,
      icon: iconName(i.icon),
      ...(i.keywords ? { keywords: i.keywords } : {}),
    })),
  }));
  assert.deepEqual(actual, baseline.navSections);
});

test("with the barcode module switched off only its menu item disappears", () => {
  const withoutBarcode = baseline.navSections.map((s) => ({
    ...s,
    items: s.items.filter((i) => i.path !== "/settings/barcode").map((i) => i.path),
  }));
  const actual = buildNavSections(MODULES, () => false).map((s) => ({
    ...s,
    items: s.items.map((i) => i.path),
  }));
  assert.deepEqual(
    actual.map((s) => [s.id, s.items]),
    withoutBarcode.map((s) => [s.id, s.items])
  );
});

test("route rules are the same set", () => {
  const key = (r) => `${r.prefix}|${r.permission}|${r.exact ? "exact" : ""}`;
  assert.deepEqual(ROUTE_RULES.map(key).sort(), baseline.routeRules.map(key).sort());
});

test("every path gets the same required permission as before", () => {
  const probes = new Set(["/", "/unknown", "/settingsx", "/sales-old", "/inventory-audit/x", "/comissions/report/2026"]);
  for (const { prefix } of baseline.routeRules) {
    for (const suffix of ["", "/x", "/x/y", "-x", "x"]) probes.add(prefix + suffix);
  }
  for (const path of Object.keys(baseline.navPathPermissions)) probes.add(path);
  for (const path of probes) {
    assert.equal(getRequiredPermission(path), baselinePermission(path), path);
  }
});

test("nav path permissions are unchanged", () => {
  assert.deepEqual({ ...NAV_PATH_PERMISSIONS }, baseline.navPathPermissions);
});

test("role permission matrix is unchanged (ids, keys, labels, order, scopes)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(GRANULAR_PERMISSION_MODULES)), baseline.permissionMatrix);
});

// ── Registry rules ──────────────────────────────────────────────────────────

test("the real registry is valid, and every permission has exactly one owner", () => {
  assert.deepEqual(validateRegistry(MODULES, allPermissionKeys()), []);
});

test("dependencies are resolved transitively", () => {
  const closure = moduleClosure(MODULES, "payroll");
  for (const id of ["payroll", "hr", "accounting", "tax-az", "core"]) assert.ok(closure.has(id), id);
  assert.ok(!closure.has("sales"));
});

const clone = () => MODULES.map((m) => structuredClone(m));
const withModule = (id, patch) => clone().map((m) => (m.id === id ? { ...m, ...patch(m) } : m));
const expectError = (modules, pattern, keys) => {
  const errors = validateRegistry(modules, keys);
  assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in:\n${errors.join("\n")}`);
};

test("unknown dependency is an error", () => {
  expectError(withModule("crm", (m) => ({ depends: [...m.depends, "helpdesk"] })), /crm: unknown dependency "helpdesk"/);
});

test("dependency cycle is an error", () => {
  const modules = withModule("inventory", (m) => ({ depends: [...m.depends, "sales"] }));
  expectError(modules, /dependency cycle: .*inventory.*sales|dependency cycle: .*sales.*inventory/);
});

test("self-dependency and missing core dependency are errors", () => {
  expectError(withModule("studio", () => ({ depends: ["core", "studio"] })), /studio: depends on itself/);
  expectError(withModule("studio", () => ({ depends: [] })), /studio: must depend on "core"/);
});

test("a module missing from the registry is an error", () => {
  expectError(clone().filter((m) => m.id !== "barcode"), /module "barcode" has no manifest/);
});

test("permission ownership: duplicate, unowned and unknown keys", () => {
  expectError(withModule("crm", (m) => ({ permissions: [...m.permissions, "can_view_sales"] })), /"can_view_sales" is owned by both/);
  expectError(withModule("crm", (m) => ({ permissions: m.permissions.filter((p) => p !== "can_view_crm") })), /"can_view_crm" is not owned/, allPermissionKeys());
  expectError(withModule("crm", (m) => ({ permissions: [...m.permissions, "can_fly"] })), /"can_fly" .* does not exist/, allPermissionKeys());
});

test("a route may only use permissions of the module or its dependencies", () => {
  const modules = withModule("studio", (m) => ({
    routes: [...m.routes, { prefix: "/studio/sales", permission: "can_view_sales" }],
  }));
  expectError(modules, /studio: route \/studio\/sales uses "can_view_sales" of module "sales"/);
});

test("menus need a known section, a unique path and a route permission", () => {
  expectError(
    withModule("studio", (m) => ({ menus: [{ ...m.menus[0], section: "nowhere" }] })),
    /unknown section "nowhere"/
  );
  expectError(
    withModule("studio", (m) => ({ menus: [{ ...m.menus[0], path: "/sales", order: 999 }] })),
    /duplicate menu path "\/sales"/
  );
  expectError(
    withModule("studio", (m) => ({ menus: [...m.menus, { ...m.menus[0], path: "/studio-new", order: 999 }] })),
    /studio: \/studio-new has no route permission/
  );
});
