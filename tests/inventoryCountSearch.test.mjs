// Inventory count search: products missing from the count list can be found and added.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  catalogIlikePattern,
  countCatalogState,
  markCatalogHits,
  matchesCountQuery,
  normalizeCountQuery,
} from "../src/modules/inventory/lib/inventoryCountSearch.ts";

const line = (product_name, product_code = null, barcode = null) => ({ product_name, product_code, barcode });

test("search ignores case and repeated spaces in hand-typed names", () => {
  assert.equal(normalizeCountQuery("  401   Matt "), "401 matt");
  assert.ok(matchesCountQuery(line("1070 MATT  SINELIK"), "1070 matt sinelik"));
  assert.ok(matchesCountQuery(line("401 MATT", "PW-401-M"), "pw-401"));
  assert.ok(matchesCountQuery(line("X", null, "4760001"), "476"));
  assert.ok(!matchesCountQuery(line("402 MATT", "PW-402-M"), "401 matt"));
  assert.ok(matchesCountQuery(line("anything"), "   "));
});

test("catalog pattern turns words into wildcards and drops filter-breaking characters", () => {
  assert.equal(catalogIlikePattern("401 matt"), "%401%matt%");
  assert.equal(catalogIlikePattern("a,b(c)"), "%a%b%c%");
  assert.equal(catalogIlikePattern("4"), null);
  assert.equal(catalogIlikePattern("  "), null);
  assert.equal(catalogIlikePattern("%_"), null);
});

test("a zero-stock product that is not a count line is offered for adding", () => {
  // INV-2026-0003 (Polywood › MATT) listed 103 MATT DOUBLE but not 401 MATT,
  // which had no available pieces when counting started.
  const lines = [{ product_id: "p-103md" }];
  const hits = [
    { id: "p-401m", name: "401 MATT" },
    { id: "p-103md", name: "103 MATT DOUBLE" },
  ];
  assert.deepEqual(
    markCatalogHits(hits, lines).filter((hit) => !hit.inCount),
    [{ id: "p-401m", name: "401 MATT", inCount: false }]
  );
});

test("the add-product migration only accepts in-progress counts and stockable products", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261017100000_inventory_count_add_product.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /_inventory_count_lock\(p_count_id, ARRAY\['in_progress'\]\)/);
  assert.match(sql, /_inventory_count_authorize\('can_writeoff_inventory'\)/);
  assert.match(sql, /is_service.*is_composite/s);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.inventory_count_add_product\(UUID, UUID\) FROM PUBLIC, anon/);
});

test("a scan that matches no code falls back to the name search", () => {
  const source = readFileSync(
    new URL("../src/modules/inventory/components/InventoryCountDetailPage.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /result\.error\.startsWith\(PRODUCT_NOT_FOUND\)/);
  assert.match(source, /setQuery\(code\.trim\(\)\)/);
});

test("the list filter matches words in order, like the catalog pattern", () => {
  // A catalog hit for "401 matt" (%401%matt%) must also show in the filtered table once added.
  assert.ok(matchesCountQuery(line("401 SUPER MATT"), "401 matt"));
  assert.ok(matchesCountQuery(line("Plate (A,B)"), "plate a,b"));
  assert.ok(!matchesCountQuery(line("MATT 401"), "401 matt"));
  assert.ok(matchesCountQuery(line("anything"), "%_"));
});

test("the catalog list shows whenever the search box has text during counting", () => {
  assert.equal(countCatalogState(true, "", ""), "hidden");
  assert.equal(countCatalogState(true, "   ", ""), "hidden");
  assert.equal(countCatalogState(false, "401 matt", "401 matt"), "hidden");
  assert.equal(countCatalogState(true, "4", ""), "short");
  assert.equal(countCatalogState(true, "401 matt", ""), "loading");
  assert.equal(countCatalogState(true, "401 matt", "401 mat"), "loading");
  assert.equal(countCatalogState(true, "401 matt", "401 matt"), "ready");
});

test("catalog hits already in the count are marked and listed after the ones to add", () => {
  const lines = [{ product_id: "p-103md" }];
  const hits = [
    { id: "p-103md", name: "103 MATT DOUBLE" },
    { id: "p-401m", name: "401 MATT" },
    { id: "p-402m", name: "402 MATT" },
  ];
  assert.deepEqual(markCatalogHits(hits, lines), [
    { id: "p-401m", name: "401 MATT", inCount: false },
    { id: "p-402m", name: "402 MATT", inCount: false },
    { id: "p-103md", name: "103 MATT DOUBLE", inCount: true },
  ]);
  assert.deepEqual(markCatalogHits([], lines), []);
});

test("the catalog list sits above the table and the old list below it is gone", () => {
  const source = readFileSync(
    new URL("../src/modules/inventory/components/InventoryCountDetailPage.tsx", import.meta.url),
    "utf8"
  );
  const list = source.indexOf('catalogState !== "hidden"');
  const table = source.indexOf("<table");
  assert.ok(list > 0 && table > list, "catalog list must come before the table");
  assert.doesNotMatch(source, /missingProducts/);
  assert.match(source, /product\.inCount \?/);
});

test("a category count takes every stockable product of the category", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261017110000_inventory_count_start_all_category_products.sql", import.meta.url),
    "utf8"
  );
  // Same module guard as the add-product migration.
  assert.match(sql, /to_regclass\('public\.inventory_count_items'\) IS NOT NULL/);
  assert.match(sql, /EXECUTE \$fn\$[\s\S]*CREATE OR REPLACE FUNCTION public\.inventory_count_start\(p_count_id UUID\)[\s\S]*\$fn\$;/);
  // Unchanged workflow guards.
  assert.match(sql, /_inventory_count_authorize\('can_writeoff_inventory'\)/);
  assert.match(sql, /_inventory_count_lock\(p_count_id, ARRAY\['draft'\]\)/);
  assert.match(sql, /o\.status IN \('in_progress', 'review'\)/);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(ORDER BY c\.name, c\.code\)/);
  assert.match(sql, /inventory_count_refresh_totals\(v_doc\.id\)/);
  // Category branch reads products directly; the stocked list is only for whole-warehouse counts.
  assert.match(sql, /FROM public\.products p\s+JOIN public\.product_category_paths cp[\s\S]*?WHERE v_doc\.category_name IS NOT NULL\s+AND NOT COALESCE\(p\.is_service, FALSE\)\s+AND NOT COALESCE\(p\.is_composite, FALSE\)/);
  assert.match(sql, /inventory_warehouse_product_ids\(v_doc\.warehouse_id\) w\s+WHERE v_doc\.category_name IS NULL/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.inventory_count_start\(UUID\) FROM PUBLIC, anon/);

  const preflight = readFileSync(new URL("../supabase/scripts/tenant1_preflight.sql", import.meta.url), "utf8");
  assert.match(preflight, /20261017110000_inventory_count_start_all_category_products/);
});
