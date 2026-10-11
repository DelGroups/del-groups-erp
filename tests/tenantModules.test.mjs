// SaaS phase 2: a tenant has only some modules (table tenant_modules).
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstDisabledModule,
  ModuleDisabledError,
  moduleForAiTool,
  moduleForPath,
  moduleForPermission,
  modulesToEnable,
  moduleStates,
  notInPlanBody,
  resolveEnabledModules,
} from "../src/modules/enabled.ts";
import { MODULES } from "../src/modules/registry.ts";
import { MODULE_IDS } from "../src/modules/types.ts";
import { isToolInPlan, runTool, toolsForProfile } from "../src/lib/ai/native/tools.ts";
import { NAV_SECTIONS } from "../src/lib/navigation/navConfig.ts";

const off = (...ids) => ids.map((module_id) => ({ module_id, enabled: false }));
const all = new Set(MODULE_IDS);

test("before the migration (no table) and with every row enabled, every module is on", () => {
  assert.deepEqual(resolveEnabledModules(null), all);
  assert.deepEqual(resolveEnabledModules([]), all, "a module without a row is enabled");
  assert.deepEqual(resolveEnabledModules(MODULE_IDS.map((module_id) => ({ module_id, enabled: true }))), all);
});

test("a disabled module is off; core can never be disabled; unknown rows are ignored", () => {
  const enabled = resolveEnabledModules([...off("crm", "core"), { module_id: "helpdesk", enabled: true }]);
  assert.equal(enabled.has("crm"), false);
  assert.equal(enabled.has("core"), true);
  assert.equal(enabled.has("sales"), true);
});

test("an enabled module keeps its dependencies on", () => {
  // inventory is disabled, but sales (enabled) depends on it
  const enabled = resolveEnabledModules(off("inventory"));
  assert.equal(enabled.has("inventory"), true);
  assert.equal(moduleStates(off("inventory")).inventory, "required");

  // once nothing enabled needs it, it really is off
  const dependents = MODULES.filter((m) => m.depends.includes("inventory")).map((m) => m.id);
  const rows = off("inventory", ...dependents, "payroll", "commissions", "contracts", "crm");
  const narrowed = resolveEnabledModules(rows);
  assert.equal(narrowed.has("inventory"), false, [...narrowed].join(","));
  assert.equal(moduleStates(rows).inventory, "disabled");
});

test("contracts are always on together with sales and purchases", () => {
  // Turning contracts off while sales or purchases are on has no effect.
  assert.equal(resolveEnabledModules(off("contracts")).has("contracts"), true);
  assert.equal(moduleStates(off("contracts")).contracts, "required");
  assert.equal(resolveEnabledModules(off("contracts", "sales")).has("contracts"), true, "purchases still needs it");
  assert.ok(modulesToEnable("sales").includes("contracts"));
  assert.ok(modulesToEnable("purchases").includes("contracts"));

  // Only with sales, purchases and everything needing them off can contracts be off.
  const needsContracts = MODULES.filter((m) => m.id !== "contracts" && modulesToEnable(m.id).includes("contracts")).map((m) => m.id);
  const enabled = resolveEnabledModules(off("contracts", ...needsContracts));
  assert.equal(enabled.has("contracts"), false, [...enabled].join(","));
});

test("enabling a module lists its dependencies too", () => {
  assert.deepEqual(new Set(modulesToEnable("payroll")), new Set(["payroll", "hr", "accounting", "tax-az", "core"]));
  assert.deepEqual(new Set(modulesToEnable("core")), new Set(["core"]));
});

test("pages map to the module that owns them", () => {
  assert.equal(moduleForPath("/crm"), "crm");
  assert.equal(moduleForPath("/crm/deals/1"), "crm");
  assert.equal(moduleForPath("/settings/crm"), "crm");
  assert.equal(moduleForPath("/settings"), "core");
  assert.equal(moduleForPath("/settings/modules"), "core");
  assert.equal(moduleForPath("/sales/polywood/new"), "polywood");
  assert.equal(moduleForPath("/sales/123"), "sales");
  assert.equal(moduleForPath("/comissions/report"), "commissions");
  assert.equal(moduleForPath("/"), "core");
  assert.equal(moduleForPath("/not-in-plan"), null);
});

test("permissions and AI tools map to their module", () => {
  assert.equal(moduleForPermission("can_view_crm"), "crm");
  assert.equal(moduleForPermission("can_view_sales"), "sales");
  assert.equal(moduleForPermission("can_manage_settings"), "core");
  assert.equal(moduleForAiTool("list_sales"), "sales");
  assert.equal(moduleForAiTool("production_orders"), "production");
  assert.equal(moduleForAiTool("unknown_tool"), null);
});

test("action guard: the first disabled module is reported, as ModuleDisabledError", () => {
  const enabled = resolveEnabledModules(off("crm"));
  assert.equal(firstDisabledModule(enabled, ["core", "crm"]), "crm");
  assert.equal(firstDisabledModule(enabled, [null, "sales", undefined]), null);
  const error = new ModuleDisabledError("crm");
  assert.ok(error instanceof Error);
  assert.equal(error.module, "crm");
  assert.match(error.message, /planınıza daxil deyil/);
});

test("API guard answers 403 not_in_plan with the module id", () => {
  assert.deepEqual(notInPlanBody("barcode"), {
    status: 403,
    body: { error: "not_in_plan", module: "barcode", message: "Bu modul planınıza daxil deyil" },
  });
});

test("menu items carry their module, so a disabled module's items can be dropped", () => {
  const enabled = resolveEnabledModules(off("crm", "production"));
  const visible = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => enabled.has(i.module)).map((i) => i.path);
  for (const path of ["/crm", "/settings/crm", "/production", "/production/bom"]) assert.ok(!visible.includes(path), path);
  for (const path of ["/", "/sales", "/customers", "/settings"]) assert.ok(visible.includes(path), path);
});

const admin = { role: { name: "Admin", permissions: {} } };

test("AI tools of a disabled module are not offered", () => {
  const names = (enabled) => toolsForProfile(admin, enabled).map((t) => t.name);
  assert.ok(names(all).includes("list_sales"));
  const withoutSales = resolveEnabledModules(off("sales", "crm", "contracts", "consignment", "commissions", "polywood"));
  assert.equal(withoutSales.has("sales"), false);
  assert.ok(!names(withoutSales).includes("list_sales"));
  assert.ok(!names(withoutSales).includes("get_sale"));
  assert.ok(names(withoutSales).includes("search_products"), "core tools stay");
  assert.equal(isToolInPlan("production_orders", resolveEnabledModules(off("production"))), false);
});

test("AI cannot run a tool of a disabled module even if it asks for it", async () => {
  const result = await runTool("production_orders", {}, {
    client: {
      from() {
        throw new Error("must not touch the database");
      },
    },
    profile: admin,
    enabledModules: resolveEnabledModules(off("production")),
  });
  assert.equal(result.isError, true);
  assert.match(result.content, /not in the company's plan/);
});
