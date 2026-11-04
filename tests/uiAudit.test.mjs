import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { columnAlign, hasHorizontalOverflow } from "../src/design-system/grid.ts";
import { Z_LAYERS, zVar } from "../src/design-system/theme.ts";
import { layerClassName } from "../src/design-system/theme.ts";
import { classicGridType } from "../src/components/lists/gridType.ts";
import { gridColumnType } from "../src/views/logic.ts";
import {
  ACTION_PARAM,
  ROW_ACTION_INTENT_KEY,
  ROW_ACTION_INTENT_MS,
  actionHref,
  forgetRowAction,
  hasRowActionIntent,
  parseActionHref,
  rememberRowAction,
  requestedAction,
  rowMenu,
  withoutAction,
} from "../src/views/rowActions.ts";
import { MAX_EMPTY_BAND, findPageIssues } from "../scripts/ui-page-checks.mjs";

/*
 * UI-5 (docs/ui-audit-2026-11-03.md): one page scroll, one overlay layer and z-index scale, row
 * menus on every list, one column-alignment rule, and the guards that keep them.
 */

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function walk(dir, out = []) {
  for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC = walk("src");

// ── Column alignment: one rule ────────────────────────────────────────────────

test("alignment: numbers and money at the end, everything else at the start, actions centred", () => {
  assert.equal(columnAlign("money"), "end");
  assert.equal(columnAlign("number"), "end");
  for (const t of ["text", "code", "date", "datetime", "status", undefined]) assert.equal(columnAlign(t), "start", String(t));
  assert.equal(columnAlign("actions"), "center");
});

test("classic columns: an amount or a count is numeric even without numeric: true", () => {
  assert.equal(classicGridType({ key: "total_amount", exportType: "money" }), "money");
  assert.equal(classicGridType({ key: "qty", exportType: "number" }), "number");
  assert.equal(classicGridType({ key: "count", exportType: "integer" }), "number");
  assert.equal(classicGridType({ key: "debt", numeric: true }), "money");
  assert.equal(classicGridType({ key: "qty", numeric: true, exportType: "number" }), "number");
  assert.equal(classicGridType({ key: "status" }), "status");
  assert.equal(classicGridType({ key: "doc_no" }), "code");
  assert.equal(classicGridType({ key: "date", exportType: "date" }), "date");
  assert.equal(classicGridType({ key: "x", gridType: "code", exportType: "money" }), "code", "an explicit grid type wins");
  assert.equal(columnAlign(gridColumnType({ name: "amount", type: "monetary" })), "end");
  assert.equal(columnAlign(gridColumnType({ name: "qty", type: "float" })), "end");
  assert.equal(columnAlign(gridColumnType({ name: "state", type: "selection" })), "start");
});

test("every grid aligns through columnAlign; no grid hard-codes its own numeric rule", () => {
  for (const f of ["src/design-system/components/DataGrid.tsx", "src/components/line-grid/LineGrid.tsx"]) assert.match(read(f), /columnAlign\(/, f);
  assert.ok(!/c\.type === "number" \|\| c\.type === "money" \? "is-num"/.test(read("src/design-system/components/DataGrid.tsx")));
});

// ── Layers: one z-index scale ─────────────────────────────────────────────────

test("z-index scale: layers.css matches Z_LAYERS, in the documented order", () => {
  const css = read("src/design-system/layers.css");
  for (const [k, v] of Object.entries(Z_LAYERS)) {
    const name = zVar(k).slice(4, -1);
    assert.match(css, new RegExp(`${name}: ${v};`), name);
  }
  const L = Z_LAYERS;
  assert.ok(L.gridHead < L.raised && L.raised < L.sticky && L.sticky < L.sidebar && L.sidebar < L.modal && L.modal < L.modalContent);
  assert.ok(L.modalContent < L.modalNested && L.modalNested + 9 < L.dropdown, "dropdowns above every dialog, nested ones too");
  assert.ok(L.dropdown < L.toast && L.toast < L.tooltip);
  assert.equal(zVar("modalNested"), "var(--ds-z-modal-nested)");
  assert.match(read("src/design-system/index.css"), /@import "\.\/layers\.css";/);
});

test("no raw z-index above the scale: overlays use the layer tokens", () => {
  const offenders = [];
  for (const f of SRC) {
    if (f.includes("/dev/")) continue;
    const s = read(f);
    for (const m of s.matchAll(/z-\[(\d+)\]|zIndex:\s*(\d+)|z-index:\s*(\d+)/g)) {
      const n = Number(m[1] ?? m[2] ?? m[3]);
      if (n > 10) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// ── Overlay layer ─────────────────────────────────────────────────────────────

test("overlays portal to a layer under <body>, not into the scope (a scope can sit in a table cell)", () => {
  const s = read("src/design-system/components/DesignScope.tsx");
  assert.match(s, /createPortal\(/);
  assert.match(s, /document\.body/);
  assert.match(s, /aria-live="off"/, "stays readable while a Radix dialog hides other body children");
  assert.match(s, /reuse/, "a nested scope with the same look shares its parent's layer");
  assert.equal(layerClassName("font-x ds-scope-transparent"), "ds-layer font-x");
  assert.equal(layerClassName(undefined), "ds-layer");
});

test("dropdowns fit the room Radix found: menus and lookup lists scroll inside, search stays visible", () => {
  const css = read("src/design-system/components.css");
  assert.match(css, /\.ds-menu \{[^}]*max-height: var\(--radix-popper-available-height/);
  assert.match(css, /\.ds-combobox-panel \{[^}]*max-height: min\(24rem, var\(--radix-popper-available-height/);
  assert.match(css, /\.ds-combobox-search \{[^}]*flex: 0 0 auto;/);
});

// ── One page scroll ───────────────────────────────────────────────────────────

test("one vertical scroller: the shell's [data-scroll-root]; page wrappers never scroll themselves", () => {
  assert.match(read("src/components/shell/NewShell.tsx"), /data-scroll-root=""/);
  assert.match(read("src/components/layout/ERPLayout.tsx"), /data-scroll-root=""/);
  const chrome = read("src/components/layout/ListPageChrome.tsx");
  assert.ok(!/100dvh|overflow-y-auto/.test(chrome), "ListPageChrome has no fixed height and no own scroll");
  assert.ok(!/overflow-y-auto/.test(read("src/components/layout/PageContent.tsx")));
  // No page wrapper (app-page-content, the settings / module page bodies) scrolls on its own.
  const offenders = SRC.filter((f) => f.endsWith(".tsx") && !f.includes("/dev/")).flatMap((f) =>
    read(f)
      .split("\n")
      .filter((l) => /app-page-content[^"]*overflow-y-auto|"flex-1 overflow-y-auto bg-app p-6"|"flex-1 overflow-auto p-4 md:p-6|<main className="flex-1 overflow-y-auto/.test(l))
      .map((l) => `${f}: ${l.trim().slice(0, 80)}`)
  );
  assert.deepEqual(offenders, []);
});

test("DataGrid scrolls sideways only; header and totals stick to the page scroller", () => {
  const css = read("src/design-system/components.css");
  const scroll = css.slice(css.indexOf("[data-ds] .ds-grid-scroll {"), css.indexOf("}", css.indexOf("[data-ds] .ds-grid-scroll {")));
  assert.ok(!/max-height/.test(scroll), "no max-height: no second vertical scrollbar");
  assert.match(scroll, /overflow-y: hidden;/);
  assert.match(css, /\.ds-grid-frame \{[^}]*overflow: clip;/, "clip, not hidden, so sticky works against the page");
  assert.match(css, /\.ds-grid-head-wrap \{[^}]*position: sticky;[^}]*top: var\(--ds-sticky-top/);
  assert.match(css, /\.ds-grid-foot \{[^}]*position: sticky;[^}]*bottom: var\(--ds-sticky-bottom/);
  assert.match(css, /\.ds-grid-root \{[^}]*contain: inline-size;/, "a wide grid never widens the page");
  const grid = read("src/design-system/components/DataGrid.tsx");
  assert.match(grid, /role="table"/);
  assert.match(grid, /ds-grid-head-table/);
  assert.ok(!/window\.addEventListener\("scroll"/.test(grid), "the page does not scroll the window");
  assert.equal(hasHorizontalOverflow({ scrollWidth: 1001, clientWidth: 1000 }), false);
  assert.equal(hasHorizontalOverflow({ scrollWidth: 1300, clientWidth: 1000 }), true);
  const globals = read("src/app/globals.css");
  assert.match(globals, /\.ds-list-chrome-bar \{[^}]*position: sticky;/);
  assert.match(globals, /--ds-sticky-bottom: calc\(env\(safe-area-inset-bottom\) - 2rem\)/, "above the phone tab bar");
});

// ── Row actions ───────────────────────────────────────────────────────────────

test("row actions: links to the record with ?do=, View first, destructive last, hidden dropped", () => {
  assert.equal(ACTION_PARAM, "do");
  assert.equal(actionHref("/sales/42", "pay"), "/sales/42?do=pay");
  assert.equal(actionHref("/purchases?record=7", "print"), "/purchases?record=7&do=print");
  assert.equal(actionHref("/purchases?record=7&do=pay#x", "void"), "/purchases?record=7&do=void#x");
  assert.equal(withoutAction("/purchases", "?record=7&do=pay"), "/purchases?record=7");
  assert.equal(withoutAction("/sales/42", "?do=pay"), "/sales/42");
  const items = rowMenu(
    "/sales/42",
    [
      { key: "void", label: "Void", destructive: true },
      { key: "pay", label: "Pay" },
      { key: "edit", label: "Edit", hidden: true },
      { key: "print", label: "Print" },
    ],
    "View"
  );
  assert.deepEqual(
    items.map((i) => [i.key, i.href]),
    [
      ["open", "/sales/42"],
      ["pay", "/sales/42?do=pay"],
      ["print", "/sales/42?do=print"],
      ["void", "/sales/42?do=void"],
    ]
  );
  assert.equal(typeof items[1].onSelect, "function", "picking a link remembers the intent");
  assert.deepEqual(rowMenu(undefined, [{ key: "x", label: "X", onSelect: () => 1 }]).map((i) => i.href), [undefined]);
});

test("requested action: only one the form offers and that is enabled", () => {
  const actions = [{ key: "pay" }, { key: "void", disabled: true }];
  assert.equal(requestedAction(actions, "pay")?.key, "pay");
  assert.equal(requestedAction(actions, "void"), null);
  assert.equal(requestedAction(actions, "delete"), null);
  assert.equal(requestedAction(actions, null), null);
});

test("a ?do= link runs only right after the user picked it in a row menu (one minute, one use)", () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.deepEqual(parseActionHref("/purchases?record=7&do=pay"), { path: "/purchases", key: "pay" });
  assert.equal(parseActionHref("/sales/1"), null);
  assert.equal(hasRowActionIntent(store, "/sales/42", "pay", 1000), false, "a bookmarked or shared link runs nothing");
  rememberRowAction(store, "/sales/42?do=pay", 1000);
  assert.ok(mem.has(ROW_ACTION_INTENT_KEY));
  assert.equal(hasRowActionIntent(store, "/sales/42", "pay", 1000 + 500), true);
  assert.equal(hasRowActionIntent(store, "/sales/42", "void", 1500), false, "another action");
  assert.equal(hasRowActionIntent(store, "/sales/43", "pay", 1500), false, "another record page");
  assert.equal(hasRowActionIntent(store, "/sales/42", "pay", 1000 + ROW_ACTION_INTENT_MS + 1), false, "too late");
  forgetRowAction(store);
  assert.equal(hasRowActionIntent(store, "/sales/42", "pay", 1500), false, "used up");
  store.setItem(ROW_ACTION_INTENT_KEY, "{not json");
  assert.equal(hasRowActionIntent(store, "/sales/42", "pay", 1500), false);
  assert.equal(hasRowActionIntent(null, "/sales/42", "pay", 1500), false);
});

test("every view-engine list with a classic row menu passes row actions again", () => {
  const screens = [
    "src/modules/sales/components/SalesScreen.tsx",
    "src/modules/purchases/components/PurchasesScreen.tsx",
    "src/modules/expenses/components/ExpensesScreen.tsx",
    "src/modules/contracts/components/ContractsScreen.tsx",
    "src/modules/consignment/components/ConsignmentsScreen.tsx",
    "src/modules/production/components/ProductionScreen.tsx",
    "src/modules/hr/components/EmployeesScreen.tsx",
    "src/modules/inventory/components/InventoryScreens.tsx",
    "src/modules/accounting/components/AccountingScreens.tsx",
  ];
  for (const f of screens) assert.match(read(f), /rowActions=\{|renderRowActions=\{/, f);
  const engine = read("src/views/components/ViewEngine.tsx");
  assert.match(engine, /rowMenu\(openHref\?\.\(r\), rowActions\(r\), viewLabel\)/);
  assert.match(read("src/views/components/ListView.tsx"), /<RowActionsMenu items=\{rowActions\(r\)\}/);
  const form = read("src/views/components/FormView.tsx");
  assert.match(form, /hasRowActionIntent\(store, pathname, key, Date\.now\(\)\)/, "the form checks the intent before running");
  assert.match(form, /requestedAction\(actions, key\)/);
  // The classic row menu becomes the same design-system menu inside a scope (every grid list).
  assert.match(read("src/components/ui/table-row-actions-menu.tsx"), /if \(!portalContainer\) return <ClassicTableRowActionsMenu/);
});

// ── Page checks of ui:guard ───────────────────────────────────────────────────

test("page checks: nested scroll, page side-scroll, empty band, actions column, alignment, clipped popover", () => {
  const ok = { viewportWidth: 1366, pageScrollWidth: 1366, verticalScrollers: [{ where: "root", isRoot: true }], root: { scrollHeight: 3000, clientHeight: 700, emptyBand: 10 }, grids: [], popovers: [] };
  assert.deepEqual(findPageIssues(ok), []);
  const bad = {
    viewportWidth: 360,
    pageScrollWidth: 420,
    verticalScrollers: [{ where: "root", isRoot: true }, { where: "div.list-body", isRoot: false }],
    root: { scrollHeight: 3000, clientHeight: 700, emptyBand: MAX_EMPTY_BAND + 100 },
    grids: [{ where: "sales", hasRowActions: true, actionsColumn: false, actionsVisible: false, misaligned: ["Məbləğ"], headerHidden: true }],
    popovers: [{ where: "lookup", clippedBy: "table.ds-grid" }],
  };
  assert.deepEqual(
    findPageIssues(bad).map((i) => i.check),
    ["nested-scroll", "page-hscroll", "empty-band", "grid-actions", "grid-align", "grid-header", "popover-clipped"]
  );
  const offscreen = { ...ok, grids: [{ where: "g", hasRowActions: true, actionsColumn: true, actionsVisible: false, misaligned: [] }] };
  assert.deepEqual(findPageIssues(offscreen).map((i) => i.detail), ["the actions column is outside the window"]);
  assert.match(read("scripts/ui-guard.mjs"), /frame=page/, "ui:guard opens the page frame");
});

// ── Imports: delete a draft (UI-5 item a) ─────────────────────────────────────

test("imports: a draft with nothing posted is deleted; a prepaid draft and confirmed ones are cancelled", async () => {
  const { removalFor } = await import("../src/modules/imports/lib/posting.ts");
  assert.equal(removalFor("draft", false), "delete");
  assert.equal(removalFor("draft", true), "cancel");
  for (const s of ["confirmed", "cleared", "partially_received", "received"]) assert.equal(removalFor(s, false), "cancel", s);
  assert.equal(removalFor("closed", false), null, "a closed import is reopened first");
  assert.equal(removalFor("cancelled", false), null);
});

test("imports: the delete migration is atomic, checked, and the direct-delete policy refuses the same cases", () => {
  const sql = read("supabase/migrations/20261103100000_imports_delete_draft.sql");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.delete_import_draft\(p_id UUID\)/);
  assert.match(sql, /_imports_require\('manage'\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /imports_delete_draft_only/);
  assert.match(sql, /imports_delete_has_postings/);
  assert.match(sql, /import_prepayments p WHERE p\.shipment_id = p_shipment/);
  assert.match(sql, /CREATE POLICY import_shipments_delete[\s\S]*status = 'draft' AND NOT public\.import_shipment_has_postings\(id\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.delete_import_draft\(UUID\) FROM PUBLIC, anon;/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/imports_delete_draft\.sql/);
  const actions = read("src/modules/imports/actions/posting.ts");
  assert.match(actions, /deleteDraftShipmentAction[\s\S]*guard\("can_manage_imports"\)[\s\S]*rpc\("delete_import_draft"/);
  for (const l of ["az", "en", "ru"]) {
    const m = read(`src/i18n/messages/${l}.ts`);
    for (const k of ["delete_draft_only:", "delete_has_postings:", "deleteDraft:", "deleteTitle:", "deleted:"]) assert.ok(m.includes(k), `${l} ${k}`);
  }
});

// ── Live-site audit fixes (UI-5, before screenshots of 2026-11-04) ────────────


test("dark: follows the app theme (data-theme), not the OS colour preference", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /@custom-variant dark \(&:where\(html:not\(\[data-theme="daylight"\]\) \*\)\);/);
});

test("app-input padding sits in a layer, so pl-* next to a search icon applies", () => {
  const css = read("src/app/globals.css");
  const base = css.slice(css.indexOf(".app-input {"), css.indexOf("}", css.indexOf(".app-input {")));
  assert.doesNotMatch(base, /padding/);
  assert.match(css, /@layer components \{\s*\.app-input \{\s*padding: 0 0\.75rem;/);
});

test("buttons that show a Plus icon carry no '+' in their label", async () => {
  const { azMessages: az } = await import("../src/i18n/messages/az.ts");
  const { enMessages: en } = await import("../src/i18n/messages/en.ts");
  const { ruMessages: ru } = await import("../src/i18n/messages/ru.ts");
  for (const m of [az, en, ru]) {
    for (const v of [m.payments.newPayment, m.partners.newPartner, m.invoice.newCustomer]) assert.doesNotMatch(v, /^\+/);
  }
});

test("breadcrumbs name the shell-only pages instead of humanising the URL", async () => {
  const { buildBreadcrumbsFromPath } = await import("../src/lib/navigation/breadcrumbs.ts");
  const t = (k) => k;
  assert.deepEqual(buildBreadcrumbsFromPath("/imports/new", t).map((c) => c.label), ["newShell.extra_imports", "imports.newShipment"]);
  assert.equal(buildBreadcrumbsFromPath("/calendar", t)[0].label, "newShell.extra_calendar");
});

test("module KPI cards: two per row on a phone, compact when narrow", () => {
  const css = read("src/design-system/components.css");
  assert.match(css, /\[data-ds\] \.ds-kpi-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container \(max-width: 14rem\)/);
  for (const f of ["src/views/components/KpiCards.tsx", "src/modules/sales/components/SalesDashboard.tsx"]) assert.match(read(f), /className="ds-kpi-grid"/);
});
