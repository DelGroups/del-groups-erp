// Inventory count search: products missing from the count list can be found and added.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  catalogIlikePattern,
  matchesCountQuery,
  normalizeCountQuery,
  productsMissingFromCount,
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
  assert.deepEqual(productsMissingFromCount(hits, lines), [{ id: "p-401m", name: "401 MATT" }]);
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
