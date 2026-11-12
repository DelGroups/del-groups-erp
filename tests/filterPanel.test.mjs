// FLT-1: the one "Filters" panel of the list toolbar (fixed filters + value filters of INV-3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFilterCount, clearAllFilters, rovingIndex, withValueFilters } from "../src/views/logic.ts";
import { salesDefinition, salesModel } from "../src/modules/sales/views/sales.ts";
import { purchasesDefinition, purchasesModel } from "../src/modules/purchases/views/purchases.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const model = { fetchAll: async () => [], fetchOne: async () => null };
const SALES = salesDefinition(salesModel(model));
const PURCHASES = purchasesDefinition(purchasesModel(model));
const FIXED = SALES.filters.map((f) => f.key);

test("active count: known fixed filters plus every value pick", () => {
  assert.equal(activeFilterCount(SALES, { filters: [] }), 0);
  assert.equal(activeFilterCount(SALES, { filters: [FIXED[0]] }), 1);
  assert.equal(activeFilterCount(SALES, { filters: [FIXED[0]], values: { seller_id: ["u-1", "u-2"], created_by: ["u-3"] } }), 4);
  // A filter key the view does not know (old favourite, edited URL) is not counted.
  assert.equal(activeFilterCount(SALES, { filters: ["nope"], values: {} }), 0);
});

test("active count: with INVOICE_TOOLS off, value picks do not count (no value filters)", () => {
  const off = withValueFilters(SALES, false);
  assert.equal(activeFilterCount(off, { filters: [], values: { seller_id: ["u-1"] } }), 0);
  assert.equal(activeFilterCount(withValueFilters(SALES, true), { filters: [], values: { seller_id: ["u-1"] } }), 1);
});

test("clear all: drops fixed filters and value picks, keeps search, grouping, sort and view", () => {
  const state = { search: "abc", filters: [FIXED[0]], values: { seller_id: ["u-1"] }, groupBy: ["status"], sort: { field: "date", dir: "desc" }, view: "list" };
  const cleared = clearAllFilters(state);
  assert.deepEqual(cleared, { search: "abc", filters: [], values: undefined, groupBy: ["status"], sort: { field: "date", dir: "desc" }, view: "list" });
  assert.equal(activeFilterCount(SALES, cleared), 0);
  assert.deepEqual(state.filters, [FIXED[0]], "the old state is not changed");
});

test("the panel lists value-filter sections only when the flag is on", () => {
  // The panel renders one section per definition.valueFilters; withValueFilters is the flag gate.
  assert.deepEqual(withValueFilters(SALES, true).valueFilters.map((vf) => vf.field), ["seller_id", "created_by"]);
  assert.deepEqual(withValueFilters(PURCHASES, true).valueFilters.map((vf) => vf.field), ["supplier_id", "responsible_id", "created_by"]);
  assert.equal(withValueFilters(SALES, false).valueFilters, undefined);
  assert.equal(withValueFilters(PURCHASES, false).valueFilters, undefined);
  // The fixed filters stay either way.
  assert.deepEqual(withValueFilters(SALES, false).filters.map((f) => f.key), FIXED);
});

test("arrow keys move inside a checkbox list and wrap; Home/End jump; other keys do nothing", () => {
  assert.equal(rovingIndex("ArrowDown", 0, 3), 1);
  assert.equal(rovingIndex("ArrowDown", 2, 3), 0);
  assert.equal(rovingIndex("ArrowUp", 0, 3), 2);
  assert.equal(rovingIndex("ArrowRight", 1, 3), 2);
  assert.equal(rovingIndex("ArrowLeft", 1, 3), 0);
  assert.equal(rovingIndex("Home", 2, 3), 0);
  assert.equal(rovingIndex("End", 0, 3), 2);
  assert.equal(rovingIndex(" ", 0, 3), null);
  assert.equal(rovingIndex("Tab", 0, 3), null);
  assert.equal(rovingIndex("ArrowDown", 0, 0), null);
});

test("texts in az, en and ru, sentence case (TXT-1)", () => {
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const s of [m.views.clearFilters, m.views.filtersActive, m.views.valueFilters.searchIn]) {
      assert.ok(s?.trim());
      assert.notEqual(s, s.toUpperCase());
    }
    assert.match(m.views.filtersActive, /\{count\}/);
    assert.match(m.views.valueFilters.searchIn, /\{name\}/);
    assert.equal(m.views.clearFilters[0], m.views.clearFilters[0].toUpperCase());
    assert.equal(m.views.clearFilters.slice(1), m.views.clearFilters.slice(1).toLowerCase());
  }
  assert.equal(azMessages.views.clearFilters, "Filtri təmizlə");
});
