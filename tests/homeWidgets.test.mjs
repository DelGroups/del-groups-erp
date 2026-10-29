// Widget home (prompt 24b): who may see financial figures (canViewFinancials, tiles, classic
// dashboard), the widget registry, sanitizeLayout / mergeWithDefaults / moveWidget, the widget
// API's 403 for financial widgets, the database functions' first-line guard, weather and dates,
// the NEW_HOME switch and the az/en/ru texts. Database rules: supabase/tests/home_widgets.sql.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canViewFinancials, VIEW_FINANCIALS_PATH, GRANULAR_PERMISSION_MODULES, userHasGranularPermission } from "../src/lib/auth/permissionMatrix.ts";
import { composeAppKpis } from "../src/lib/shell/kpis.ts";
import { HOME_COLUMNS, visibleTo, widgetAccess, widgetDef, WIDGETS } from "../src/lib/home/registry.ts";
import { addable, addWidget, builtInLayout, emptyLayout, findWidget, mergeWithDefaults, moveAcross, moveBy, moveWidget, readingOrder, removeWidget, resizeWidget, sanitizeLayout, setWidgetSettings } from "../src/lib/home/layout.ts";
import { cleanCity, conditionFromCode, parseForecast, parseGeocode } from "../src/lib/home/weather.ts";
import { deltaPercent, isoDay, monthBounds, monthGrid, rangeFor, shiftMonth } from "../src/lib/home/dates.ts";
import { savedViewHref } from "../src/lib/home/views.ts";
import { isNewHomeEnabled, newHomeActive, newHomeAudience } from "../src/lib/features/newHome.ts";
import { LOADERS } from "../src/lib/home/server/loaders.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

const role = (name, permissions = {}) => ({ id: name, name, description: null, permissions, scopes: {} });
const ADMIN = { id: "a", role: role("Admin") };
const MANAGER = { id: "m", role: role("Manager", { can_view_dashboard: true, can_view_sales: true, can_view_finance: true, can_view_reports: true, can_view_financial_reports: true }) };
const CUSTOM = { id: "c", role: role("Sales desk", { can_view_dashboard: true, can_view_sales: true }) };
const GRANTED = { id: "g", role: role("Finance", { _matrix: { dashboard: { view: true, view_financials: true } }, _v: 2 }) };
const FLAT = { id: "f", role: role("Old style", { can_view_financials: true }) };
const OVERRIDE = { id: "o", role: role("Sales desk", { can_view_dashboard: true }), permission_overrides: { _matrix: { dashboard: { view_financials: true } }, _v: 2 } };

// ── Step 1: who sees money ──────────────────────────────────────────────

test("canViewFinancials: admins always; Manager and custom roles not; a role grant or a personal override does", () => {
  assert.equal(VIEW_FINANCIALS_PATH, "dashboard.view_financials");
  assert.equal(canViewFinancials(ADMIN), true);
  assert.equal(canViewFinancials(MANAGER), false);
  assert.equal(canViewFinancials(CUSTOM), false);
  assert.equal(canViewFinancials(GRANTED), true);
  assert.equal(canViewFinancials(FLAT), true);
  assert.equal(canViewFinancials(OVERRIDE), true);
  assert.equal(canViewFinancials(null), false);
  // The checkbox is in the role matrix, under the dashboard group, with a translated label.
  const dash = GRANULAR_PERMISSION_MODULES.find((g) => g.id === "dashboard");
  const perm = dash.permissions.find((p) => p.key === "view_financials");
  assert.equal(perm.legacyKey, "can_view_financials");
  assert.equal(perm.labelKey, "home.permissionViewFinancials");
});

test("launcher tiles: without financials no money amount and no sales count, even when rows are given", () => {
  const rows = { salesRows: [{ total_amount: 100, status: "posted" }, { total_amount: 50, status: "draft" }], accountRows: [{ balance: 900 }], customers: 4, users: 2, activitiesToday: 3 };
  const admin = composeAppKpis({ financials: true, ...rows });
  assert.deepEqual(admin.dashboard, { value: 100, kind: "money" });
  assert.deepEqual(admin.trade, { value: 1, kind: "count" });
  assert.deepEqual(admin.finance, { value: 900, kind: "money" });
  const other = composeAppKpis({ financials: false, ...rows });
  assert.equal(other.dashboard, undefined);
  assert.equal(other.finance, undefined);
  assert.deepEqual(other.trade, { value: 3, kind: "count", label: "activitiesToday" });
  assert.ok(!Object.values(other).some((k) => k.kind === "money"));
  assert.equal(other.crm.value, 4);
  // The route does not even query sales or balances without financials.
  const route = read("src/app/api/shell/kpis/route.ts");
  assert.match(route, /const financials = canViewFinancials\(profile\);/);
  assert.match(route, /financials && enabled\.has\("sales"\) \? rows\(client\.from\("sales"\)/);
  assert.match(route, /financials && enabled\.has\("accounting"\) \? rows\(client\.from\("accounts"\)/);
});

test("classic dashboard: money cards, trend and recent transactions only with financials; their queries are not run otherwise", () => {
  const page = read("src/app/page.client.tsx");
  assert.match(page, /const financials = canViewFinancials\(profile\);/);
  assert.match(page, /fetchDashboardData\(\{ financials \}\)/);
  assert.match(page, /const showSales = financials && isEnabled\("sales"\);/);
  assert.match(page, /const showAccounting = financials && isEnabled\("accounting"\);/);
  assert.match(page, /const showInventory = isEnabled\("inventory"\);/);
  const loader = read("src/lib/dashboard/fetchDashboard.ts");
  for (const table of ["sales", "purchases", "customers"]) assert.match(loader, new RegExp(`money\\s*\\?\\s*supabase\\s*\\.from\\("${table}"\\)`), table);
  assert.match(loader, /money \? fetchRecentTransactionsForDashboard\(\)/);
  assert.match(loader, /money \? checkCustomerArDiscrepancies\(\)/);
  assert.doesNotMatch(loader, /buy_price, sell_price/);
});

// ── Registry and layouts ────────────────────────────────────────────────

const ctxFor = (profile, enabled = () => true, newCrm = false) => ({
  isEnabled: enabled,
  can: (path) => userHasGranularPermission(profile, path),
  financials: canViewFinancials(profile),
  flags: { newCrm },
});

test("registry: unique ids, a component, a loader for remote widgets, money widgets are management and financial", () => {
  const ids = WIDGETS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  const components = read("src/components/home/widgets/index.ts");
  for (const w of WIDGETS) {
    assert.match(components, new RegExp(`\\b${w.id}: \\w+Widget`), `${w.id} has no component`);
    if (w.remote) assert.ok(LOADERS[w.id], `${w.id} has no loader`);
    assert.ok(w.sizes.includes(w.defaultSize), w.id);
    assert.ok(HOME_COLUMNS.includes(w.defaultColumn), w.id);
    assert.equal(w.financial, w.category === "management", `${w.id}: financial and category disagree`);
  }
  assert.deepEqual(WIDGETS.filter((w) => w.pinned).map((w) => w.id), ["apps"]);
  assert.deepEqual(WIDGETS.filter((w) => w.requires).map((w) => w.id).sort(), ["pipeline_value", "sales_target"]);
});

test("visibility: module off, missing permission, financial without the right, feature off", () => {
  const all = ctxFor(ADMIN);
  assert.ok(visibleTo(widgetDef("sales_month"), all));
  assert.ok(!visibleTo(widgetDef("sales_month"), ctxFor(ADMIN, (m) => m !== "sales")));
  assert.ok(!visibleTo(widgetDef("sales_month"), ctxFor(MANAGER)));
  assert.ok(!visibleTo(widgetDef("low_stock"), ctxFor(CUSTOM)), "custom role has no inventory.view");
  assert.ok(visibleTo(widgetDef("low_stock"), ctxFor(ADMIN)));
  assert.ok(!visibleTo(widgetDef("sales_target"), all), "hidden until NEW_CRM");
  assert.ok(visibleTo(widgetDef("sales_target"), ctxFor(ADMIN, () => true, true)));
  assert.ok(visibleTo(widgetDef("clock"), ctxFor(CUSTOM)));
});

test("API: a non-admin gets 403 for every financial widget; unknown is 404; admins get 200", () => {
  for (const profile of [MANAGER, CUSTOM]) {
    for (const w of WIDGETS.filter((x) => x.financial)) assert.equal(widgetAccess(w.id, ctxFor(profile, () => true, true)), 403, `${profile.role.name}: ${w.id}`);
  }
  for (const w of WIDGETS.filter((x) => x.financial)) assert.equal(widgetAccess(w.id, ctxFor(ADMIN, () => true, true)), 200, w.id);
  assert.equal(widgetAccess("nope", ctxFor(ADMIN)), 404);
  assert.equal(widgetAccess("my_activities", ctxFor(CUSTOM)), 200);
  const route = read("src/app/api/home/widgets/[id]/route.ts");
  assert.match(route, /if \(!isNewUiEnabled\(\) \|\| !isNewHomeEnabled\(\)\) return \{ status: 404/);
  assert.match(route, /const access = widgetAccess\(id,/);
  assert.match(route, /if \(access !== 200\) return \{ status: access \};/);
  // The 403 comes before the loader: LOADERS is only called after the access check.
  assert.ok(route.indexOf("widgetAccess(id") < route.indexOf("LOADERS[id](c.ctx)"));
});

test("a Manager's default layout has no financial widget, even from an admin's company default", () => {
  const manager = ctxFor(MANAGER);
  const own = builtInLayout(manager);
  assert.ok(!readingOrder(own).some((p) => widgetDef(p.id).financial), JSON.stringify(own));
  assert.ok(findWidget(own, "apps"));
  const adminDefault = builtInLayout(ctxFor(ADMIN));
  assert.ok(readingOrder(adminDefault).some((p) => widgetDef(p.id).financial), "admin default shows management widgets");
  const merged = mergeWithDefaults(null, adminDefault, manager);
  assert.equal(merged.source, "tenant");
  assert.ok(!readingOrder(merged.layout).some((p) => widgetDef(p.id).financial));
  // Admin: management widgets in the end column; others: operations there.
  assert.deepEqual(adminDefault.columns.end.map((p) => widgetDef(p.id).category).filter((c, i, a) => a.indexOf(c) === i), ["management"]);
  assert.ok(builtInLayout(ctxFor(ADMIN)).columns.centre[0].id === "apps");
});

test("sanitizeLayout drops unknown, disabled, forbidden and duplicate widgets, fixes sizes and keeps the apps grid", () => {
  const manager = ctxFor(MANAGER, (m) => m !== "hr");
  const raw = {
    v: 1,
    columns: {
      start: [{ id: "clock", size: "L" }, { id: "nope", size: "M" }, { id: "away_today", size: "M" }, { id: "clock", size: "S" }],
      centre: [{ id: "sales_month", size: "M" }, { id: "weather", size: "M", settings: { city: "Ganja", "bad key": "x", n: 5 } }],
      end: "not a list",
    },
  };
  const out = sanitizeLayout(raw, manager);
  assert.deepEqual(out.columns.start, [{ id: "clock", size: "S" }]);
  assert.deepEqual(out.columns.centre, [{ id: "apps", size: "L" }, { id: "weather", size: "M", settings: { city: "Ganja" } }]);
  assert.deepEqual(out.columns.end, []);
  assert.equal(sanitizeLayout(null, manager), null);
  assert.equal(sanitizeLayout([], manager), null);
  assert.equal(sanitizeLayout({ columns: [] }, manager), null);
  // A layout with only the pinned apps falls back to the defaults.
  assert.equal(mergeWithDefaults({ v: 1, columns: { start: [], centre: [], end: [] } }, null, manager).source, "builtin");
});

test("moveWidget, moveBy, moveAcross, remove, add, resize, settings", () => {
  const admin = ctxFor(ADMIN);
  let l = emptyLayout();
  l.columns.start = [{ id: "clock", size: "S" }, { id: "greeting", size: "M" }];
  l.columns.centre = [{ id: "apps", size: "L" }];
  const before = JSON.stringify(l);
  l = moveWidget(l, "clock", "end", 0);
  assert.equal(findWidget(l, "clock").column, "end");
  assert.equal(JSON.parse(before).columns.start.length, 2, "input not mutated");
  l = moveWidget(l, "greeting", "end", 99);
  assert.deepEqual(l.columns.end.map((p) => p.id), ["clock", "greeting"]);
  l = moveBy(l, "greeting", -1);
  assert.deepEqual(l.columns.end.map((p) => p.id), ["greeting", "clock"]);
  l = moveAcross(l, "greeting", -1);
  assert.equal(findWidget(l, "greeting").column, "centre");
  assert.deepEqual(moveAcross(l, "greeting", 1).columns.end.map((p) => p.id)[0], "greeting");
  assert.deepEqual(moveWidget(l, "missing", "end", 0), l);
  assert.deepEqual(removeWidget(l, "apps"), l, "apps is pinned");
  l = removeWidget(l, "clock");
  assert.equal(findWidget(l, "clock"), null);
  l = addWidget(l, "clock", admin);
  assert.equal(findWidget(l, "clock").column, "start");
  assert.deepEqual(addWidget(l, "clock", admin), l, "no duplicate");
  assert.deepEqual(addWidget(l, "sales_month", ctxFor(MANAGER)), l, "cannot add what you may not see");
  assert.equal(resizeWidget(l, "clock", "M").columns.start[0].size, "M");
  assert.deepEqual(resizeWidget(l, "clock", "L"), l, "clock has no L");
  assert.deepEqual(setWidgetSettings(l, "clock", { face: "analogue" }).columns.start[0].settings, { face: "analogue" });
  assert.ok(!addable(l, ctxFor(MANAGER)).some((d) => d.financial || d.pinned || d.id === "clock"));
});

// ── Database functions ──────────────────────────────────────────────────

test("every financial database function refuses first; layouts have RLS; one file each", () => {
  const sql = read("supabase/migrations/20261025120000_home_financial_rpcs.sql");
  const fns = [...sql.matchAll(/create or replace function public\.(home_\w+)\([^)]*\)\s*returns jsonb[\s\S]*?\$\$\s*declare[\s\S]*?begin\s*\n\s*(\S[^\n]*)/g)];
  assert.ok(fns.length >= 11, `found ${fns.length}`);
  for (const [, name, first] of fns) assert.equal(first.trim(), "perform public.home_require_financials();", name);
  assert.match(sql, /raise exception 'forbidden' using errcode = '42501'/);
  assert.match(sql, /security definer\s*\nset search_path = public/);
  assert.match(sql, /'cancelled', 'canceled', 'void', 'voided', 'draft', 'deleted'/);
  assert.match(sql, /permission_overrides -> '_matrix' -> 'dashboard' ->> 'view_financials'/);
  const layouts = read("supabase/migrations/20261025110000_home_layouts.sql");
  assert.match(layouts, /alter table public\.home_layouts enable row level security;/);
  assert.match(layouts, /using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(layouts, /using \(\(select public\.user_is_admin\(\)\)\)/);
  const files = readdirSync(join(root, "supabase/migrations"));
  assert.equal(files.filter((f) => f.startsWith("20261025110000")).length, 1);
  assert.equal(files.filter((f) => f.startsWith("20261025120000")).length, 1);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/home_widgets\.sql/);
  // Financial loaders only call these functions (no sums in the browser or the API).
  const loaders = read("src/lib/home/server/loaders.ts");
  const money = loaders.slice(loaders.indexOf("// ── Management"), loaders.indexOf("async function arDiscrepancy"));
  assert.doesNotMatch(money, /\.from\(/);
});

// ── Weather, dates, views, flag ─────────────────────────────────────────

test("weather: codes, city check, Open-Meteo parsing", () => {
  assert.equal(conditionFromCode(0), "clear");
  assert.equal(conditionFromCode(2), "partly");
  assert.equal(conditionFromCode(45), "fog");
  assert.equal(conditionFromCode(63), "rain");
  assert.equal(conditionFromCode(73), "snow");
  assert.equal(conditionFromCode(95), "storm");
  assert.equal(cleanCity("  Gəncə "), "Gəncə");
  assert.equal(cleanCity("Baku<script>"), null);
  assert.equal(cleanCity(""), null);
  const geo = parseGeocode({ results: [{ name: "Baku", country: "Azerbaijan", latitude: 40.37, longitude: 49.83 }] });
  assert.deepEqual(geo, { name: "Baku", country: "Azerbaijan", lat: 40.37, lon: 49.83 });
  assert.equal(parseGeocode({}), null);
  const r = parseForecast(
    { current: { temperature_2m: 18.6, weather_code: 1 }, daily: { time: ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"], weather_code: [1, 61, 3, 0], temperature_2m_max: [20, 17.4, 19, 21], temperature_2m_min: [12, 11, 10, 9] } },
    geo,
    new Date("2026-10-25T08:00:00Z")
  );
  assert.equal(r.temperature, 19);
  assert.equal(r.condition, "partly");
  assert.deepEqual(r.days.map((d) => [d.date, d.condition, d.max]), [["2026-10-26", "rain", 17], ["2026-10-27", "cloudy", 19], ["2026-10-28", "clear", 21]]);
});

test("dates: Baku day, month grid, ranges, delta; saved view links; NEW_HOME", () => {
  assert.equal(isoDay(new Date("2026-10-24T21:30:00Z")), "2026-10-25", "01:30 in Baku");
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  const grid = monthGrid("2026-10");
  assert.equal(grid[0].indexOf("2026-10-01"), 3, "1 October 2026 is a Thursday");
  assert.ok(grid.every((w) => w.length === 7));
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(rangeFor("30d", "2026-10-25"), { from: "2026-09-26", to: "2026-10-25", bucket: "day" });
  assert.equal(rangeFor("12m", "2026-10-25").from, "2025-11-01");
  assert.equal(rangeFor("90d", "2026-10-25").bucket, "week");
  assert.equal(deltaPercent(150, 100), 50);
  assert.equal(deltaPercent(5, 0), null);
  assert.equal(savedViewHref("sales.invoices"), "/sales");
  assert.equal(savedViewHref("unknown.key"), null);
  assert.equal(isNewHomeEnabled({}), false);
  assert.equal(isNewHomeEnabled({ NEW_HOME: "true" }), true);
  assert.equal(newHomeAudience({}), "admins");
  assert.equal(newHomeAudience({ NEW_HOME_AUDIENCE: "all" }), "all");
  assert.equal(newHomeActive({ enabled: true, audience: "admins", isAdmin: false }), false);
  assert.equal(newHomeActive({ enabled: true, audience: "admins", isAdmin: true }), true);
  assert.equal(newHomeActive({ enabled: false, audience: "all", isAdmin: true }), false);
  // With NEW_HOME off the launcher is exactly as before.
  assert.match(read("src/app/page.client.tsx"), /return newHome \? <HomeDashboard \/> : <AppsPageClient \/>;/);
});

test("texts: every home key exists in az, en and ru with the same placeholders", () => {
  const sources = ["src/components/home", "src/components/home/widgets"].flatMap((d) => readdirSync(join(root, d)).filter((f) => /\.tsx?$/.test(f)).map((f) => read(`${d}/${f}`))).join("\n") + read("src/modules/core/manifest.ts");
  const keys = new Set([...sources.matchAll(/["'`](home\.[a-zA-Z0-9_.]+)["'`]/g)].map((m) => m[1]).filter((k) => !k.endsWith(".")));
  for (const w of WIDGETS) keys.add(w.titleKey).add(w.descriptionKey);
  for (const c of HOME_COLUMNS) keys.add(`home.columns.${c}`);
  for (const c of ["personal", "operations", "management"]) keys.add(`home.categories.${c}`);
  for (const s of ["S", "M", "L"]) keys.add(`home.edit.size${s}`);
  for (const p of ["night", "morning", "afternoon", "evening"]) keys.add(`home.greeting.${p}`).add(`home.greeting.${p}Named`);
  for (const c of ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "snow", "storm"]) keys.add(`home.weather.${c}`);
  for (const q of ["sale", "purchase", "customer", "task", "expense"]) keys.add(`home.quick.${q}`);
  for (const b of ["0_30", "31_60", "61_90", "90_plus"]) keys.add(`home.receivables.${b}`);
  for (const r of ["30d", "90d", "12m"]) keys.add(`home.trend.${r}`);
  for (const k of ["sales_total", "purchases_total", "expenses_total", "new_customers"]) keys.add(`home.wow.${k}`);
  for (const k of ["overdue", "today", "planned"]) keys.add(`home.activities.${k}`);
  keys.add("newShell.kpi_activitiesToday");
  assert.ok(keys.size > 200, `${keys.size} keys`);
  const get = (o, p) => p.split(".").reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const [name, m] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(m, k) !== "string" || !get(m, k).trim());
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
  for (const k of keys) {
    assert.equal(vars(get(azMessages, k)), vars(get(enMessages, k)), k);
    assert.equal(vars(get(ruMessages, k)), vars(get(enMessages, k)), k);
  }
});
