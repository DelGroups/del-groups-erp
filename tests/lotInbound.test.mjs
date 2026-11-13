// LOT-2: inbound documents create named lots. The lot fields' logic and the payloads the forms
// send; the database side is tested in supabase/tests/lot_inbound.sql (CI: db-baseline).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addLot,
  defaultExpiry,
  isEmptyLot,
  lotFromRow,
  lotIssues,
  lotPayloadKeys,
  lotQuantities,
  lotSplitIssue,
  lotSummary,
  normalizeLot,
  receiptLotsPayload,
  removeLot,
  singleLot,
} from "../src/modules/inventory/lib/lotFields.ts";
import { parseLineLot } from "../src/modules/imports/lib/shipment.ts";
import { checkReceipt, parsePostingError, POSTING_ERROR_CODES } from "../src/modules/imports/lib/posting.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("lot fields: normalized, empty means nothing is sent", () => {
  assert.deepEqual(normalizeLot({ lotNo: "  L-1 ", supplierBatchNo: "", mfgDate: "2026-11-01T00:00", expDate: "bad" }), {
    lotNo: "L-1",
    supplierBatchNo: null,
    mfgDate: "2026-11-01",
    expDate: null,
  });
  assert.equal(isEmptyLot(undefined), true);
  assert.equal(isEmptyLot({ lotNo: " " }), true);
  assert.deepEqual(lotPayloadKeys(undefined), {}, "old payloads stay exactly as they were");
  assert.deepEqual(lotPayloadKeys({ lotNo: "L-1", expDate: "2027-01-01" }), { lot_no: "L-1", exp_date: "2027-01-01" });
  assert.deepEqual(lotPayloadKeys({ lotNo: "L-1", supplierBatchNo: "SB" }, "planned"), { lot_no_planned: "L-1", supplier_batch_no: "SB" });
  assert.deepEqual(lotFromRow({ lot_no_planned: "P-1", mfg_date: "2026-10-01" }), { lotNo: "P-1", supplierBatchNo: null, mfgDate: "2026-10-01", expDate: null });
  assert.equal(lotFromRow({ lot_no: null }), undefined);
  assert.equal(lotSummary({ lotNo: "L-1", supplierBatchNo: "SB", expDate: "2027-01-01" }), "L-1 · SB · 2027-01-01");
});

test("lot rules: manual_required, shelf life, dates", () => {
  assert.equal(defaultExpiry("2026-01-31", 30), "2026-03-02");
  assert.equal(defaultExpiry(null, 30), null);
  const policy = { manualRequired: true, shelfLifeDays: 365 };
  assert.deepEqual(lotIssues({}, policy), ["batchRequired", "expRequired"]);
  assert.deepEqual(lotIssues({ supplierBatchNo: "SB", mfgDate: "2026-01-01" }, policy), [], "expiry defaults from the production date");
  assert.deepEqual(lotIssues({ mfgDate: "2026-02-01", expDate: "2026-01-01" }), ["datesInvalid"]);
  assert.deepEqual(lotIssues({ lotNo: "x".repeat(61) }), ["lotNoTooLong"]);
});

test("split into lots: whole row by default, sum checked live, whole sheets for Polywood", () => {
  let rows = singleLot({ lotNo: "PLAN-1", supplierBatchNo: "SB" });
  assert.equal(rows.length, 1);
  assert.deepEqual(lotQuantities(rows, 10), [10]);
  assert.equal(lotSplitIssue(rows, 10), null);
  rows = addLot(rows, 10);
  assert.deepEqual(rows.map((r) => r.qty), [10, 0]);
  assert.equal(lotSplitIssue(rows, 10), "emptyQty");
  rows = [{ ...rows[0], qty: 6 }, { ...rows[1], qty: 3 }];
  assert.equal(lotSplitIssue(rows, 10), "sumMismatch");
  rows = [rows[0], { ...rows[1], qty: 4, lotNo: "PLAN-1" }];
  assert.equal(lotSplitIssue(rows, 10), "duplicateLotNo");
  rows = [rows[0], { ...rows[1], lotNo: "L-2" }];
  assert.equal(lotSplitIssue(rows, 10), null);
  assert.deepEqual(receiptLotsPayload(rows, 10), [
    { qty_stock_unit: 6, lot_no: "PLAN-1", supplier_batch_no: "SB" },
    { qty_stock_unit: 4, lot_no: "L-2" },
  ]);
  // Back to one lot: it takes the whole row again.
  const back = removeLot(rows, rows[1].key);
  assert.equal(back.length, 1);
  assert.equal(back[0].qty, null);
  // Sheets: 8 m of 4 m sheets split 4 + 4, not 6 + 2.
  assert.equal(lotSplitIssue([{ ...rows[0], qty: 6 }, { ...rows[1], qty: 2 }], 8, 4), "wholeSheets");
  assert.equal(lotSplitIssue([{ ...rows[0], qty: 4 }, { ...rows[1], qty: 4 }], 8, 4), null);
});

test("import receipt payload: lots only when the dialog has them", () => {
  const lines = [{ shipmentLineId: "l1", productId: "p1", orderedStock: 10, received: 0, remaining: 10, sheetLengthM: null, purchaseUnit: "pcs", defaultWarehouseId: "w1" }];
  const row = { key: "r1", shipmentLineId: "l1", warehouseId: "w1", expected: 10, actual: null };
  // Flag off: no `lots` key at all.
  const off = checkReceipt([row], lines);
  assert.deepEqual(Object.keys(off.payload[0]).sort(), ["expected_qty_stock_unit", "qty_stock_unit", "shipment_line_id", "warehouse_id"]);
  const check = (lots, qty, line) => ({ ok: !lotSplitIssue(lots, qty, line.sheetLengthM), payload: receiptLotsPayload(lots, qty) });
  // Flag on: the row's lots are sent, and a split that does not add up blocks posting.
  const lots = [{ key: "a", qty: 7, lotNo: "L-A", supplierBatchNo: null, mfgDate: null, expDate: null }, { key: "b", qty: 3, lotNo: null, supplierBatchNo: "SB", mfgDate: null, expDate: null }];
  const on = checkReceipt([{ ...row, lots }], lines, check);
  assert.deepEqual(on.issues, []);
  assert.deepEqual(on.payload[0].lots, [{ qty_stock_unit: 7, lot_no: "L-A" }, { qty_stock_unit: 3, supplier_batch_no: "SB" }]);
  const bad = checkReceipt([{ ...row, lots: [{ ...lots[0], qty: 5 }, lots[1]] }], lines, check);
  assert.deepEqual(bad.issues.map((i) => i.code), ["lots"]);
});

test("planned lots of import lines and the lot error codes", () => {
  assert.equal(parseLineLot(undefined), undefined);
  assert.equal(parseLineLot({ lotNo: "" }), undefined);
  assert.deepEqual(parseLineLot({ lot_no_planned: "P-1", exp_date: "2027-05-01" }), { lotNo: "P-1", supplierBatchNo: null, mfgDate: null, expDate: "2027-05-01" });
  assert.deepEqual(parsePostingError("lot_batch_required: X: istehsalçının partiya nömrəsini yazın"), { code: "lot_batch_required", detail: "X: istehsalçının partiya nömrəsini yazın" });
  for (const code of ["lot_split_sum", "lot_batch_required", "lot_exp_required", "lot_dates_invalid", "lot_no_taken", "lot_no_duplicate"]) {
    assert.ok(POSTING_ERROR_CODES.includes(code), code);
    for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.importPosting.errors[code]?.trim(), `${code} text`);
  }
});

test("every lot text exists in az, en and ru", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : keys(v, `${p}${k}.`))).sort();
  const base = keys(enMessages.lots);
  for (const m of [azMessages, ruMessages]) assert.deepEqual(keys(m.lots), base);
  for (const k of ["auto", "fields.lotNo", "fields.supplierBatchNo", "fields.mfgDate", "fields.expDate", "split.action", "splitIssues.sumMismatch", "labels.print"]) {
    assert.ok(base.includes(k), k);
  }
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.importPosting.receiveIssues.lots.trim());
    for (const k of ["lotNoDuplicate", "lotNoTaken", "lotDatesInvalid"]) assert.ok(m.imports.errors[k]?.trim(), k);
  }
  assert.equal(azMessages.lots.split.action, "Lotlara böl");
});

test("wiring: behind LOT_TRACKING, through the inventory module's public API only", () => {
  const index = read("src/modules/inventory/index.ts");
  for (const name of ["LotFieldsEditor", "LotSplitEditor", "LotChip", "LotLabelsSheet", "lotLineColumns", "useLotTracking", "lotPayloadKeys"]) {
    assert.match(index, new RegExp(`\\b${name}\\b`), name);
  }
  for (const file of [
    "src/modules/imports/components/ImportLinesGrid.tsx",
    "src/modules/imports/components/PostingPanel.tsx",
    "src/modules/purchases/components/PurchaseLinesGrid.tsx",
  ]) {
    const src = read(file);
    assert.match(src, /from "@\/modules\/inventory"/, file);
    assert.doesNotMatch(src, /@\/modules\/inventory\/(components|lib)/, file);
    assert.match(src, /useLotTracking\(\)/, file);
  }
  assert.match(read("src/modules/imports/components/ImportLinesGrid.tsx"), /\.\.\.\(lotOn\s*\? lotLineColumns/);
  assert.match(read("src/modules/purchases/components/PurchaseLinesGrid.tsx"), /\.\.\.\(lotOn \? lotLineColumns/);
  assert.match(read("src/modules/inventory/components/InitialBalanceForm.tsx"), /\.\.\.\(lotOn \? lotLineColumns/);
  const panel = read("src/modules/imports/components/PostingPanel.tsx");
  assert.match(panel, /lotOn \? \(lots, qty, line\) =>/, "lots are checked only with the flag on");
  assert.match(panel, /linkable=\{lotOn\}/, "the lot card link only with the flag on");
  assert.match(read("src/app/layout.tsx"), /<LotTrackingProvider enabled=\{isLotTrackingEnabled\(\)\} audience=\{lotTrackingAudience\(\)\}>/);
  // The initial balance posts through the lot RPCs and falls back before the migration.
  const ib = read("src/modules/inventory/actions/initialBalance.ts");
  assert.match(ib, /"lot_post_inbound_line"/);
  assert.match(ib, /"lot_insert_inbound_pieces"/);
  assert.match(ib, /if \(!isMissingFunction\(error\)\) throw new Error\(error\.message\);\s+await adjustProductStockAtWarehouse/);
});

test("migration: replaces the inbound functions with lot contexts, guards module tables", () => {
  const sql = read("supabase/migrations/20261115110000_lot_inbound.sql");
  assert.match(sql, /to_regprocedure\('public\._lot_create\(uuid, jsonb\)'\) IS NULL/, "needs LOT-1");
  for (const fn of [
    "import_shipment_save_draft",
    "receive_import_shipment",
    "cancel_import_shipment",
    "save_purchase_invoice_draft",
    "post_purchase_invoice_draft",
    "process_purchase_receipt_event",
    "_reverse_purchase_invoice_posting",
    "unpost_inventory_initial_balance",
    "inventory_count_post",
    "inventory_count_unpost",
    "process_production_ready_event",
  ]) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), fn);
  }
  for (const table of ["purchases", "purchase_items", "inventory_counts", "inventory_initial_balance_items", "production_orders"]) {
    assert.ok(sql.includes(`to_regclass('public.${table}') IS NOT NULL`), table);
  }
  assert.ok((sql.match(/lot_ctx_begin\(/g) ?? []).length >= 8, "a context around each stock change");
  assert.equal((sql.match(/lot_ctx_begin\(/g) ?? []).length - (sql.match(/lot_ctx_end\(\)/g) ?? []).length <= 0, true, "every context is ended");
  assert.match(sql, /'mode', 'reverse'/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.lot_post_inbound_line\(JSONB, UUID, UUID, NUMERIC, JSONB\) TO service_role;/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.lot_post_inbound_line[^;]*authenticated/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/lot_inbound\.sql/);
});
