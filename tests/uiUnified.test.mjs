// UI-7 phase 2: the UI rulebook's foundations behind UI_UNIFIED (docs/ui-standard.md): the flag and
// its audience, the app side menu's groups, App › Page › Record crumbs and the back target, the
// shared components' logic, the --app-* aliases, the new lint categories and the page checks.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isUiUnifiedEnabled, uiUnifiedActive, uiUnifiedAudience } from "../src/lib/features/uiUnified.ts";
import { APP_MENU_GROUPS, groupAppItems, parseCollapsed, showsAppMenu } from "../src/lib/shell/appMenu.ts";
import { SETTINGS_ITEMS } from "../src/lib/settings/items.ts";
import { SHELL_EXTRA_ITEMS, SHELL_HOME, appCrumbs, parentCrumbHref } from "../src/lib/shell/shell.ts";
import { MAX_SECONDARY_ACTIONS, leaveTarget, rovingIndex, splitHeaderActions } from "../src/design-system/logic.ts";
import { leaveTarget as settingsLeaveTarget } from "../src/lib/settings/form.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";
import { UI_GUARD_RULES, countViolations, scanSources } from "../scripts/ui-guard-rules.mjs";
import { findPageIssues, findUnifiedIssues } from "../scripts/ui-page-checks.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");
const lookup = (messages, key) => key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), messages);
const baseline = JSON.parse(read("tests/fixtures/module-registry-baseline.json"));
const LOCALES = [
  ["az", azMessages],
  ["en", enMessages],
  ["ru", ruMessages],
];
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);

// ── Flag ─────────────────────────────────────────────────────────────────────

test("UI_UNIFIED is off unless \"true\"; the audience is admins unless \"all\"", () => {
  assert.equal(isUiUnifiedEnabled({}), false);
  assert.equal(isUiUnifiedEnabled({ UI_UNIFIED: "1" }), false);
  assert.equal(isUiUnifiedEnabled({ UI_UNIFIED: " TRUE " }), true);
  assert.equal(uiUnifiedAudience({}), "admins");
  assert.equal(uiUnifiedAudience({ UI_UNIFIED_AUDIENCE: "everyone" }), "admins");
  assert.equal(uiUnifiedAudience({ UI_UNIFIED_AUDIENCE: "All" }), "all");
});

test("the unified UI shows only in the new shell, to admins unless the audience is all", () => {
  const base = { enabled: true, audience: "admins", shellActive: true, isAdmin: true, authReady: true };
  assert.equal(uiUnifiedActive(base), true);
  assert.equal(uiUnifiedActive({ ...base, enabled: false }), false, "flag off");
  assert.equal(uiUnifiedActive({ ...base, shellActive: false }), false, "classic shell");
  assert.equal(uiUnifiedActive({ ...base, isAdmin: false }), false, "not an admin");
  assert.equal(uiUnifiedActive({ ...base, authReady: false }), false, "admins only: never before sign-in is known");
  assert.equal(uiUnifiedActive({ ...base, audience: "all", isAdmin: false, authReady: false }), true);
});

test("the flag reaches the client like the other server flags, and the env example lists it", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /uiUnified = \{ enabled: isUiUnifiedEnabled\(\), audience: uiUnifiedAudience\(\) \}/);
  assert.equal((layout.match(/newHome, uiUnified \}/g) ?? []).length, 2, "both server values carry it");
  const provider = read("src/components/shell/NewUiProvider.tsx");
  assert.match(provider, /uiUnified: uiUnifiedActive\(/);
  assert.match(provider, /export function useUiUnified\(\)/);
  const env = read(".env.saas.example");
  assert.match(env, /^UI_UNIFIED=$/m);
  assert.match(env, /^UI_UNIFIED_AUDIENCE=$/m);
});

// ── App side menu (NAV-1) ────────────────────────────────────────────────────

test("every page of a grouped app is in exactly one group, and group names exist in az/en/ru", () => {
  for (const section of baseline.navSections) {
    const defs = APP_MENU_GROUPS[section.id];
    if (!defs || section.id === "settings") continue;
    const extras = SHELL_EXTRA_ITEMS.filter((e) => e.section === section.id).map((e) => ({ path: e.path }));
    const items = [...section.items.map((i) => ({ path: i.path })), ...extras];
    const groups = groupAppItems(section.id, items);
    assert.ok(groups.every((g) => g.id !== null), `${section.id}: a page has no group: ${groups.find((g) => g.id === null)?.items.map((i) => i.path)}`);
    const placed = groups.flatMap((g) => g.items.map((i) => i.path));
    assert.deepEqual([...placed].sort(), items.map((i) => i.path).sort(), `${section.id}: every page once`);
  }
  for (const defs of Object.values(APP_MENU_GROUPS)) {
    for (const def of defs) {
      for (const [name, messages] of LOCALES) assert.equal(typeof lookup(messages, def.titleKey), "string", `${name} ${def.titleKey}`);
    }
  }
});

test("groups keep the app's order; unknown pages come first without a heading; Settings uses its own groups", () => {
  const items = [{ path: "/purchases" }, { path: "/new-page" }, { path: "/sales" }, { path: "/contracts" }];
  const groups = groupAppItems("trade", items);
  assert.deepEqual(
    groups.map((g) => [g.id, g.items.map((i) => i.path)]),
    [
      [null, ["/new-page"]],
      ["sales", ["/sales", "/contracts"]],
      ["purchases", ["/purchases"]],
    ]
  );
  assert.deepEqual(groupAppItems("production", [{ path: "/production" }, { path: "/production/bom" }]).map((g) => g.id), [null], "no groups: one list");
  const settings = SETTINGS_ITEMS.slice(0, 4).map((i) => ({ path: i.path, group: i.group }));
  const sg = groupAppItems("settings", [{ path: "/settings" }, ...settings]);
  assert.equal(sg[0].id, null, "the hub leads without a heading");
  assert.ok(sg.slice(1).every((g) => g.items.every((i) => i.group === g.id)));
});

test("the side menu shows for apps with two or more pages, never on Home or the launcher", () => {
  const base = { appId: "inventory", itemCount: 8, pathname: "/products", settingsV2: false };
  assert.equal(showsAppMenu(base), true);
  assert.equal(showsAppMenu({ ...base, itemCount: 1 }), false);
  assert.equal(showsAppMenu({ ...base, appId: null }), false);
  assert.equal(showsAppMenu({ ...base, appId: "dashboard", pathname: "/" }), false);
  assert.equal(showsAppMenu({ ...base, pathname: "/apps/" }), false);
  assert.equal(showsAppMenu({ ...base, appId: "settings", pathname: "/settings/roles", settingsV2: true }), false, "SETTINGS_V2 draws its own until phase 3");
  assert.equal(showsAppMenu({ ...base, appId: "settings", pathname: "/settings/roles", settingsV2: false }), true);
  assert.equal(parseCollapsed("1"), true);
  assert.equal(parseCollapsed(null), false);
});

test("with UI_UNIFIED the shell has no app tabs, the side menu and crumbs come from the page list", () => {
  const shell = read("src/components/shell/NewShell.tsx");
  assert.match(shell, /\{!uiUnified && current && current\.items\.length > 1/, "app tab bar only without the flag");
  assert.match(shell, /useBreadcrumbTrail\(uiUnified \? crumbsFor : undefined\)/);
  assert.match(shell, /<AppSideMenu app=\{current\}/);
  assert.match(shell, /uiUnified \? "ds-btn ds-btn-sm" : "ds-btn ds-btn-primary ds-btn-sm"/, "ACT-2: quick actions are not primary");
  assert.match(shell, /parentCrumbHref\(crumbs, pathname\)/, "NAV-4: back to the parent crumb");
  assert.match(shell, /root\.setAttribute\(UI_UNIFIED_ATTR, ""\)/);
});

// ── Breadcrumbs and back (NAV-2, NAV-4) ──────────────────────────────────────

const trade = { title: "Ticarət", href: "/sales" };
const sales = { path: "/sales", title: "Satış" };

test("crumbs are App › Page › Record; the last crumb is the current page without a link", () => {
  assert.deepEqual(appCrumbs({ app: trade, item: sales, pathname: "/sales", t }), [{ label: "Ticarət", href: "/sales" }, { label: "Satış" }]);
  assert.deepEqual(appCrumbs({ app: trade, item: sales, pathname: "/sales/new/", t }), [
    { label: "Ticarət", href: "/sales" },
    { label: "Satış", href: "/sales" },
    { label: "invoice.newSaleTitle" },
  ]);
  const record = appCrumbs({ app: trade, item: sales, pathname: "/sales/7f0c2f9e-1d2b-4c3a-9e8f-0a1b2c3d4e5f", t });
  assert.equal(record.length, 3);
  assert.match(record[2].label, /^breadcrumb\.saleDocument/);
  assert.equal(record[2].href, undefined);
  assert.deepEqual(appCrumbs({ app: null, item: null, pathname: "/apps", t }), [], "no app, no crumbs");
});

test("back goes to the nearest other page above, and from an app's first page to the launcher", () => {
  const list = appCrumbs({ app: trade, item: sales, pathname: "/sales", t });
  assert.equal(parentCrumbHref(list, "/sales"), SHELL_HOME, "app crumb links to this same page");
  const form = appCrumbs({ app: trade, item: sales, pathname: "/sales/new", t });
  assert.equal(parentCrumbHref(form, "/sales/new"), "/sales");
  const counts = appCrumbs({ app: { title: "Anbar", href: "/products" }, item: { path: "/inventory/counts", title: "İnventarizasiya" }, pathname: "/inventory/counts/42", t });
  assert.equal(parentCrumbHref(counts, "/inventory/counts/42"), "/inventory/counts");
  assert.equal(parentCrumbHref(appCrumbs({ app: { title: "Anbar", href: "/products" }, item: { path: "/inventory/counts", title: "İ" }, pathname: "/inventory/counts", t }), "/inventory/counts"), "/products");
});

// ── Shared components (logic) ────────────────────────────────────────────────

test("tabs and segmented controls: arrows wrap and skip disabled items, Home/End, RTL swaps arrows", () => {
  const none = [false, false, false];
  assert.equal(rovingIndex(0, "ArrowRight", none), 1);
  assert.equal(rovingIndex(2, "ArrowRight", none), 0);
  assert.equal(rovingIndex(0, "ArrowLeft", none), 2);
  assert.equal(rovingIndex(0, "ArrowRight", [false, true, false]), 2, "skips a disabled tab");
  assert.equal(rovingIndex(1, "Home", [true, false, false]), 1, "first enabled");
  assert.equal(rovingIndex(0, "End", [false, false, true]), 1, "last enabled");
  assert.equal(rovingIndex(0, "ArrowRight", none, true), 2, "rtl");
  assert.equal(rovingIndex(0, "Enter", none), null);
  assert.equal(rovingIndex(0, "ArrowRight", [true, true]), null);
});

test("page header: at most two visible secondaries, the rest and all on phones go into the menu", () => {
  assert.equal(MAX_SECONDARY_ACTIONS, 2);
  const s = splitHeaderActions(["a", "b", "c"], ["m"]);
  assert.deepEqual(s, { visible: ["a", "b"], overflow: ["c"], more: ["m"] });
  assert.deepEqual(splitHeaderActions(["a", "b"], [], true), { visible: [], overflow: ["a", "b"], more: [] });
  const header = read("src/design-system/components/PageHeader.tsx");
  assert.doesNotMatch(header, /\bback(Href|Label)?\??:/, "NAV-4: no back link in the page header");
  assert.match(header, /useClaimCrumbs\(showCrumbs\)/, "the header claims the shell's crumbs");
  assert.match(header, /data-ui-page=""/, "PageFrame marks migrated pages for ui:guard");
});

test("the unsaved-changes guard keeps one link rule, shared with Settings", () => {
  assert.equal(settingsLeaveTarget, leaveTarget);
  const here = { origin: "https://erp.test", pathname: "/settings/roles", search: "" };
  const click = { button: 0, modified: false, defaultPrevented: false };
  assert.equal(leaveTarget({ href: "https://erp.test/sales?x=1" }, click, here), "/sales?x=1");
  assert.equal(leaveTarget({ href: "https://erp.test/settings/roles#a" }, click, here), null, "same page");
  assert.equal(leaveTarget({ href: "https://other.test/" }, click, here), null);
  assert.equal(leaveTarget({ href: "https://erp.test/sales", target: "_blank" }, click, here), null);
  assert.equal(leaveTarget({ href: "https://erp.test/sales" }, { ...click, modified: true }, here), null);
});

test("dialogs are Radix with a named close button, fixed header/footer and Cancel focused in confirms", () => {
  const dialog = read("src/design-system/components/Dialog.tsx");
  assert.match(dialog, /@radix-ui\/react-dialog/);
  assert.match(dialog, /<RadixDialog\.Close className="ds-icon-btn" aria-label=\{labels\.close\}/);
  assert.match(dialog, /ds-dialog-header[\s\S]*ds-dialog-body[\s\S]*ds-dialog-footer/);
  assert.match(dialog, /initialFocusRef=\{cancelRef\}/);
  const css = read("src/design-system/components.css");
  assert.match(css, /\.ds-dialog-body \{[^}]*overflow-y: auto/);
  assert.match(css, /\.ds-dialog \{[^}]*max-height: calc\(100dvh - 2rem\)/);
  const bar = read("src/design-system/components/FormSaveBar.tsx");
  assert.match(bar, /erp-sticky-actions ds-savebar/);
  const index = read("src/design-system/components/index.ts");
  for (const name of ["Button", "PageHeader", "PageFrame", "Breadcrumbs", "Tabs", "SegmentedControl", "Dialog", "Drawer", "ConfirmDialog", "FormSaveBar", "useUnsavedChangesGuard", "ErrorState", "LoadingState"]) {
    assert.match(index, new RegExp(`\\b${name}\\b`), `${name} exported`);
  }
});

// ── Texts (TXT-1…3) ──────────────────────────────────────────────────────────

test("every uiUnified text exists in az, en and ru; ru is translated; az/en are sentence case", () => {
  const keys = (node, prefix = "") => Object.entries(node).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
  const azKeys = keys(azMessages.uiUnified);
  assert.ok(azKeys.length > 40);
  for (const [name, messages] of LOCALES) assert.deepEqual(keys(messages.uiUnified).sort(), [...azKeys].sort(), `${name} has the same keys`);
  for (const key of azKeys) {
    const az = lookup(azMessages.uiUnified, key);
    const ru = lookup(ruMessages.uiUnified, key);
    if (!/^lab\.record$/.test(key)) assert.notEqual(ru, az, `ru.${key} is translated`);
    for (const [name, messages] of [["az", azMessages], ["en", enMessages]]) {
      const text = lookup(messages.uiUnified, key).replace(/\{[^}]+\}/g, "x");
      const later = text.split(/\s+/).slice(1).filter((w) => /^\p{Lu}\p{Ll}/u.test(w));
      assert.deepEqual(later, [], `${name}.uiUnified.${key} is sentence case: "${text}"`);
    }
  }
});

// ── Tokens (TOK-1, TOK-2) ────────────────────────────────────────────────────

test("every --app-* colour has a --ds-* alias under UI_UNIFIED, and the font is Inter", () => {
  const globals = read("src/app/globals.css");
  const appTokens = new Set([...globals.matchAll(/^\s*(--app-[a-z0-9-]+):/gm)].map((m) => m[1]));
  const css = read("src/design-system/ui-unified.css");
  assert.ok(appTokens.size >= 30);
  for (const token of appTokens) assert.match(css, new RegExp(`${token}: [^;]*var\\(--ds-|${token}: none`), `${token} aliased`);
  assert.match(css, /html\[data-ui-unified\] body[\s\S]*font-family: var\(--font-sans\), "Inter"/);
  assert.match(read("src/design-system/index.css"), /@import "\.\/ui-unified\.css";/);
});

// ── Lint categories (rulebook) ───────────────────────────────────────────────

test("the rulebook lint categories count what they forbid, and not the standard parts", () => {
  const n = (text, category) => countViolations(text, category);
  assert.equal(n('window.confirm("x"); alert("y"); obj.alert(1); confirmDelete()', "windowDialog"), 2);
  assert.equal(n('<div className="app-modal-backdrop app-modal" />', "appModal"), 1);
  assert.equal(n('"fixed inset-0 z-50" "fixed inset-0"', "fixedOverlay"), 2);
  assert.equal(n('"text-[10px] text-[11px] text-[12px]"', "tinyText"), 2);
  assert.equal(n('"font-bold uppercase" // toUpperCase()', "uppercase"), 1);
  assert.equal(n('"btn-primary ds-btn-primary bg-gradient-to-r" "--app-gradient"', "legacyButton"), 2, "ds-btn-primary and the token are allowed");
  assert.equal(n('"text-rose-500 hover:bg-emerald-50 ds-muted"', "rawPalette"), 2);
  assert.equal(n('import ToastMessage from "@/components/ui/ToastMessage";', "toastMessage"), 1);
  assert.equal(n("<h1 className='x'>t</h1><h2>", "rawH1"), 1);
  assert.equal(n('<button role="tab">', "rawTabRole"), 1);
  assert.deepEqual(scanSources([["src/design-system/components/PageHeader.tsx", "<h1>"]]).rawH1, {}, "the design system builds the h1");
  assert.deepEqual(scanSources([["src/components/print/A.tsx", '"uppercase text-[10px]"']]).uppercase, {}, "print layouts are exempt");
});

test("the rulebook allowlist totals may only go down", () => {
  const allowlist = JSON.parse(read("scripts/ui-guard-allowlist.json"));
  // Totals when the categories were added (UI-7 phase 2, 2026-11-10).
  const CEILING = { windowDialog: 4, appModal: 44, fixedOverlay: 52, tinyText: 330, uppercase: 172, legacyButton: 63, rawPalette: 1056, toastMessage: 62, rawH1: 48, rawTabRole: 6 };
  for (const [category, max] of Object.entries(CEILING)) {
    assert.ok(UI_GUARD_RULES[category], `${category} is a rule`);
    const total = Object.values(allowlist[category] ?? {}).reduce((a, b) => a + b, 0);
    assert.ok(total <= max, `${category}: ${total} > ${max}`);
  }
  const mine = ["src/components/shell/AppSideMenu.tsx", "src/design-system/components/PageHeader.tsx", "src/design-system/components/Dialog.tsx", "src/app/dev/ui-lab/UnifiedLab.tsx"];
  for (const [category, files] of Object.entries(allowlist)) for (const file of mine) assert.equal(files[file], undefined, `${file} is new code: no ${category}`);
});

// ── Page checks (ui:guard) ───────────────────────────────────────────────────

test("ui:guard rulebook checks run only with the unified UI and flag each broken rule", () => {
  const ok = { path: "/sales", inApp: true, shellTabbar: false, crumbCount: 2, uiPage: true, h1Count: 1, h1InHeader: true, primaryCount: 1, toolbarTop: 200, smallTargets: [] };
  const m = (u, size = [1366, 768]) => ({ unified: u, viewportWidth: size[0], viewportHeight: size[1], pageScrollWidth: size[0], verticalScrollers: [] });
  assert.deepEqual(findUnifiedIssues(m(null)), [], "flag off: no rulebook checks");
  assert.deepEqual(findUnifiedIssues(m(ok)), []);
  const checks = (u, size) => findUnifiedIssues(m({ ...ok, ...u }, size)).map((i) => i.check);
  assert.deepEqual(checks({ shellTabbar: true }), ["shell-tabbar"]);
  assert.deepEqual(checks({ crumbCount: 0 }), ["breadcrumbs"]);
  assert.deepEqual(checks({ crumbCount: 0, path: "/" }), [], "Home has no crumbs");
  assert.deepEqual(checks({ h1Count: 2 }), ["h1-count"]);
  assert.deepEqual(checks({ h1InHeader: false }), ["h1-header"]);
  assert.deepEqual(checks({ primaryCount: 2 }), ["primary-count"]);
  assert.deepEqual(checks({ toolbarTop: 500 }), ["toolbar-low"]);
  assert.deepEqual(checks({ toolbarTop: 500 }, [390, 844]), [], "a phone allows the first screen");
  assert.deepEqual(checks({ smallTargets: [{ what: "button.x", width: 20, height: 20 }] }), ["small-target"]);
  assert.deepEqual(checks({ uiPage: false, h1Count: 3, primaryCount: 4 }), [], "pages not migrated yet: shell checks only");
  assert.ok(findPageIssues(m({ ...ok, shellTabbar: true })).some((i) => i.check === "shell-tabbar"), "part of the page pass");
  assert.match(read("scripts/ui-guard.mjs"), /\["unified", "\[data-ui-frame=unified\] \.ds-page-header"\]/, "the lab frame runs in ui:guard");
});
