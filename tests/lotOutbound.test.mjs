// LOT-3: outbound and moving documents record their lots. The LotPicker's allocation logic, the
// payloads the forms send (no "lots" key while nothing is chosen or the flag is off) and the
// transfer route switch; the database side is tested in supabase/tests/lot_outbound.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addSplitRow,
  choiceFromPayload,
  choiceSummary,
  chooseSingle,
  followQuantity,
  lotChoiceErrorCode,
  lotChoiceIssue,
  lotExpiry,
  lotsOfLine,
  lotsPayload,
  sortLotsFefo,
  suggestFefo,
} from "../src/modules/inventory/lib/lotPicker.ts";
import { isMissingRpc, transferIdFromRpc, transferPath, transferRpcPayload } from "../src/modules/inventory/lib/stockTransferRpc.ts";
import { mapSaleItemToRpcPayload, saleLineLots } from "../src/modules/sales/lib/submitSale.ts";
import { mapSaleToInvoicePrint } from "../src/modules/sales/lib/mapSaleToInvoicePrint.ts";
import { sanitizeAddProductionMaterialInput } from "../src/modules/production/lib/materialInsert.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const TODAY = "2026-11-13";
const lot = (id, lotNo, qty, expDate = null, status = "active", receivedDate = "2026-01-01") => ({
  id,
  lotNo,
  supplierBatchNo: null,
  expDate,
  receivedDate,
  status,
  qty,
});
const LOTS = [
  lot("q", "L-Q", 2, "2026-11-20", "quarantine"),
  lot("b", "L-B", 5, "2027-03-01"),
  lot("a", "L-A", 5, "2026-12-01"),
  lot("n", "L-N", 4, null),
  lot("x", "L-X", 3, "2026-11-01"),
  lot("z", "L-Z", 0, "2026-11-15"),
];

test("expiry: expired, near (30 days), ok, none", () => {
  assert.equal(lotExpiry("2026-11-12", TODAY), "expired");
  assert.equal(lotExpiry("2026-11-13", TODAY), "near");
  assert.equal(lotExpiry("2026-12-13", TODAY), "near");
  assert.equal(lotExpiry("2026-12-14", TODAY), "ok");
  assert.equal(lotExpiry(null, TODAY), "none");
  assert.equal(lotExpiry("bad", TODAY), "none");
});

test("FEFO order: active lots by expiry (no date last), empty lots dropped, quarantine last", () => {
  assert.deepEqual(
    sortLotsFefo(LOTS).map((l) => l.lotNo),
    ["L-X", "L-A", "L-B", "L-N", "L-Q"],
  );
});

test("FEFO suggestion: across two lots, never a quarantined one, reports what is short", () => {
  const withoutExpired = LOTS.filter((l) => l.id !== "x");
  assert.deepEqual(suggestFefo(withoutExpired, 7), { choice: [{ lotId: "a", qty: 5 }, { lotId: "b", qty: 2 }], short: 0 });
  assert.deepEqual(suggestFefo(withoutExpired, 20), {
    choice: [{ lotId: "a", qty: 5 }, { lotId: "b", qty: 5 }, { lotId: "n", qty: 4 }],
    short: 6,
  });
  assert.deepEqual(suggestFefo([], 3), { choice: [], short: 3 });
});

test("choice issues: the same rules the database checks", () => {
  const opts = { today: TODAY, canManage: false };
  assert.equal(lotChoiceIssue(null, 5, LOTS, opts), null, "automatic is always fine");
  assert.equal(lotChoiceIssue([{ lotId: "a", qty: 5 }], 5, LOTS, opts), null);
  assert.equal(lotChoiceIssue([{ lotId: "a", qty: 3 }, { lotId: "b", qty: 2 }], 5, LOTS, opts), null);
  assert.equal(lotChoiceIssue([{ lotId: "a", qty: 3 }], 5, LOTS, opts), "sumMismatch");
  assert.equal(lotChoiceIssue([{ lotId: "a", qty: 6 }], 6, LOTS, opts), "short");
  assert.equal(lotChoiceIssue([{ lotId: "q", qty: 1 }], 1, LOTS, opts), "blocked");
  assert.equal(lotChoiceIssue([{ lotId: "x", qty: 1 }], 1, LOTS, opts), "expired");
  assert.equal(lotChoiceIssue([{ lotId: "x", qty: 1 }], 1, LOTS, { today: TODAY, canManage: true }), null, "lots.manage may choose an expired lot");
  assert.equal(lotChoiceIssue([{ lotId: "nope", qty: 1 }], 1, LOTS, opts), "unknown");
  assert.equal(lotChoiceIssue([{ lotId: "a", qty: 0 }, { lotId: "b", qty: 1 }], 1, LOTS, opts), "emptyQty");
  assert.equal(lotChoiceIssue([{ lotId: "a", qty: 1 }, { lotId: "a", qty: 1 }], 2, LOTS, opts), "duplicate");
});

test("single lot follows the line quantity; a split stays; add a row with what is missing", () => {
  assert.deepEqual(chooseSingle("a", 4.12345), [{ lotId: "a", qty: 4.123 }]);
  assert.deepEqual(followQuantity([{ lotId: "a", qty: 1 }], 3), [{ lotId: "a", qty: 3 }]);
  assert.deepEqual(followQuantity([{ lotId: "a", qty: 1 }, { lotId: "b", qty: 1 }], 3), [{ lotId: "a", qty: 1 }, { lotId: "b", qty: 1 }]);
  assert.equal(followQuantity(null, 3), null);
  assert.equal(followQuantity([], 3), null);
  assert.deepEqual(addSplitRow([{ lotId: "a", qty: 5 }], 7, LOTS), [{ lotId: "a", qty: 5 }, { lotId: "x", qty: 2 }]);
  assert.deepEqual(
    addSplitRow([{ lotId: "x", qty: 3 }, { lotId: "a", qty: 5 }], 10, LOTS),
    [{ lotId: "x", qty: 3 }, { lotId: "a", qty: 5 }, { lotId: "b", qty: 2 }],
  );
});

test("payload: [{lot_id, qty}] when chosen, nothing for automatic; stored lots read back", () => {
  assert.equal(lotsPayload(null), undefined);
  assert.equal(lotsPayload([]), undefined);
  assert.deepEqual(lotsPayload([{ lotId: "a", qty: 1.00049 }]), [{ lot_id: "a", qty: 1 }]);
  assert.deepEqual(choiceFromPayload([{ lot_id: "a", qty: "2" }, { bad: 1 }]), [{ lotId: "a", qty: 2 }]);
  assert.equal(choiceFromPayload(null), null);
  assert.equal(choiceSummary([{ lotId: "a", qty: 5 }], LOTS), "L-A");
  assert.equal(choiceSummary([{ lotId: "a", qty: 5 }, { lotId: "b", qty: 2 }], LOTS), "L-A ×5 · L-B ×2");
  assert.equal(choiceSummary(null, LOTS), null);
});

test("database error codes of a refused choice", () => {
  assert.equal(lotChoiceErrorCode('lot_choice_short: "L-1" lotunda ...'), "short");
  assert.equal(lotChoiceErrorCode("lot_choice_expired: ..."), "expired");
  assert.equal(lotChoiceErrorCode("other"), null);
});

test("posted document chips: by line, else by product, merged per lot, net of returns", () => {
  const rows = [
    { lineId: "l1", productId: "p", lotId: "a", lotNo: "L-A", qty: 5 },
    { lineId: "l1", productId: "p", lotId: "b", lotNo: "L-B", qty: 2 },
    { lineId: "l1", productId: "p", lotId: "b", lotNo: "L-B", qty: -2 },
    { lineId: "l2", productId: "p", lotId: "a", lotNo: "L-A", qty: 1 },
    { lineId: null, productId: "k", lotId: "c", lotNo: "L-C", qty: 3 },
  ];
  assert.deepEqual(lotsOfLine(rows, { lineId: "l1", productId: "p" }).map((r) => `${r.lotNo}:${r.qty}`), ["L-A:5"]);
  assert.deepEqual(lotsOfLine(rows, { lineId: "zz", productId: "k" }).map((r) => r.lotNo), ["L-C"]);
  assert.deepEqual(lotsOfLine(rows, { lineId: null, productId: null }), []);
});

test("sale line payload: lots only when chosen; a single lot takes the whole line; Polywood never", () => {
  const base = {
    id: "row-1",
    product_id: "00000000-0000-0000-0000-000000000001",
    product_code: "P",
    product_name: "Product",
    warehouse_id: "00000000-0000-0000-0000-0000000000a1",
    warehouse_name: "A",
    quantity: 4,
    unit: "Ədəd",
    unit_price: 10,
    discount_percent: 0,
    vat_rate: 0,
    total: 40,
    extra_info: "",
  };
  const plain = mapSaleItemToRpcPayload(base, true);
  assert.equal("lots" in plain, false, "flag off / automatic: the payload is as before");
  assert.equal("lots" in mapSaleItemToRpcPayload({ ...base, lots: [] }, true), false);
  assert.deepEqual(mapSaleItemToRpcPayload({ ...base, lots: [{ lot_id: "l-1", qty: 1 }] }, true).lots, [{ lot_id: "l-1", qty: 4 }]);
  assert.deepEqual(
    mapSaleItemToRpcPayload({ ...base, lots: [{ lot_id: "l-1", qty: 3 }, { lot_id: "l-2", qty: 1 }] }, true).lots,
    [{ lot_id: "l-1", qty: 3 }, { lot_id: "l-2", qty: 1 }],
  );
  assert.equal(saleLineLots({ ...base, polywood_sale_mode: "linear_m", lots: [{ lot_id: "l-1", qty: 4 }] }), undefined);
});

test("invoice print: lot numbers under a line only when given", () => {
  const sale = {
    id: "s1",
    doc_no: "S-1",
    doc_date: "2026-11-13",
    customer_name: "C",
    total_amount: 10,
    paid_amount: 0,
    remaining_balance: 10,
    items: [{ id: "i1", product_id: "p1", product_code: "P", product_name: "Product", quantity: 1, unit: "Ədəd", unit_price: 10, total: 10, discount_percent: 0, vat_rate: 0, extra_info: "", warehouse_id: "w", warehouse_name: "W" }],
  };
  assert.equal(mapSaleToInvoicePrint(sale).lines[0].lotNumbers, undefined);
  assert.deepEqual(mapSaleToInvoicePrint(sale, { lotNumbers: (lineId) => (lineId === "i1" ? ["L-A", "L-B"] : []) }).lines[0].lotNumbers, ["L-A", "L-B"]);
  const layout = read("src/components/print/InvoicePrintLayout.tsx");
  assert.match(layout, /line\.lotNumbers\?\.length/);
});

test("production material: lots kept only when chosen", () => {
  const input = { product_id: "p", quantity: 2, warehouse_id: "w" };
  assert.equal("lots" in sanitizeAddProductionMaterialInput(input), false);
  assert.deepEqual(
    sanitizeAddProductionMaterialInput({ ...input, lots: [{ lot_id: "00000000-0000-0000-0000-0000000000aa", qty: 2 }, { lot_id: "bad", qty: 1 }] }).lots,
    [{ lot_id: "00000000-0000-0000-0000-0000000000aa", qty: 2 }],
  );
  const action = read("src/modules/production/actions/production.ts");
  assert.match(action, /safeInput\.lots\?\.length && isLotTrackingEnabled\(\)/);
  assert.match(action, /if \(patch\.lots !== undefined\) payload\.lots = patch\.lots;/);
});

test("transfer: the route uses post_stock_transfer only while LOT_TRACKING is on", () => {
  assert.equal(transferPath(true), "rpc");
  assert.equal(transferPath(false), "legacy");
  const route = read("src/app/api/inventory/transfers/route.ts");
  assert.match(route, /atomic: transferPath\(isLotTrackingEnabled\(\)\) === "rpc"/);
  const server = read("src/modules/inventory/lib/stockTransferServer.ts");
  assert.match(server, /if \(options\.atomic\)/);
  assert.match(server, /rpc\("post_stock_transfer"/);
  assert.match(server, /if \(!isMissingRpc\(error\)\) return \{ success: false, error: error\.message \};/, "before the SQL runs it falls back to the old path");
  assert.equal(isMissingRpc({ code: "PGRST202", message: "" }), true);
  assert.equal(isMissingRpc({ message: "Could not find the function public.post_stock_transfer" }), true);
  assert.equal(isMissingRpc({ code: "22023", message: "lot_choice_short: ..." }), false);
  assert.equal(transferIdFromRpc({ success: true, transfer_id: "t-1" }), "t-1");
  assert.equal(transferIdFromRpc(null), null);
});

test("transfer payload: lots only on lines that chose them, never on an offcut", () => {
  const payload = { from_warehouse_id: "w1", to_warehouse_id: "w2", transfer_date: "2026-11-13", notes: " n ", created_by: "u", items: [] };
  const lines = [
    { id: "1", product_id: "p", product_code: "P", product_name: "P", unit: "Ədəd", quantity: 3, available_stock: 5, lots: [{ lot_id: "a", qty: 3 }] },
    { id: "2", product_id: "p", product_code: "P", product_name: "P", unit: "Ədəd", quantity: 1, available_stock: 5 },
    { id: "3", product_id: "q", product_code: "Q", product_name: "Q", unit: "Metr", quantity: 1.5, available_stock: 1.5, offcut_id: "pc", lots: [{ lot_id: "b", qty: 1.5 }] },
  ];
  const body = transferRpcPayload(payload, lines, "TRN-2026-1234");
  assert.equal(body.reference_number, "TRN-2026-1234");
  assert.equal(body.notes, "n");
  assert.deepEqual(body.items[0].lots, [{ lot_id: "a", qty: 3 }]);
  assert.equal("lots" in body.items[1], false);
  assert.equal("lots" in body.items[2], false);
  assert.equal(body.items[2].offcut_id, "pc");
});

test("forms: the lot column only with the flag; the public API only", () => {
  const files = [
    "src/modules/sales/components/SalesLinesGrid.tsx",
    "src/modules/consignment/components/ConsignmentDispatchNewPage.tsx",
    "src/modules/production/components/ProductionInProgressPhase.tsx",
  ];
  for (const f of files) {
    const src = read(f);
    assert.match(src, /from "@\/modules\/inventory"/, `${f} imports the inventory public API`);
    assert.doesNotMatch(src, /@\/modules\/inventory\//, `${f} does not reach into the inventory module`);
    assert.match(src, /useLotTracking\(\)/, `${f} reads the flag`);
  }
  for (const f of ["src/modules/inventory/components/DamagedGoodsForm.tsx", "src/modules/inventory/components/StockTransferNewPage.tsx"]) {
    assert.match(read(f), /\.\.\.\(lotsOn\s*\?/, `${f}: the lot column only with the flag`);
  }
  assert.match(read("src/modules/sales/components/SalesLinesGrid.tsx"), /\.\.\.\(lotsOn\s*\?/);
  assert.match(read("src/modules/inventory/lib/writeoff.ts"), /return lots \? \{ \.\.\.row, lots \} : row;/);
});

test("settings: Lots page behind the flag, admins only", () => {
  const items = read("src/lib/settings/items.ts");
  assert.match(items, /id: "lot-tracking".*adminOnly: true, flag: "lotTracking"/);
  assert.match(read("src/app/settings/lot-tracking/page.tsx"), /if \(!isLotTrackingEnabled\(\)\) notFound\(\);/);
  assert.match(read("src/modules/inventory/manifest.ts"), /prefix: "\/settings\/lot-tracking", permission: "can_manage_settings"/);
});

test("i18n: every LOT-3 key in az, en and ru with the same placeholders", () => {
  const groups = ["picker", "pickerIssues", "settings"];
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const g of groups) {
    const keys = Object.keys(azMessages.lots[g]);
    assert.ok(keys.length > 0, g);
    for (const m of [enMessages, ruMessages]) {
      assert.deepEqual(Object.keys(m.lots[g]).sort(), keys.slice().sort(), `lots.${g}`);
      for (const k of keys) assert.equal(ph(m.lots[g][k]), ph(azMessages.lots[g][k]), `lots.${g}.${k}`);
    }
  }
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.settingsNav.lotTracking.title && m.settingsNav.lotTracking.description);
    assert.match(m.print.lotNumbers, /\{lots\}/);
    assert.ok(m.invoice.salesLines.lots);
  }
  for (const issue of ["sumMismatch", "emptyQty", "short", "blocked", "expired", "unknown", "duplicate"]) {
    assert.ok(azMessages.lots.pickerIssues[issue], issue);
  }
});

test("migration: LOT-3 after LOT-1 and LOT-2, module guards, helpers not callable by users", () => {
  const sql = read("supabase/migrations/20261115120000_lot_outbound.sql");
  assert.match(sql, /Run 20261115100000_lot_core\.sql \(LOT-1\) before 20261115120000_lot_outbound\.sql/);
  assert.match(sql, /Run 20261115110000_lot_inbound\.sql \(LOT-2\) before 20261115120000_lot_outbound\.sql/);
  for (const t of ["inventory_writeoffs", "production_materials", "consignment_dispatches", "stock_transfers"]) {
    assert.match(sql, new RegExp(`to_regclass\\('public\\.${t}'\\)`), t);
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION public\._lot_check_choice\(UUID, UUID, NUMERIC, JSONB, UUID\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.post_stock_transfer\(JSONB\) TO service_role/);
  assert.match(sql, /ALTER TABLE public\.sale_items ADD COLUMN IF NOT EXISTS lots JSONB;/);
  assert.match(sql, /'print_on_invoice', false/);
  for (const fn of [
    "handle_sales_posted_inventory", "_reverse_sales_invoice_posting", "restore_sale_stock", "process_mixed_dimensional_sale",
    "_inventory_writeoff_apply", "update_inventory_writeoff", "process_production_material_issue_event",
    "return_production_material_stock", "process_production_delivery_event", "create_consignment_dispatch_atomic",
    "settle_consignment_partner_atomic", "post_stock_transfer",
  ]) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), fn);
  }
  // Every context that is opened is closed again.
  const begins = (sql.match(/lot_ctx_begin\(/g) || []).length;
  const ends = (sql.match(/lot_ctx_end\(\)/g) || []).length;
  assert.ok(ends >= begins - 1, `lot_ctx_begin ${begins} / lot_ctx_end ${ends}`);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/lot_outbound\.sql/);
});
