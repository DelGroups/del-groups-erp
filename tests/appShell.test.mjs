// New app shell (prompt 16): the switch, apps from the module menus, the breadcrumb trail,
// the launcher figures, that every page is reachable from the launcher, and that nothing
// changes while NEW_UI is off.   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appForPath,
  bestItem,
  collapseCrumbs,
  filterApps,
  newShellActive,
  newShellCanToggle,
  nextTrail,
  parseNewUiAudience,
  parseNewUiCookie,
  parseTrail,
  shellBackButton,
  SHELL_EXTRA_ITEMS,
  SHELL_HOME,
  shortcutModifier,
  trailCrumbs,
  TRAIL_MAX,
  visibleSections,
  withExtraItems,
} from "../src/lib/shell/shell.ts";
import { lowStockCount, monthStart, openProductionOrders, salesThisMonth, totalBalance } from "../src/lib/shell/kpis.ts";
import { MODULES, buildNavSections } from "../src/modules/registry.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

// ── Switch ───────────────────────────────────────────────────────────────────

test("the new shell shows only with NEW_UI on, the user's choice, and an admin", () => {
  const cases = [
    [{ available: false, preferred: true, authReady: true, isAdmin: true }, false],
    [{ available: true, preferred: false, authReady: true, isAdmin: true }, false],
    [{ available: true, preferred: true, authReady: true, isAdmin: false }, false],
    [{ available: true, preferred: true, authReady: true, isAdmin: true }, true],
    [{ available: true, preferred: true, authReady: false, isAdmin: false }, true],
    [{ available: false, preferred: true, authReady: false, isAdmin: false }, false],
  ];
  for (const [input, want] of cases) assert.equal(newShellActive(input), want, JSON.stringify(input));
  assert.equal(parseNewUiCookie("1"), true);
  for (const v of ["0", "", "true", null, undefined]) assert.equal(parseNewUiCookie(v), false);
  // The default audience is "admins": unchanged behaviour, only admins switch.
  assert.equal(newShellActive({ available: true, preferred: true, authReady: true, isAdmin: false, audience: "admins", signedIn: true }), false);
  assert.equal(newShellCanToggle({ available: true, isAdmin: false, audience: "admins", signedIn: true }), false);
  assert.equal(newShellCanToggle({ available: true, isAdmin: true }), true);
  assert.equal(newShellCanToggle({ available: false, isAdmin: true, audience: "all" }), false);
});

test("NEW_UI_AUDIENCE: admins by default; all = every signed-in user by default, and anyone can switch back", () => {
  for (const v of [undefined, null, "", "admins", "ALL-users", "everyone"]) assert.equal(parseNewUiAudience(v), "admins", String(v));
  for (const v of ["all", " ALL ", "All"]) assert.equal(parseNewUiAudience(v), "all", v);
  // "all": no cookie = new shell; "0" (switched back) = classic; "1" = new shell.
  assert.equal(parseNewUiCookie(undefined, "all"), true);
  assert.equal(parseNewUiCookie("", "all"), true);
  assert.equal(parseNewUiCookie("0", "all"), false);
  assert.equal(parseNewUiCookie("1", "all"), true);
  assert.equal(parseNewUiCookie(undefined, "admins"), false);
  const all = { available: true, preferred: true, authReady: true, audience: "all" };
  assert.equal(newShellActive({ ...all, isAdmin: false, signedIn: true }), true);
  assert.equal(newShellActive({ ...all, isAdmin: true, signedIn: true }), true);
  assert.equal(newShellActive({ ...all, isAdmin: false, signedIn: false }), false);
  assert.equal(newShellActive({ ...all, preferred: false, isAdmin: false, signedIn: true }), false);
  assert.equal(newShellActive({ ...all, available: false, isAdmin: true, signedIn: true }), false);
  assert.equal(newShellCanToggle({ available: true, isAdmin: false, audience: "all", signedIn: true }), true);
  assert.equal(newShellCanToggle({ available: true, isAdmin: false, audience: "all", signedIn: false }), false);
  // The server reads the audience only while NEW_UI is on and passes it to the cookie default.
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /const audience = parseNewUiAudience\(newUiAudienceSetting\(\)\);/);
  assert.match(layout, /parseNewUiCookie\(\(await cookies\(\)\)\.get\(NEW_UI_COOKIE\)\?\.value, audience\)/);
  assert.ok(layout.indexOf("if (!isNewUiEnabled())") < layout.indexOf("parseNewUiAudience("));
  // Both shells offer the switch to whoever may toggle; the classic one says "back" with "all".
  assert.match(read("src/components/layout/AppTopBar.tsx"), /newShellAudience === "all" \? t\("newShell\.backToNew"\) : t\("newShell\.tryNew"\)/);
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) assert.equal(typeof messages.newShell.backToNew, "string", name);
});

test("with NEW_UI off nothing is read and nothing changes", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /if \(!isNewUiEnabled\(\)\) return \{ available: false, preferred: false, brand: null \};/, "no cookie or DB read while off");
  const provider = read("src/components/shell/NewUiProvider.tsx");
  assert.match(provider, /if \(!value\.available\) return OFF;/);
  const erpLayout = read("src/components/layout/ERPLayout.tsx");
  assert.match(erpLayout, /const \{ active: newShell \} = useNewUi\(\);\s*if \(newShell\) \{/);
  assert.match(read("src/components/layout/AppTopBar.tsx"), /\{canTryNewShell \? \(/, "the classic top bar offers the switch only when allowed");
  assert.match(read("src/app/apps/page.tsx"), /if \(!isNewUiEnabled\(\)\) notFound\(\);/);
  assert.match(read("src/app/api/shell/kpis/route.ts"), /if \(!isNewUiEnabled\(\)\) return NextResponse\.json\(\{ error: "not_found" \}, \{ status: 404 \}\);/);
});

test("the home page opens the app launcher in the new shell and the dashboard otherwise", () => {
  const home = read("src/app/page.client.tsx");
  // The widget home (NEW_HOME, prompt 24b) replaces the launcher only for users who get it.
  assert.match(home, /export default function HomePage\(\) \{\s*const \{ active, newHome \} = useNewUi\(\);\s*if \(!active\) return <ManagementDashboardPage \/>;\s*return newHome \? <HomeDashboard \/> : <AppsPageClient \/>;/);
});

// ── Apps ─────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "dashboard", titleKey: "d", items: [{ path: "/", titleKey: "home", module: "core" }] },
  {
    id: "inventory",
    titleKey: "i",
    items: [
      { path: "/inventory", titleKey: "stock", module: "inventory" },
      { path: "/inventory/counts", titleKey: "counts", module: "inventory" },
      { path: "/products", titleKey: "products", module: "core" },
    ],
  },
  { id: "hr", titleKey: "h", items: [{ path: "/employees", titleKey: "emp", module: "hr" }] },
];

test("apps follow the classic sidebar rule: module enabled, then admin or permission", () => {
  const access = (over) => ({
    isEnabled: (m) => m !== "hr",
    isAdmin: false,
    permissionFor: (p) => (p === "/inventory/counts" ? "can_count" : null),
    can: () => false,
    ...over,
  });
  assert.deepEqual(
    visibleSections(SECTIONS, access()).map((s) => [s.id, s.items.map((i) => i.path)]),
    [["dashboard", ["/"]], ["inventory", ["/inventory", "/products"]]],
    "hr off, counts needs a permission"
  );
  assert.deepEqual(visibleSections(SECTIONS, access({ isAdmin: true })).find((s) => s.id === "inventory").items.length, 3);
  assert.equal(visibleSections(SECTIONS, access({ can: (p) => p === "can_count" })).find((s) => s.id === "inventory").items.length, 3);
});

test("the app and menu item of a page: most specific item wins, / only for /", () => {
  assert.equal(appForPath(SECTIONS, "/inventory/counts/42").id, "inventory");
  assert.equal(bestItem(SECTIONS, "/inventory/counts/42").item.path, "/inventory/counts");
  assert.equal(bestItem(SECTIONS, "/inventory").item.path, "/inventory");
  assert.equal(bestItem(SECTIONS, "/products/new").item.path, "/products");
  assert.equal(appForPath(SECTIONS, "/").id, "dashboard");
  assert.equal(appForPath(SECTIONS, "/unknown"), null);
  assert.equal(bestItem(SECTIONS, "/inventoryx"), null, "prefix must end at a slash");
});

test("launcher search: app or page names, every word, accents and İ/ı ignored", () => {
  const apps = [
    { id: "a", title: "Anbar", itemTitles: ["Anbar qalığı", "İnventarizasiya"] },
    { id: "b", title: "Satış", itemTitles: ["Fakturalar"] },
  ];
  assert.deepEqual(filterApps(apps, "").map((a) => a.id), ["a", "b"]);
  assert.deepEqual(filterApps(apps, "inventar").map((a) => a.id), ["a"]);
  assert.deepEqual(filterApps(apps, "satis faktura").map((a) => a.id), ["b"]);
  assert.deepEqual(filterApps(apps, "qaligi").map((a) => a.id), ["a"]);
  assert.deepEqual(filterApps(apps, "zzz"), []);
});

test("extra pages join their app without duplicates; missing apps are skipped", () => {
  const out = withExtraItems(SECTIONS, [...SHELL_EXTRA_ITEMS, { section: "inventory", path: "/products", titleKey: "x", module: "core" }], (e) => ({ path: e.path, titleKey: e.titleKey, module: e.module }));
  assert.deepEqual(out.find((s) => s.id === "inventory").items.map((i) => i.path), ["/inventory", "/inventory/counts", "/products", "/polywood"]);
  assert.deepEqual(out.find((s) => s.id === "hr").items.map((i) => i.path), ["/employees", "/comissions/report"]);
});

// ── Every page is reachable from the launcher ────────────────────────────────

function appPages() {
  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === "page.tsx") {
        const route = relative(join(root, "src/app"), dirname(p)).split(sep).filter((s) => s && !s.startsWith("("));
        pages.push(`/${route.join("/")}`);
      }
    }
  };
  walk(join(root, "src/app"));
  return pages;
}

// Pages that are not part of the app's navigation: sign-in, tenant status, the launcher itself,
// the design gallery, a redirect, and the "not in your plan" notice.
const NOT_NAVIGATION = new Set([
  "/login", "/forgot-password", "/update-password", "/auth/callback", "/auth/set-password",
  "/tenant/not-found", "/tenant/preparing", "/tenant/suspended", "/tenant/unavailable",
  "/apps", "/dev/design", "/dev/ui-lab", "/not-in-plan", "/inventory-audit",
]);
// Pages reached by a link on a page that is itself reachable (checked in the source).
const LINKED_FROM = {
  "/comissions": ["src/modules/commissions/components/MonthlyCommissionReportPage.tsx", 'href="/comissions"'],
  "/dashboard/inventory/polywood/import": ["src/modules/polywood/components/PolywoodInventoryPage.tsx", 'href="/dashboard/inventory/polywood/import"'],
};

test("with the flag on, every existing page is reachable from the launcher", () => {
  const sections = withExtraItems(buildNavSections(MODULES), SHELL_EXTRA_ITEMS, (e) => ({ path: e.path, titleKey: e.titleKey, module: e.module, icon: "Layers" }));
  const all = visibleSections(sections, { isEnabled: () => true, isAdmin: true, permissionFor: () => null, can: () => true });
  const unreachable = [];
  for (const page of appPages()) {
    if (NOT_NAVIGATION.has(page)) continue;
    const concrete = page.replace(/\[[^\]]+\]/g, "x");
    if (bestItem(all, concrete)) continue;
    const link = LINKED_FROM[page];
    if (link && read(link[0]).includes(link[1])) continue;
    unreachable.push(page);
  }
  assert.deepEqual(unreachable, []);
  assert.ok(appPages().length > 60, "found the app's pages");
  for (const s of all) assert.ok(s.items.length > 0 && s.items[0].path.startsWith("/"), `${s.id} opens a page`);
});

// ── Breadcrumb trail ─────────────────────────────────────────────────────────

const e = (path, label = path) => ({ path, label });

test("trail: related records extend it, going back cuts it, shell navigation restarts it", () => {
  let trail = nextTrail([], e("/customers"), false);
  trail = nextTrail(trail, e("/customers/7", "Acme"), false);
  trail = nextTrail(trail, e("/sales/12", "INV-12"), false);
  assert.deepEqual(trail.map((x) => x.path), ["/customers", "/customers/7", "/sales/12"]);
  assert.deepEqual(nextTrail(trail, e("/customers/7", "Acme MMC"), false), [e("/customers"), e("/customers/7", "Acme MMC")]);
  assert.deepEqual(nextTrail(trail, e("/inventory"), true), [e("/inventory")]);
  let long = [];
  for (let i = 0; i < 12; i++) long = nextTrail(long, e(`/p/${i}`), false);
  assert.equal(long.length, TRAIL_MAX);
  assert.equal(long.at(-1).path, "/p/11");
});

test("trail storage is read defensively", () => {
  assert.deepEqual(parseTrail(null), []);
  assert.deepEqual(parseTrail("{bad"), []);
  assert.deepEqual(parseTrail(JSON.stringify([e("/a"), { path: "no-slash", label: "x" }, { path: "/b" }, 3])), [e("/a")]);
});

test("crumbs: the first page's place in its app, then each related record; the last has no link", () => {
  const base = [{ label: "Customers", href: "/customers" }, { label: "Acme" }];
  assert.deepEqual(trailCrumbs([e("/customers/7", "Acme")], base), [{ label: "Customers", href: "/customers" }, { label: "Acme" }]);
  assert.deepEqual(trailCrumbs([e("/customers/7", "Acme"), e("/sales/12", "INV-12")], base), [
    { label: "Customers", href: "/customers" },
    { label: "Acme", href: "/customers/7" },
    { label: "INV-12" },
  ]);
  const many = [1, 2, 3, 4, 5, 6].map((n) => ({ label: `c${n}`, href: `/c${n}` }));
  const c = collapseCrumbs(many);
  assert.deepEqual(c.visible.map((x) => x.label), ["c1", "c5", "c6"]);
  assert.deepEqual(c.hidden.map((x) => x.label), ["c2", "c3", "c4"]);
  assert.equal(collapseCrumbs(many.slice(0, 4)).collapsedAt, null);
});

test("search hint shows ⌘ on Apple devices, Ctrl elsewhere", () => {
  assert.equal(shortcutModifier("MacIntel"), "⌘");
  assert.equal(shortcutModifier("iPhone"), "⌘");
  assert.equal(shortcutModifier("Win32"), "Ctrl");
  assert.equal(shortcutModifier(undefined), "Ctrl");
});

// ── Launcher figures ─────────────────────────────────────────────────────────

test("launcher figures: cancelled and draft sales skipped, minimum stock, open orders, balances", () => {
  assert.equal(monthStart("2026-10-14"), "2026-10-01");
  assert.deepEqual(
    salesThisMonth([{ total_amount: "100.10", status: "posted" }, { total_amount: 50, status: "Cancelled" }, { total_amount: 20, status: "draft" }, { total_amount: 9.9, status: null }]),
    { total: 110, count: 2 }
  );
  assert.equal(salesThisMonth(null), null);
  assert.equal(lowStockCount([{ stock: 5, min_stock: 5 }, { stock: 6, min_stock: 5 }, { stock: 0, min_stock: 0 }, { stock: 0, min_stock: 3, is_service: true }, { stock: 1, min_stock_level: 2 }]), 2);
  assert.equal(openProductionOrders([{ status: "in_progress" }, { status: "Completed" }, { status: "cancelled" }, { status: "planned" }]), 2);
  assert.equal(totalBalance([{ balance: "10.105" }, { balance: -2 }, { balance: null }]), 8.11);
  assert.equal(lowStockCount(null), null);
});

// ── Texts ────────────────────────────────────────────────────────────────────

test("shell texts exist in az, en and ru with the same placeholders; every key used exists", () => {
  const keys = Object.keys(enMessages.newShell).sort();
  const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [locale, m] of [["az", azMessages], ["ru", ruMessages]]) {
    assert.deepEqual(Object.keys(m.newShell).sort(), keys, locale);
    for (const k of keys) assert.deepEqual(params(m.newShell[k]), params(enMessages.newShell[k]), `${locale}.newShell.${k}`);
  }
  const used = new Set();
  for (const f of ["src/components/shell/NewShell.tsx", "src/app/apps/page.client.tsx", "src/components/layout/AppTopBar.tsx", "src/lib/shell/shell.ts"]) {
    for (const [, k] of read(f).matchAll(/"newShell\.(\w+)"/g)) used.add(k);
  }
  for (const id of ["dashboard", "trade", "inventory", "production", "crm", "finance", "hr", "settings"]) used.add(`kpi_${id}`);
  assert.ok(used.size > 35);
  for (const k of used) assert.ok(keys.includes(k), `newShell.${k} missing`);
});

test("responsive visibility sits on wrappers, never on ds- buttons (their display rule would win)", () => {
  for (const f of ["src/components/shell/NewShell.tsx", "src/app/apps/page.client.tsx"]) {
    for (const [, cls] of read(f).matchAll(/className="([^"]*)"/g)) {
      const styled = /\bds-(icon-btn|btn|menu-item|tab)\b/.test(cls);
      const responsive = /(^|\s)(hidden|(sm|md|lg|xl):(hidden|block|flex|inline-flex|inline-grid|grid))(\s|$)/.test(cls);
      assert.ok(!(styled && responsive), `${f}: "${cls}"`);
    }
  }
});

// ── Back button (module icon → back arrow) ───────────────────────────────────

test("the back-to-home button shows inside every module and never on the home menu", () => {
  // Inside a module: its pages, sub-pages and sub-tabs.
  for (const path of ["/sales", "/sales/123", "/dashboard/reports/financial", "/dashboard/reports/osv", "/employees?tab=leaves".split("?")[0], "/crm/", "/inventory/counts/abc"]) {
    assert.deepEqual(shellBackButton(path, "app"), { show: true, href: SHELL_HOME }, path);
  }
  // The home menu itself ("/" is the launcher while the new shell is on), or a page of no app.
  assert.equal(shellBackButton("/apps", "dashboard").show, false);
  assert.equal(shellBackButton("/apps/", "dashboard").show, false);
  assert.equal(shellBackButton("/", "dashboard").show, false);
  assert.equal(shellBackButton("/settings/profile", null).show, false);
  assert.equal(SHELL_HOME, "/apps");
});

test("the top bar uses the back button only when it should show; it is a link with a label and motion", () => {
  const shell = read("src/components/shell/NewShell.tsx");
  assert.match(shell, /const backButton = shellBackButton\(pathname, current\?\.id \?\? null\);/);
  assert.match(shell, /\{current && backButton\.show \? \(\s*<ShellBackButton app=\{current\} href=\{backButton\.href\} \/>/);
  const button = read("src/components/shell/ShellBackButton.tsx");
  assert.match(button, /<Link\s+href=\{href\}/);
  assert.match(button, /aria-label=/);
  assert.match(button, /onFocus=\{\(\) => setHot\(true\)\}/);
  assert.match(button, /\(hover: none\)/);
  assert.match(button, /transition=\{reduced \? transitions\.instant : transitions\.fast\}/);
  assert.match(button, /t\("newShell\.homeMenu"\)/);
  // Only the new shell renders it: the classic layout does not import it.
  assert.doesNotMatch(read("src/components/layout/ERPLayout.tsx"), /ShellBackButton/);
});
