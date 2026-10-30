// Imports module, IMP-2: receiving, payments, the receiving sheet, late costs and the wiring.
// The database side (every RPC) is checked by supabase/tests/imports_posting.sql in CI.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  actionsFor,
  allocationsFor,
  checkReceipt,
  costPayload,
  costTotalAzn,
  initialReceiveRows,
  parsePostingError,
  payTotals,
  paySplitsPayload,
  POSTING_ERROR_CODES,
  receiveLines,
  receivingSheetPages,
  sheetsOf,
  splitReceiveRow,
} from "../src/modules/imports/lib/posting.ts";
import { emptyShipment, newCost } from "../src/modules/imports/lib/shipment.ts";
import { DEFAULT_IMPORTS_CONFIG } from "../src/lib/imports/config.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261030110000_imports_posting.sql";
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PLY = { id: UUID(1), code: "PLY-18", name: "Plywood 18", unit: "Vərəq", sheetLengthM: 4, barcode: "4760001" };
const EDGE = { id: UUID(2), code: "EDGE", name: "Edge band", unit: "Rulon", sheetLengthM: null, barcode: null };
const PRODUCTS = new Map([[PLY.id, PLY], [EDGE.id, EDGE]]);
const W1 = UUID(91);
const W2 = UUID(92);

function shipment() {
  return {
    ...emptyShipment(),
    id: UUID(50),
    number: "IMP-2026-0001",
    status: "confirmed",
    supplierId: UUID(60),
    invoiceRate: 1.7,
    defaultWarehouseId: W1,
    lines: [
      { key: UUID(11), productId: PLY.id, qtyPurchase: 100, purchaseUnit: "Vərəq", qtyStock: 400, unitPriceFc: 25, weightKg: 3000, volumeM3: null, hsCode: null, dutyRatePct: 5, warehouseId: null },
      { key: UUID(12), productId: EDGE.id, qtyPurchase: 20, purchaseUnit: "Rulon", qtyStock: 4000, unitPriceFc: 40, weightKg: 100, volumeM3: null, hsCode: null, dutyRatePct: 5, warehouseId: W2 },
    ],
    costs: [],
  };
}

test("buttons follow the status: Add cost and Pay until the shipment is closed", () => {
  assert.deepEqual(actionsFor("draft"), ["confirm", "cancel"]);
  for (const s of ["confirmed", "cleared", "partially_received", "received"]) {
    assert.ok(actionsFor(s).includes("addCost") && actionsFor(s).includes("pay"), s);
  }
  assert.ok(actionsFor("partially_received").includes("receive"));
  assert.ok(!actionsFor("received").includes("receive"));
  assert.ok(actionsFor("received").includes("close"));
  assert.deepEqual(actionsFor("closed"), ["reopen"]);
  assert.deepEqual(actionsFor("cancelled"), []);
});

test("receiving: what is left per line, sheets and metres, a line split over two warehouses", () => {
  const draft = shipment();
  const lines = receiveLines(draft, PRODUCTS, [{ shipmentLineId: UUID(11), qtyStockUnit: 160 }]);
  assert.deepEqual(lines.map((l) => [l.remaining, l.defaultWarehouseId]), [[240, W1], [4000, W2]]);
  assert.equal(sheetsOf(240, 4), 60);
  assert.equal(sheetsOf(4000, null), null);

  let rows = initialReceiveRows(lines);
  assert.equal(rows.length, 2);
  rows = splitReceiveRow(rows, rows[0].key, lines[0]);
  assert.deepEqual(rows.filter((r) => r.shipmentLineId === UUID(11)).map((r) => r.expected), [120, 120], "whole sheets each");
  rows = rows.map((r, i) => (i === 1 ? { ...r, warehouseId: W2 } : r));
  const check = checkReceipt(rows, lines);
  assert.deepEqual(check.issues, []);
  assert.deepEqual(check.payload.map((p) => [p.shipment_line_id, p.warehouse_id, p.qty_stock_unit]), [
    [UUID(11), W1, 120],
    [UUID(11), W2, 120],
    [UUID(12), W2, 4000],
  ]);
});

test("receiving checks: whole sheets, warehouse, more than left; counted differences are shown", () => {
  const lines = receiveLines(shipment(), PRODUCTS, []);
  const base = initialReceiveRows(lines);
  const half = checkReceipt([{ ...base[0], actual: 6 }], lines);
  assert.deepEqual(half.issues.map((i) => i.code), ["whole_sheets"]);
  assert.deepEqual(checkReceipt([{ ...base[0], warehouseId: null }], lines).issues.map((i) => i.code), ["warehouse"]);
  assert.deepEqual(checkReceipt([{ ...base[1], actual: 4001 }], lines).issues.map((i) => i.code), ["over"]);
  const short = checkReceipt([{ ...base[0], actual: 396 }], lines);
  assert.deepEqual(short.issues, []);
  assert.deepEqual(short.differences.map((d) => d.difference), [-4]);
  assert.equal(short.payload[0].qty_stock_unit, 396, "the counted quantity is posted");
  assert.equal(short.payload[0].expected_qty_stock_unit, 400);
  assert.deepEqual(checkReceipt([{ ...base[0], actual: 0 }], lines).issues.map((i) => i.code), ["nothing"]);
});

test("receiving sheet: one page per warehouse, quantities in both units, no prices", () => {
  const draft = shipment();
  const pages = receivingSheetPages(
    [
      { shipmentLineId: UUID(11), warehouseId: W1, qtyStock: 120 },
      { shipmentLineId: UUID(11), warehouseId: W2, qtyStock: 280 },
      { shipmentLineId: UUID(12), warehouseId: W2, qtyStock: 4000 },
    ],
    draft,
    PRODUCTS
  );
  assert.deepEqual(pages.map((p) => [p.warehouseId, p.rows.length]), [[W1, 1], [W2, 2]]);
  const ply = pages[1].rows[0];
  assert.deepEqual([ply.no, ply.code, ply.barcode, ply.qtyPurchase, ply.qtyStock, ply.stockUnit], [1, "PLY-18", "4760001", 70, 280, "m"]);
  const edge = pages[1].rows[1];
  assert.deepEqual([edge.no, edge.qtyPurchase, edge.qtyStock], [2, 20, 4000], "rolls from the line's own ratio");
  for (const row of pages.flatMap((p) => p.rows)) {
    assert.ok(!Object.keys(row).some((k) => /price|cost|value|amount/i.test(k)), "no money on the sheet");
  }
  const template = read("src/modules/imports/components/ReceivingSheet.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(template, /price|unitCost|valueAzn|landed/i);
  assert.match(template, /QrCodeImage value=\{data\.receiptNumber\}/);
  assert.match(template, /breakAfter: "page"/);
});

test("payment splits: this payment, remaining, overpay and duplicate accounts", () => {
  const a = UUID(71);
  const b = UUID(72);
  const t1 = payTotals(400, [{ key: "1", accountId: a, amount: 150 }, { key: "2", accountId: b, amount: 100 }]);
  assert.deepEqual([t1.thisPayment, t1.remainingAfter, t1.overpay, t1.complete, t1.duplicateAccount], [250, 150, false, true, false]);
  assert.equal(payTotals(400, [{ key: "1", accountId: a, amount: 400.01 }]).overpay, true);
  assert.equal(payTotals(0.3, [{ key: "1", accountId: a, amount: 0.1 }, { key: "2", accountId: b, amount: 0.2 }]).overpay, false, "cents, not floats");
  assert.equal(payTotals(400, [{ key: "1", accountId: a, amount: 1 }, { key: "2", accountId: a, amount: 1 }]).duplicateAccount, true);
  assert.equal(payTotals(400, [{ key: "1", accountId: null, amount: 10 }]).complete, false);
  assert.deepEqual(paySplitsPayload([{ key: "1", accountId: a, amount: 10.005 }, { key: "2", accountId: null, amount: 5 }, { key: "3", accountId: b, amount: 0 }]), [{ account_id: a, amount: 10.01 }]);
});

test("a cost added later is split with the shipment's other costs, onto stored line ids", () => {
  const draft = shipment();
  const freight = { ...newCost("freight_international", DEFAULT_IMPORTS_CONFIG), amount: 600, currencyCode: "USD", rateToAzn: 1.7 };
  const alloc = allocationsFor(draft, DEFAULT_IMPORTS_CONFIG, freight);
  assert.deepEqual(alloc.map((a) => a.shipment_line_id), [UUID(11), UUID(12)]);
  assert.equal(Math.round(alloc.reduce((s, a) => s + a.amount_azn, 0) * 100), 102000);
  assert.deepEqual(alloc.map((a) => a.amount_azn), [987.1, 32.9], "by weight (3000 : 100 of 1020)");
  const payload = costPayload(draft, DEFAULT_IMPORTS_CONFIG, freight);
  assert.deepEqual([payload.amount, payload.currency_code, payload.rate_to_azn, payload.split_method], [600, "USD", 1.7, "by_weight"]);
  const local = { ...newCost("freight_local", DEFAULT_IMPORTS_CONFIG), amount: 200, vatAmountAzn: 36 };
  assert.equal(costTotalAzn(local), 236);
  assert.equal(costTotalAzn(freight), 1020);
  const vat = costPayload(draft, DEFAULT_IMPORTS_CONFIG, { ...newCost("customs_vat", DEFAULT_IMPORTS_CONFIG), amount: 50 });
  assert.equal(vat.is_capitalized, false);
  assert.deepEqual(vat.allocations, [], "VAT is never split onto products");
});

test("database errors become translated codes; every code has a text", () => {
  assert.deepEqual(parsePostingError("imports_overpay: Ödəniş (500) qalıq borcdan (400) çoxdur"), { code: "overpay", detail: "Ödəniş (500) qalıq borcdan (400) çoxdur" });
  assert.equal(parsePostingError("Sənəd tarixi (15.01.2026) bağlı maliyyə dövrünə düşür (2026-01).").code, "period_closed");
  assert.equal(parsePostingError("something else").code, null);
  const sql = read(MIGRATION);
  const raised = new Set([...sql.matchAll(/'imports_([a-z_]+):/g)].map((m) => m[1]));
  for (const code of raised) assert.ok(POSTING_ERROR_CODES.includes(code), `no text for imports_${code}`);
  for (const m of [azMessages, enMessages, ruMessages]) {
    for (const code of POSTING_ERROR_CODES) assert.ok(m.importPosting.errors[code], code);
  }
});

test("every IMP-2 text exists in az, en and ru", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : keys(v, `${p}${k}.`)));
  const az = keys(azMessages.importPosting).sort();
  assert.deepEqual(keys(enMessages.importPosting).sort(), az);
  assert.deepEqual(keys(ruMessages.importPosting).sort(), az);
  assert.deepEqual(keys(enMessages.imports.sheet).sort(), keys(azMessages.imports.sheet).sort());
  assert.deepEqual(keys(ruMessages.imports.sheet).sort(), keys(azMessages.imports.sheet).sort());
  // Keys used by the screens exist (template keys: their groups are complete).
  const used = new Set();
  for (const f of ["src/modules/imports/components/PostingPanel.tsx", "src/modules/imports/components/ReceivingSheet.tsx"]) {
    for (const m of read(f).matchAll(/t\("((?:importPosting|imports)\.[A-Za-z_.]+)"/g)) used.add(m[1]);
  }
  const get = (o, k) => k.split(".").reduce((x, p) => (x == null ? undefined : x[p]), o);
  for (const k of used) for (const m of [azMessages, enMessages, ruMessages]) assert.equal(typeof get(m, k), "string", k);
  for (const type of ["import_confirm", "import_receipt", "import_cost", "import_late_cost", "import_payment"]) assert.ok(enMessages.importPosting.entryTypes[type], type);
});

test("migration: accounts, tables, every RPC idempotent, permissions checked, period locks respected", () => {
  const sql = read(MIGRATION);
  assert.equal(readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((f) => f.startsWith("20261030110000")).length, 1);
  for (const [code, type] of [["1360", "asset"], ["4960", "revenue"], ["6260", "expense"]]) assert.match(sql, new RegExp(`\\('${code}', '[^']+', '${type}'\\)`));
  assert.match(sql, /IF v_type IS DISTINCT FROM r\.account_type THEN\s+-?-?[^\n]*\n?\s*RAISE EXCEPTION/, "a taken code is not reused silently");
  for (const t of ["import_payables", "import_payments", "import_payment_splits", "import_receipts", "import_receipt_lines", "import_late_postings", "import_operations"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`), t);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), t);
  }
  assert.match(sql, /amount_fc\s+NUMERIC\(18,2\)/);
  assert.match(sql, /booking_rate\s+NUMERIC\(18,6\)/);
  const rpcs = ["confirm_import_shipment", "receive_import_shipment", "apply_late_import_cost", "add_import_cost", "finalize_import_cost", "pay_import_payable", "close_import_shipment", "cancel_import_shipment"];
  for (const fn of rpcs) {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`), sql.indexOf("$$;", sql.indexOf(`FUNCTION public.${fn}(`)));
    assert.match(body, /p_idempotency_key TEXT/, fn);
    assert.match(body, /_imports_op_get\(p_idempotency_key\)/, fn);
    assert.match(body, /_imports_require\('(approve|manage)'\)/, fn);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated, service_role;`), fn);
  }
  assert.match(sql, /use_document_date\(v_date\)/, "postings carry their date and refuse closed periods");
  assert.match(sql, /reverse_journal_entry\(r\.id/);
  assert.match(sql, /reverse_document_cash_transactions\('import_shipment'/);
  assert.match(sql, /'import', v_receipt, v_rl/, "stock movements reference the receipt");
  assert.match(sql, /create_inventory_batch\(v_line\.product_id, v_receipt, 'import', v_unit, v_qty\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\._imports_cash_out\([^)]*\) FROM PUBLIC, anon, authenticated;/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/imports_posting\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261030110000_imports_posting/);
});

test("the form shows the posting panel; posting runs as the signed-in user", () => {
  const form = read("src/modules/imports/components/ImportFormScreen.tsx");
  assert.match(form, /<PostingPanel draft=\{view\.draft\}/);
  const actions = read("src/modules/imports/actions/posting.ts");
  assert.match(actions, /createSupabaseServerClient\(\)/);
  assert.match(actions, /if \(!isNewImportsEnabled\(\)\) throw/);
  const panel = read("src/modules/imports/components/PostingPanel.tsx");
  assert.match(panel, /from "\.\/ImportDialog"/);
  assert.match(read("src/modules/imports/components/ImportDialog.tsx"), /@radix-ui\/react-dialog/);
  assert.match(panel, /importPosting\.fxNote/);
});
