// INV-3: value filters of the view engine (pick people / partners in the search panel).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySearch,
  matchesValueFilters,
  sanitizeSearchState,
  setValuePicks,
  UNKNOWN_VALUE,
  validateDefinition,
  valueFilterOptions,
  valueKeyOf,
  valueKeyResolver,
  withValueFilters,
} from "../src/views/logic.ts";
import { saleToRecord, salesDefinition, salesModel } from "../src/modules/sales/views/sales.ts";
import { purchaseToRecord, purchasesDefinition, purchasesModel } from "../src/modules/purchases/views/purchases.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const fmt = { t: (k) => k, locale: "az" };
const ctx = { userId: "u-omer", now: new Date(2026, 10, 11) };

const SALES = salesDefinition(salesModel({ fetchAll: async () => [], fetchOne: async () => null }));
const PURCHASES = purchasesDefinition(purchasesModel({ fetchAll: async () => [], fetchOne: async () => null }));
const SELLER = SALES.valueFilters.find((vf) => vf.field === "seller_id");
const CREATOR = SALES.valueFilters.find((vf) => vf.field === "created_by");

const sale = (id, over = {}) =>
  saleToRecord({ id, doc_no: `S-${id}`, status: "posted", total_amount: 100, paid_amount: 100, remaining_balance: 0, customer_name: "Müştəri", ...over });

const ROWS = [
  sale("1", { seller_id: "u-omer", seller_name: "Ömər Çələbiyev", created_by: "u-sebine", created_by_name: "Səbinə Qasımova", status: "draft" }),
  sale("2", { seller_id: "u-omer", seller_name: "Ömər Çələbiyev", created_by: "u-omer", created_by_name: "Ömər Çələbiyev" }),
  sale("3", { seller_id: "u-aynur", seller_name: "Aynur Əliyeva", created_by: "u-sebine", created_by_name: "Səbinə Qasımova", customer_name: "Şüşə Dünyası" }),
  sale("4", { seller_id: null, seller_name: null, created_by: null, created_by_name: null }),
  // An older row: a stored seller name but no seller id.
  sale("5", { seller_id: null, seller_name: "Köhnə Satıcı", created_by: "u-sebine", created_by_name: "Səbinə Qasımova" }),
];
const ids = (rows) => rows.map((r) => r.id);
const search = (state) => ids(applySearch(ROWS, SALES, { search: "", filters: [], ...state }, ctx, fmt));

// ── Keys and choices ────────────────────────────────────────────────────────

test("a row's key is its id, else its stored name, else Unknown", () => {
  assert.equal(valueKeyOf(ROWS[0], SELLER), "u-omer");
  assert.equal(valueKeyOf(ROWS[4], SELLER), "name:Köhnə Satıcı");
  assert.equal(valueKeyOf(ROWS[3], SELLER), UNKNOWN_VALUE);
});

test("choices: distinct values of the loaded records, with counts, sorted by name, Unknown last", () => {
  const options = valueFilterOptions(ROWS, SELLER, "Naməlum", "az");
  assert.deepEqual(
    options.map((o) => [o.value, o.label, o.count]),
    [
      ["u-aynur", "Aynur Əliyeva", 1],
      ["name:Köhnə Satıcı", "Köhnə Satıcı", 1],
      ["u-omer", "Ömər Çələbiyev", 2],
      [UNKNOWN_VALUE, "Naməlum", 1],
    ]
  );
  const creators = valueFilterOptions(ROWS, CREATOR, "Naməlum", "az");
  assert.deepEqual(creators.map((o) => [o.label, o.count]), [["Ömər Çələbiyev", 1], ["Səbinə Qasımova", 3], ["Naməlum", 1]]);
});

test("by id: two people with the same name stay apart; one id is one choice", () => {
  const rows = [
    sale("a", { seller_id: "id-1", seller_name: "Elvin Məmmədov" }),
    sale("b", { seller_id: "id-2", seller_name: "Elvin Məmmədov" }),
    sale("c", { seller_id: "id-1", seller_name: "Elvin Məmmədov" }),
  ];
  const options = valueFilterOptions(rows, SELLER, "?", "az");
  assert.deepEqual(options.map((o) => [o.value, o.count]).sort(), [["id-1", 2], ["id-2", 1]]);
  assert.deepEqual(ids(applySearch(rows, SALES, { search: "", filters: [], values: { seller_id: ["id-1"] } }, ctx, fmt)), ["a", "c"]);
});

test("an older name-only row joins the one id with that name; a shared name stays apart", () => {
  const rows = [
    sale("n1", { seller_id: "id-ali", seller_name: "Əli Həsənov" }),
    sale("n2", { seller_id: null, seller_name: "Əli Həsənov" }),
    sale("n3", { seller_id: "id-x", seller_name: "Elvin" }),
    sale("n4", { seller_id: "id-y", seller_name: "Elvin" }),
    sale("n5", { seller_id: null, seller_name: "Elvin" }),
  ];
  const options = valueFilterOptions(rows, SELLER, "?", "az");
  assert.deepEqual(options.find((o) => o.value === "id-ali"), { value: "id-ali", label: "Əli Həsənov", count: 2 });
  assert.ok(options.some((o) => o.value === "name:Elvin" && o.count === 1), "two Elvins with ids: the name-only row keeps its own key");
  assert.equal(valueKeyResolver(rows, SELLER)(rows[1]), "id-ali");
  assert.deepEqual(ids(applySearch(rows, SALES, { search: "", filters: [], values: { seller_id: ["id-ali"] } }, ctx, fmt)), ["n1", "n2"]);
});

// ── Matching ────────────────────────────────────────────────────────────────

test("no picks: every row; one pick: that person's rows", () => {
  assert.deepEqual(search({}), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(search({ values: {} }), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(search({ values: { seller_id: ["u-aynur"] } }), ["3"]);
});

test("several picks in one filter are OR'ed", () => {
  assert.deepEqual(search({ values: { seller_id: ["u-omer", "u-aynur"] } }), ["1", "2", "3"]);
});

test("two value filters are AND'ed", () => {
  assert.deepEqual(search({ values: { seller_id: ["u-omer"], created_by: ["u-sebine"] } }), ["1"]);
  assert.deepEqual(search({ values: { seller_id: ["u-aynur"], created_by: ["u-omer"] } }), []);
});

test("value filters AND with the fixed filters and the search", () => {
  // "mine" = seller_id is the current user (u-omer); "draft" = status.
  assert.deepEqual(search({ filters: ["draft"], values: { created_by: ["u-sebine"] } }), ["1"]);
  assert.deepEqual(search({ filters: ["mine"], values: { created_by: ["u-sebine", "u-omer"] } }), ["1", "2"]);
  assert.deepEqual(search({ search: "şüşə", values: { created_by: ["u-sebine"] } }), ["3"]);
  assert.deepEqual(search({ search: "şüşə", values: { seller_id: ["u-omer"] } }), []);
});

test("Unknown matches the rows without the person; a name-only row matches by its name", () => {
  assert.deepEqual(search({ values: { seller_id: [UNKNOWN_VALUE] } }), ["4"]);
  assert.deepEqual(search({ values: { created_by: [UNKNOWN_VALUE] } }), ["4"]);
  assert.deepEqual(search({ values: { seller_id: ["name:Köhnə Satıcı", UNKNOWN_VALUE] } }), ["4", "5"]);
});

test("a picked value no row has (person gone) matches nothing; unknown filter fields are ignored", () => {
  assert.equal(matchesValueFilters(ROWS[0], SALES.valueFilters, { seller_id: ["u-left"] }), false);
  assert.equal(matchesValueFilters(ROWS[0], SALES.valueFilters, { not_a_filter: ["x"] }), true);
  assert.equal(matchesValueFilters(ROWS[0], SALES.valueFilters, undefined), true);
});

test("kanban, pivot, graph and calendar get the same filtered rows (ViewEngine filters once)", () => {
  const engine = read("src/views/components/ViewEngine.tsx");
  assert.match(engine, /const filtered = useMemo\(\(\) => applySearch\(data\.records, def, state, ctx, fmt\)/);
  for (const view of ["KanbanView", "PivotView", "GraphView", "CalendarView"]) assert.match(engine, new RegExp(`<${view}[^>]*records=\\{sorted\\}`), view);
});

// ── State, favourites, flag ─────────────────────────────────────────────────

test("picks: replacing one filter's values keeps the others; empty drops the filter", () => {
  const a = setValuePicks(undefined, "seller_id", ["u-omer", "u-omer", "u-aynur"]);
  assert.deepEqual(a, { seller_id: ["u-omer", "u-aynur"] });
  const b = setValuePicks(a, "created_by", ["u-sebine"]);
  assert.deepEqual(b, { seller_id: ["u-omer", "u-aynur"], created_by: ["u-sebine"] });
  assert.deepEqual(setValuePicks(b, "seller_id", []), { created_by: ["u-sebine"] });
});

test("a saved favourite brings its picks back; junk and unknown filters are dropped", () => {
  const saved = JSON.parse(JSON.stringify({ search: "", filters: ["draft"], values: { seller_id: ["u-omer", "u-omer", 7, ""], created_by: ["u-sebine"], hacked: ["x"] }, groupBy: [], sort: null, view: "kanban" }));
  const state = sanitizeSearchState(saved, SALES);
  assert.deepEqual(state.values, { seller_id: ["u-omer"], created_by: ["u-sebine"] });
  assert.deepEqual(state.filters, ["draft"]);
  assert.equal(state.view, "kanban");
  assert.equal(sanitizeSearchState({ values: "nope" }, SALES).values, undefined);
  assert.equal(sanitizeSearchState({ values: { seller_id: [] } }, SALES).values, undefined);
});

test("flag off: the definition has no value filters, so saved picks are ignored and the list is as today", () => {
  const off = withValueFilters(SALES, false);
  assert.equal(off.valueFilters, undefined);
  assert.equal(withValueFilters(SALES, true), SALES);
  assert.equal(sanitizeSearchState({ values: { seller_id: ["u-aynur"] } }, off).values, undefined);
  assert.deepEqual(ids(applySearch(ROWS, off, { search: "", filters: [], values: { seller_id: ["u-aynur"] } }, ctx, fmt)), ["1", "2", "3", "4", "5"]);
  assert.equal(read("src/views/components/ViewEngine.tsx").includes("valueFilters = false"), true, "off by default");
});

// ── Sales and purchases ─────────────────────────────────────────────────────

test("sales: seller and creator filters by id; the records carry the ids", () => {
  assert.deepEqual(SALES.valueFilters.map((vf) => [vf.field, vf.labelField, vf.labelKey]), [
    ["seller_id", "seller_name", "invoiceTools.filters.seller"],
    ["created_by", "created_by_name", "invoiceTools.filters.createdBy"],
  ]);
  assert.equal(ROWS[0].created_by, "u-sebine");
  assert.deepEqual(validateDefinition(SALES), []);
});

test("purchases: supplier, responsible and creator filters by id", () => {
  assert.deepEqual(PURCHASES.valueFilters.map((vf) => [vf.field, vf.labelField]), [
    ["supplier_id", "supplier_name"],
    ["responsible_id", "responsible_name"],
    ["created_by", "created_by_name"],
  ]);
  assert.deepEqual(validateDefinition(PURCHASES), []);
  const rows = [
    purchaseToRecord({ id: "p1", invoice_number: "AL-1", supplier_id: "s1", supplier_name: "Şəki Ağac", responsible_id: "u-reshad", responsible_name: "Rəşad", created_by: "u-sebine", created_by_name: "Səbinə" }),
    purchaseToRecord({ id: "p2", invoice_number: "AL-2", supplier_id: "s2", supplier_name: "Gəncə Metal", responsible_id: null, responsible_name: "Köhnə Məsul", created_by: null }),
  ];
  const responsible = PURCHASES.valueFilters[1];
  assert.deepEqual(valueFilterOptions(rows, responsible, "?", "az").map((o) => o.value), ["name:Köhnə Məsul", "u-reshad"]);
  assert.deepEqual(ids(applySearch(rows, PURCHASES, { search: "", filters: [], values: { supplier_id: ["s2"] } }, ctx, fmt)), ["p2"]);
  assert.deepEqual(ids(applySearch(rows, PURCHASES, { search: "", filters: [], values: { created_by: [UNKNOWN_VALUE] } }, ctx, fmt)), ["p2"]);
});

test("a value filter on an unknown field is a definition error", () => {
  assert.deepEqual(validateDefinition({ ...SALES, valueFilters: [{ field: "nope", labelKey: "x" }] }), ['valueFilters: unknown field "nope"']);
  assert.deepEqual(validateDefinition({ ...SALES, valueFilters: [SELLER, SELLER] }), ["valueFilters: duplicate fields"]);
});

test("Clear search and a dashboard card also clear the person picks", () => {
  const engine = read("src/views/components/ViewEngine.tsx");
  assert.match(engine, /setTouched\(\{ \.\.\.state, search: "", filters: \[\], values: undefined \}\)/);
  assert.match(engine, /filters: \[\.\.\.preset\.filters\], values: undefined,/);
});

test("a picked person no loaded row has is shown as such, not as Unknown", () => {
  const panel = read("src/views/components/SearchPanel.tsx");
  assert.match(panel, /\?\? nameOfValueKey\(value\) \?\? notLoaded/);
});

// ── Screens, panel, texts ───────────────────────────────────────────────────

test("only the new sales and purchase lists turn them on, with INVOICE_TOOLS; classic lists untouched", () => {
  assert.match(read("src/modules/sales/components/SalesScreen.tsx"), /valueFilters=\{exportOn\}/);
  assert.match(read("src/modules/purchases/components/PurchasesScreen.tsx"), /valueFilters=\{exportOn\}/);
  assert.match(read("src/views/components/EngineScreen.tsx"), /valueFilters=\{valueFilters\}/);
  for (const p of ["src/modules/sales/components/SalesPage.tsx", "src/modules/purchases/components/PurchasesPage.tsx"]) assert.doesNotMatch(read(p), /valueFilters/, p);
});

test("FLT-1: the value filters live in the Filters panel, not in a row of boxes under the search bar", () => {
  const panel = read("src/views/components/SearchPanel.tsx");
  assert.doesNotMatch(panel, /<Combobox/, "no Combobox row under the toolbar (LIST-1)");
  assert.doesNotMatch(panel, /role="group" aria-label=\{t\("views\.valueFilters\.group"\)\}/);
  // The button shows with fixed filters OR value filters.
  assert.match(panel, /\{filters\.length \|\| valueFilters\.length \? \(/);
  assert.match(panel, /<FilterPanel definition=\{def\} state=\{state\} onChange=\{onChange\} fmt=\{fmt\} choices=\{choices\} \/>/);
  // Picks still show as chips in the search bar, and Backspace removes the last one.
  assert.match(panel, /views\.valueFilters\.chip/);
  assert.match(panel, /else if \(picks\.length\) \{/);
  const filterPanel = read("src/views/components/FilterPanel.tsx");
  assert.match(filterPanel, /import \* as Popover from "@radix-ui\/react-popover"/);
  assert.match(filterPanel, /<Popover\.Portal container=\{portalContainer \?\? undefined\}>/);
  // RESP-1: a bottom sheet on phones; OVL-2: never taller than the free space.
  assert.match(filterPanel, /const PHONE = "\(max-width: 767\.98px\)"/);
  assert.match(filterPanel, /className="ds-sheet"/);
  assert.match(filterPanel, /var\(--radix-popover-content-available-height/);
  // One section per value filter (only those of the definition: withValueFilters drops them with the flag off).
  assert.match(filterPanel, /const valueFilters = def\.valueFilters \?\? \[\];[\s\S]*?valueFilters\.map\(\(vf, i\)/);
  // Every list has a name; a tick applies at once (no Apply button).
  assert.match(filterPanel, /aria-labelledby=\{headingId\}/);
  assert.match(filterPanel, /role="group"\s+aria-label=\{label\}\s+aria-labelledby=\{labelledBy\}/);
  assert.doesNotMatch(filterPanel, /apply/i);
});

test("the texts exist in az, en and ru", () => {
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const k of ["search", "searchIn", "empty", "unknown", "chip", "notLoaded"]) assert.ok(m.views.valueFilters[k]?.trim(), `views.valueFilters.${k}`);
    for (const k of ["seller", "createdBy", "supplier", "responsible"]) assert.ok(m.invoiceTools.filters[k]?.trim(), `invoiceTools.filters.${k}`);
    assert.match(m.views.valueFilters.chip, /\{name\}.*\{value\}/);
    assert.match(m.views.valueFilters.clear, /\{name\}/);
  }
  assert.equal(azMessages.invoiceTools.filters.createdBy, "Sənədi yaradan");
  assert.equal(azMessages.invoiceTools.filters.seller, "Satıcı");
});
