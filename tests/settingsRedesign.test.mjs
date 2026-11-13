// SET-1: one list of settings pages, the app tab bar without a visible scrollbar, no SettingsTabs in
// the new shell, and the SETTINGS_V2 layout behind its flag.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COMPANY_V2_PATH,
  SETTINGS_GROUPS,
  SETTINGS_HOME,
  SETTINGS_ITEMS,
  filterSettingsItems,
  groupSettingsItems,
  settingsCrumbKeys,
  settingsItemForPath,
  visibleSettingsItems,
} from "../src/lib/settings/items.ts";
import { leaveTarget, sameValue } from "../src/lib/settings/form.ts";
import { isSettingsV2Enabled } from "../src/lib/features/settingsV2.ts";
import { replaceSectionItems, scrollLeftToReveal, tabScrollEdges } from "../src/lib/shell/shell.ts";
import { buildBreadcrumbsFromPath } from "../src/lib/navigation/breadcrumbs.ts";
import { MODULES } from "../src/modules/registry.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import { MAIN_ROUTES } from "../scripts/ui-guard.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");
const lookup = (messages, key) => key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), messages);

const ALL_FLAGS = { barcode: true, billing: true, newImports: true, docDateChange: true, lotTracking: true };
const admin = { can: () => true, isAdmin: true, isEnabled: () => true, newUi: true, flags: ALL_FLAGS };
const ids = (access) => visibleSettingsItems(access).map((i) => i.id);

// ── The one list ─────────────────────────────────────────────────────────────

test("every settings page is in the list once, in a known group, with az/en/ru names", () => {
  const seenIds = new Set();
  const seenPaths = new Set();
  const groups = new Set(SETTINGS_GROUPS.map((g) => g.id));
  for (const item of SETTINGS_ITEMS) {
    assert.ok(!seenIds.has(item.id) && !seenPaths.has(item.path), item.id);
    seenIds.add(item.id);
    seenPaths.add(item.path);
    assert.ok(groups.has(item.group), item.id);
    for (const messages of [azMessages, enMessages, ruMessages]) {
      assert.equal(typeof lookup(messages, item.titleKey), "string", item.titleKey);
      assert.equal(typeof lookup(messages, item.descriptionKey), "string", item.descriptionKey);
    }
  }
  for (const g of SETTINGS_GROUPS) for (const messages of [azMessages, enMessages, ruMessages]) assert.equal(typeof lookup(messages, g.titleKey), "string", g.titleKey);
  // The pages the audit found: all 18 (billing only with its flag).
  for (const id of ["company", "roles", "users", "commissions", "initial-setup", "backup", "barcode", "crm", "tax-payroll", "procurement", "ai", "studio", "modules", "activity-types", "stock-integrity", "audit", "imports", "billing"]) assert.ok(seenIds.has(id), id);
});

test("names are unique: no two settings pages (or the new CRM config page) share a name", () => {
  for (const messages of [azMessages, enMessages, ruMessages]) {
    const names = SETTINGS_ITEMS.map((i) => lookup(messages, i.titleKey));
    assert.equal(new Set(names).size, names.length);
    assert.ok(!names.includes(lookup(messages, "newShell.extra_crmConfig")), "CRM settings vs CRM config");
  }
});

test("permissions, admin, new shell, modules and flags filter the list", () => {
  assert.equal(ids(admin).length, SETTINGS_ITEMS.length);
  // Permission: the item's own permission.
  const noSettings = ids({ ...admin, isAdmin: false, can: (p) => p !== "can_manage_settings" });
  assert.deepEqual(noSettings, ["company", "users", "roles", "commissions"]);
  // Admin-only pages.
  const notAdmin = ids({ ...admin, isAdmin: false });
  for (const id of ["modules", "billing", "activity-types", "stock-integrity"]) assert.ok(!notAdmin.includes(id), id);
  // Classic shell: no new-UI-only pages.
  const classic = ids({ ...admin, newUi: false });
  assert.ok(!classic.includes("activity-types") && !classic.includes("imports"));
  // Module switched off.
  const noCrm = ids({ ...admin, isEnabled: (m) => m !== "crm" && m !== "tax-az" });
  assert.ok(!noCrm.includes("crm") && !noCrm.includes("tax-payroll") && noCrm.includes("company"));
  // Feature flags.
  const noFlags = ids({ ...admin, flags: { barcode: false, billing: false, newImports: false } });
  for (const id of ["barcode", "billing", "imports"]) assert.ok(!noFlags.includes(id), id);
});

test("with SETTINGS_V2 the company profile moves to its own address; the hub takes /settings", () => {
  assert.equal(visibleSettingsItems({ ...admin, v2: false }).find((i) => i.id === "company").path, SETTINGS_HOME);
  const v2 = visibleSettingsItems({ ...admin, v2: true });
  assert.equal(v2.find((i) => i.id === "company").path, COMPANY_V2_PATH);
  assert.equal(settingsItemForPath(v2, "/settings"), null, "the hub is no item");
  assert.equal(settingsItemForPath(v2, "/settings/roles/").id, "roles");
  assert.equal(settingsItemForPath(v2, "/users").id, "users");
  assert.equal(settingsItemForPath(visibleSettingsItems(admin), "/settings").id, "company");
});

test("module menus of the settings section use the list's paths, names and modules", () => {
  const byPath = new Map(SETTINGS_ITEMS.map((i) => [i.path, i]));
  for (const m of MODULES) {
    for (const menu of m.menus ?? []) {
      if (menu.section !== "settings") continue;
      const item = byPath.get(menu.path);
      assert.ok(item, `${menu.path} is in src/lib/settings/items.ts`);
      assert.equal(menu.label, item.titleKey, menu.path);
      if (item.module) assert.equal(m.id, item.module, menu.path);
    }
  }
});

test("every consumer reads the one list (shell, palette, SettingsTabs, hub, side menu, crumbs)", () => {
  assert.match(read("src/components/settings/SettingsTabs.tsx"), /useSettingsItems\(\)/);
  assert.doesNotMatch(read("src/components/settings/SettingsTabs.tsx"), /SETTINGS_TABS/);
  // The shell's Settings app (tab bar, launcher, command palette and phone drawer come from it).
  assert.match(read("src/components/shell/useShell.ts"), /useSettingsItems\(\)[\s\S]*replaceSectionItems/);
  assert.match(read("src/components/settings/v2/SettingsV2Page.tsx"), /useSettingsItems\(\)/);
  assert.match(read("src/components/settings/v2/SettingsHub.tsx"), /useSettingsItems\(\)/);
  assert.match(read("src/lib/navigation/breadcrumbs.ts"), /\.\.\.settingsCrumbKeys\(\)/);
  // useSettingsItems applies every rule SettingsTabs applied before SET-1.
  const hook = read("src/components/settings/useSettingsItems.ts");
  for (const part of [/can\(p as PermissionKey\)/, /isAdmin/, /newUi/, /isEnabled\(/, /isBarcodeModuleEnabled\(\)/, /billing: BILLING_PAGE/, /newImports/]) assert.match(hook, part);
});

test("crumbs of settings pages use the list's names; the first crumb is the Settings app", () => {
  const t = (key) => lookup(azMessages, key) ?? key;
  assert.deepEqual(
    buildBreadcrumbsFromPath("/settings/modules", t).map((c) => c.label),
    [azMessages.nav.sections.settings, azMessages.settingsNav.modules.title]
  );
  assert.equal(buildBreadcrumbsFromPath("/settings/activity-types", t).at(-1).label, azMessages.settingsNav.activityTypes.title);
  assert.equal(settingsCrumbKeys()[COMPANY_V2_PATH], "settingsNav.company.title");
});

test("hub search folds Azerbaijani and Russian letters and matches every word", () => {
  const items = visibleSettingsItems(admin).map((i) => ({ ...i, title: lookup(azMessages, i.titleKey), description: lookup(azMessages, i.descriptionKey), groupTitle: "" }));
  assert.deepEqual(filterSettingsItems(items, "İCAZƏLƏR").map((i) => i.id), ["roles"]);
  assert.ok(filterSettingsItems(items, "emekhaqqi").some((i) => i.id === "tax-payroll"), "ə → e");
  assert.equal(filterSettingsItems(items, "").length, items.length);
  assert.equal(filterSettingsItems(items, "zzzz").length, 0);
  assert.deepEqual(groupSettingsItems(items).map((g) => g.group.id), SETTINGS_GROUPS.map((g) => g.id));
});

// ── The shell ────────────────────────────────────────────────────────────────

test("the Settings app keeps its place among the apps and drops out with no items", () => {
  const sec = (id, items = [{ path: `/${id}`, titleKey: id, module: "core" }]) => ({ id, titleKey: id, items });
  const order = ["dashboard", "trade", "settings", "reports"];
  const settings = sec("settings", []);
  const items = [{ path: "/settings", titleKey: "x", module: "core" }];
  assert.deepEqual(replaceSectionItems([sec("dashboard"), sec("trade"), sec("reports")], order, settings, items).map((s) => s.id), order);
  assert.deepEqual(replaceSectionItems([sec("dashboard"), sec("settings"), sec("reports")], order, settings, []).map((s) => s.id), ["dashboard", "reports"]);
});

test("app tab bar: no visible scrollbar, arrows only where tabs are hidden, active tab scrolled into view", () => {
  const css = read("src/design-system/components.css");
  const block = css.slice(css.indexOf("[data-ds] .ds-tabbar-scroller {"), css.indexOf("[data-ds] .ds-tabbar-scroller::-webkit-scrollbar"));
  assert.match(block, /scrollbar-width: none/);
  assert.match(block, /overflow-x: auto/);
  assert.match(css, /\.ds-tabbar-scroller::-webkit-scrollbar \{\s*display: none;/);
  const shell = read("src/components/shell/NewShell.tsx");
  assert.match(shell, /<AppTabBar/);
  assert.doesNotMatch(shell, /appMenu[^\n]*overflow-x-auto/, "the old scrolling nav is gone");
  const bar = read("src/components/shell/AppTabBar.tsx");
  assert.match(bar, /querySelector<HTMLElement>\('\[aria-current="page"\]'\)/);
  assert.match(bar, /scrollLeftToReveal\(/);
  assert.match(bar, /addEventListener\("wheel"/);

  assert.deepEqual(tabScrollEdges(0, 500, 500), { start: false, end: false });
  assert.deepEqual(tabScrollEdges(0, 500, 900), { start: false, end: true });
  assert.deepEqual(tabScrollEdges(200, 500, 900), { start: true, end: true });
  assert.deepEqual(tabScrollEdges(400, 500, 900), { start: true, end: false });
  // Active tab past the right edge: scrolled so it shows with 32 px room; visible tab: unchanged.
  assert.equal(scrollLeftToReveal(1200, 100, 0, 1000), 332);
  assert.equal(scrollLeftToReveal(100, 80, 0, 1000), 0);
  assert.equal(scrollLeftToReveal(20, 80, 300, 1000), 0);
});

test("no SettingsTabs inside the new shell; the classic shell keeps them", () => {
  const tabs = read("src/components/settings/SettingsTabs.tsx");
  assert.match(tabs, /const \{ active: newShell \} = useNewUi\(\);/);
  assert.match(tabs, /if \(newShell\) return null;/);
});

// ── SETTINGS_V2 ──────────────────────────────────────────────────────────────

test("SETTINGS_V2 is off unless set to true, and only counts in the new shell", () => {
  assert.equal(isSettingsV2Enabled({}), false);
  assert.equal(isSettingsV2Enabled({ SETTINGS_V2: "1" }), false);
  assert.equal(isSettingsV2Enabled({ SETTINGS_V2: " TRUE " }), true);
  assert.match(read("src/app/layout.tsx"), /settingsV2 = isSettingsV2Enabled\(\)/);
  assert.match(read("src/components/settings/useSettingsItems.ts"), /const v2 = newUi && settingsV2;/);
  // Hidden app tab bar for Settings only while the flag is on.
  assert.match(read("src/components/shell/NewShell.tsx"), /!\(settingsV2 && current\.id === "settings"\)/);
});

const PAGES = {
  "src/app/settings/page.client.tsx": "company",
  "src/app/settings/roles/page.client.tsx": "roles",
  "src/app/users/page.client.tsx": "users",
  "src/app/settings/initial-setup/page.client.tsx": "initial-setup",
  "src/app/settings/backup/page.client.tsx": "backup",
  "src/app/settings/barcode/page.client.tsx": "barcode",
  "src/app/settings/tax-payroll/page.client.tsx": "tax-payroll",
  "src/app/settings/ai/page.client.tsx": "ai",
  "src/app/settings/studio/page.client.tsx": "studio",
  "src/app/settings/modules/page.client.tsx": "modules",
  "src/app/settings/billing/page.client.tsx": "billing",
  "src/app/settings/activity-types/page.client.tsx": "activity-types",
  "src/app/settings/audit/page.client.tsx": "audit",
  "src/modules/crm/components/CrmSettingsPage.tsx": "crm",
  "src/modules/purchases/components/ProcurementSettingsPage.tsx": "procurement",
  "src/modules/inventory/components/StockIntegrityPage.tsx": "stock-integrity",
};

test("SETTINGS_V2 off = the old layout: every page still renders its SettingsTabs and old header", () => {
  for (const [path, id] of Object.entries(PAGES)) {
    const src = read(path);
    assert.match(src, new RegExp(`<SettingsTabs activeTab="${id}" />`), path);
    // The new frame is only reached through the flag.
    if (id !== "company") assert.match(src, /if \(settingsV2\) \{|if \(settingsV2\)/, path);
  }
  assert.match(read("src/app/settings/page.client.tsx"), /useSettingsV2\(\) \? <SettingsHub \/> : <CompanyProfileClassic \/>/);
  assert.match(read("src/app/settings/company/page.client.tsx"), /useSettingsV2\(\) \? <CompanyProfileV2 \/> : <CompanyProfileClassic \/>/);
  assert.match(read("src/modules/commissions/components/CommissionRulesPage.tsx"), /if \(settingsV2\)/);
  assert.match(read("src/modules/imports/components/ImportSettingsScreen.tsx"), /if \(settingsV2\)/);
});

test("forms with SETTINGS_V2 save through one sticky bar and warn before leaving", () => {
  for (const path of ["src/components/settings/v2/CompanyProfileV2.tsx", "src/app/settings/tax-payroll/page.client.tsx", "src/modules/purchases/components/ProcurementSettingsPage.tsx", "src/modules/crm/components/CrmSettingsPage.tsx", "src/modules/imports/components/ImportSettingsScreen.tsx"]) {
    const src = read(path);
    assert.match(src, /<SettingsSaveBar /, path);
    assert.match(src, /useUnsavedChangesGuard\(dirty\)/, path);
  }
  assert.match(read("src/components/settings/v2/SettingsSaveBar.tsx"), /erp-sticky-actions/);
  assert.ok(sameValue({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }));
  assert.ok(!sameValue({ a: 1 }, { a: 2 }));
  assert.ok(!sameValue([1, 2], [2, 1]));
});

test("unsaved-changes guard stops in-app links only", () => {
  const here = { origin: "https://erp.test", pathname: "/settings/tax-payroll", search: "" };
  const click = { button: 0, modified: false, defaultPrevented: false };
  const a = (href, extra = {}) => ({ href, ...extra });
  assert.equal(leaveTarget(a("https://erp.test/settings/roles"), click, here), "/settings/roles");
  assert.equal(leaveTarget(a("/users?x=1#top"), click, here), "/users?x=1#top");
  assert.equal(leaveTarget(a("https://erp.test/settings/tax-payroll#a"), click, here), null, "same page");
  assert.equal(leaveTarget(a("https://other.test/"), click, here), null, "other site");
  assert.equal(leaveTarget(a("/users", { target: "_blank" }), click, here), null);
  assert.equal(leaveTarget(a("/file.csv", { download: true }), click, here), null);
  assert.equal(leaveTarget(a("/users"), { ...click, modified: true }, here), null);
  assert.equal(leaveTarget(a("/users"), { ...click, button: 1 }, here), null);
  assert.equal(leaveTarget(null, click, here), null);
});

test("new settings texts exist in az, en and ru", () => {
  const keys = (node, prefix = "") => Object.entries(node).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const az = keys(azMessages.settingsNav).sort();
  assert.deepEqual(keys(enMessages.settingsNav).sort(), az);
  assert.deepEqual(keys(ruMessages.settingsNav).sort(), az);
  for (const k of ["tabsScrollBack", "tabsScrollForward"]) for (const m of [azMessages, enMessages, ruMessages]) assert.equal(typeof m.newShell[k], "string");
});

test("ui-guard checks the settings pages", () => {
  for (const route of ["/settings", "/settings/company", "/users", "/settings/roles", "/settings/audit", "/settings/modules", "/settings/tax-payroll"]) assert.ok(MAIN_ROUTES.includes(route), route);
});
