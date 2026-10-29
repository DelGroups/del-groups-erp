// Fix F3: every stock exit takes from its own warehouse.
// The database side is checked by supabase/tests/stock_per_warehouse.sql in CI.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { warehouseStockMap, writeoffCandidates } from "../src/modules/inventory/lib/warehouseStockMap.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261029200000_stock_per_warehouse.sql";

test("warehouse stock: exact rows, the legacy row only for the default warehouse", () => {
  const rows = [
    { product_id: "p1", warehouse_id: "B", current_stock: 4 },
    { product_id: "p1", warehouse_id: null, current_stock: 9 },
    { product_id: "p2", warehouse_id: null, current_stock: "3" },
    { product_id: "p3", warehouse_id: "A", current_stock: 2 },
  ];
  const inB = warehouseStockMap(rows, "B", false);
  assert.equal(inB.get("p1"), 4);
  assert.equal(inB.has("p2"), false, "a warehouse-less row is not B's");
  const inA = warehouseStockMap(rows, "A", true);
  assert.equal(inA.get("p1"), 9, "default warehouse: the legacy row counts");
  assert.equal(inA.get("p2"), 3);
  assert.equal(inA.get("p3"), 2);
  // An exact row wins over the legacy row.
  assert.equal(warehouseStockMap([...rows, { product_id: "p2", warehouse_id: "A", current_stock: 1 }], "A", true).get("p2"), 1);
});

test("write-off candidates: stocked in this warehouse, no services, kits or Polywood; stock is the warehouse's", () => {
  const stock = new Map([["a", 5], ["b", 0], ["c", 2], ["d", 3], ["e", 1]]);
  const out = writeoffCandidates(
    [
      { id: "a", stock: 50 },
      { id: "b", stock: 9 },
      { id: "c", stock: 2, is_service: true },
      { id: "d", stock: 3, is_composite: true },
      { id: "e", stock: 1, inventory_mode: "polywood" },
      { id: "f", stock: 7 },
    ],
    stock
  );
  assert.deepEqual(out.map((p) => [p.id, p.stock]), [["a", 5]]);
});

test("one core move: per warehouse, refuses with the warehouse named, not callable by users", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.stock_move\(/);
  assert.match(sql, /anbarında mövcud %s, tələb %s/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.stock_move\(UUID, UUID, NUMERIC, BOOLEAN\) FROM PUBLIC, anon, authenticated/);
  // Never the RAISE form that hides the message ("RAISE option already specified").
  for (const fn of ["stock_move", "build_and_validate_sale_stock_demand", "post_inventory_writeoff", "update_inventory_writeoff"]) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    const body = sql.slice(start, sql.indexOf("$function$;", start) > 0 && fn !== "stock_move" ? sql.indexOf("$function$;", start) : sql.indexOf("\n$$;", start));
    assert.doesNotMatch(body, /RAISE EXCEPTION '[a-z_]+'\s+USING[^;]*MESSAGE/, fn);
  }
});

test("every flow names its warehouse", () => {
  const sql = read(MIGRATION);
  // Sales demand keyed by product and warehouse, kits in the line's warehouse.
  assert.match(sql, /v_key := v_comp \|\| ':' \|\| v_wh;/);
  assert.match(sql, /_stock_demand_add\(v_demand, v_line\.product_id, v_line\.warehouse_id, v_line\.quantity\)/);
  // Production: material warehouse, finished goods into the furniture warehouse, delivery from it.
  assert.match(sql, /COALESCE\(v_material\.warehouse_id, v_order\.raw_material_warehouse_id, v_order\.warehouse_id/);
  assert.match(sql, /COALESCE\(v_order\.furniture_warehouse_id, v_order\.warehouse_id\), v_qty, false/);
  assert.match(sql, /COALESCE\(v_order\.furniture_warehouse_id, v_order\.warehouse_id\), -v_qty, true/);
  // Purchases: into and back out of the purchase warehouse.
  assert.match(sql, /_stock_move_doc\(v_product_id, v_purchase\.warehouse_id, v_qty, false\)/);
  // Polywood cancel: the total from every available piece, not one warehouse's.
  const reverse = sql.slice(sql.indexOf("FUNCTION public._reverse_sales_invoice_posting("), sql.indexOf("FUNCTION public.create_sale_atomic("));
  assert.doesNotMatch(reverse, /AND warehouse_id = v_line\.warehouse_id\s+AND status = 'available'/);
});

test("the browser no longer moves stock for write-offs, sale voids or material returns", () => {
  const writeoff = read("src/modules/inventory/lib/writeoff.ts");
  assert.match(writeoff, /"post_inventory_writeoff"/);
  assert.match(writeoff, /"update_inventory_writeoff"/);
  assert.doesNotMatch(writeoff, /decrementProductStock|applyWriteoffStockDeltas|from\("products"\)\.update/);
  const ar = read("src/lib/finance/customerAr.ts");
  assert.match(ar, /cancel_sales_invoice_atomic/);
  assert.doesNotMatch(ar, /\.update\(\{ stock:/);
  const production = read("src/modules/production/actions/production.ts");
  assert.match(production, /"return_production_material_stock"/);
  assert.doesNotMatch(production, /incrementProductStock/);
  assert.doesNotMatch(read("src/modules/purchases/lib/submitPurchase.ts"), /applyPurchaseStockDeltas|export async function updatePurchase/);
});
