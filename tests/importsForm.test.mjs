// Imports form v2 (IMP-4): zero basis blocks saving, totals reconcile with the table,
// plausibility warnings, margin / markup, the customs-rate follow rule, warehouse per line and
// split over warehouses with the receive prefill, and the three worked examples.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateLandedCost, round2, stockQuantity, toCents } from "../src/lib/imports/landedCost.ts";
import { DEFAULT_IMPORTS_CONFIG } from "../src/lib/imports/config.ts";
import { draftIssues, emptyShipment, landedCostOf, newCost, newLine, parseShipmentDraft } from "../src/modules/imports/lib/shipment.ts";
import { costColumnTotals, markupFromMargin, plausibilityWarnings, priceFromMargin, reconciledTotals } from "../src/modules/imports/lib/landedChecks.ts";
import { cbarKey, customsRateState, rateDeviationPct, rateLooksWrong, rateTargets, setCurrency, setDeclarationDate, typeCustomsRate } from "../src/modules/imports/lib/rates.ts";
import {
  applyHeaderWarehouse,
  applySplit,
  checkSplit,
  differsFromPlan,
  effectiveWarehouses,
  followLineQuantity,
  receivePrefill,
  removeSplit,
  splitStockQuantities,
  startSplit,
} from "../src/modules/imports/lib/lineWarehouses.ts";
import { checkReceipt, initialReceiveRows, receiveLines } from "../src/modules/imports/lib/posting.ts";
import { shipmentFromRows } from "../src/modules/imports/lib/rows.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const cost = (id, costType, amount, splitMethod, extra = {}) => ({ id, costType, amount, rateToAzn: 1, isCapitalized: true, splitMethod, ...extra });
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const W1 = UUID(901);
const W2 = UUID(902);
const W3 = UUID(903);

// ── The three worked examples (accounting check) ─────────────────────────────

test("example (a): 100 sheets, 2,500 USD × 1.70 → landed 5,506.50 AZN, 13.77 AZN/m for 4 m sheets", () => {
  const r = calculateLandedCost({
    invoiceRate: 1.7,
    lines: [{ id: "ply", qtyPurchase: 100, qtyStock: stockQuantity(100, 4), unitPriceFc: 25, dutyRatePct: 5 }],
    costs: [
      cost("freight", "freight_international", 400, "by_value", { rateToAzn: 1.7 }),
      cost("duty", "customs_duty", 0, "per_line_duty"),
      cost("fee", "customs_fee", 30, "by_value"),
      cost("vat", "customs_vat", 931.77, "by_value", { isCapitalized: false }),
      cost("local", "freight_local", 200, "by_value", { vatAmountAzn: 36 }),
      cost("labour", "labour", 100, "by_quantity"),
    ],
  });
  assert.equal(r.totals.goodsAzn, 4250);
  assert.equal(r.totals.customsValueAzn, 4930, "goods + international freight");
  assert.equal(r.totals.dutyAzn, 246.5, "5 % of the customs value");
  assert.equal(r.totals.customsVatSuggestionAzn, 931.77, "18 % of (customs value + duty)");
  assert.equal(r.totals.landedAzn, 5506.5);
  assert.equal(round2(r.lines[0].unitCostStock), 13.77);
  // Customs VAT and the local freight VAT are recoverable (1410), never part of the cost.
  assert.equal(r.totals.recoverableVatAzn, round2(931.77 + 36));
  assert.equal(r.costs.find((c) => c.id === "vat").capitalized, false);
  assert.ok(reconciledTotals(r).reconciles);
});

test("example (b): three products, each cost by its own method; every column adds up", () => {
  const r = calculateLandedCost({
    invoiceRate: 1.7,
    lines: [
      { id: "ply", qtyPurchase: 100, qtyStock: stockQuantity(100, 4), unitPriceFc: 25, weightKg: 3000, volumeM3: 6, dutyRatePct: 5 },
      { id: "mdf", qtyPurchase: 50, qtyStock: stockQuantity(50, 4), unitPriceFc: 18, weightKg: 1750, volumeM3: 4, dutyRatePct: 10 },
      { id: "edge", qtyPurchase: 20, qtyStock: 4000, unitPriceFc: 40, weightKg: 100, volumeM3: 0.5, dutyRatePct: 0 },
    ],
    costs: [
      cost("freight", "freight_international", 600, "chargeable_weight", { rateToAzn: 1.7 }),
      cost("ins", "insurance", 25, "by_value", { rateToAzn: 1.7 }),
      cost("duty", "customs_duty", 0, "per_line_duty"),
      cost("broker", "broker", 120, "equal", { vatAmountAzn: 21.6 }),
      cost("storage", "storage", 90, "by_volume"),
      cost("labour", "labour", 85, "by_quantity"),
    ],
  });
  for (const c of costColumnTotals(r)) assert.equal(c.unallocatedAzn, 0, c.costId);
  assert.deepEqual(r.lines.map((l) => l.allocations.broker), [40, 40, 40], "equal");
  assert.deepEqual(r.lines.map((l) => l.allocations.labour), [50, 25, 10], "by quantity");
  assert.equal(r.lines[2].dutyAzn, 0, "0 % duty");
  const t = reconciledTotals(r);
  assert.ok(t.reconciles);
  assert.equal(t.landedAzn, r.totals.landedAzn);
  assert.equal(toCents(t.goodsAzn) + toCents(t.costsAzn), toCents(r.totals.landedAzn));
});

test("example (c), mockup v2: 3 lines, 4,920 USD at 1.70 → landed 10,797.30 AZN, 101 PARLAQ DOUBLE 13.68 AZN/m", () => {
  const r = calculateLandedCost({
    invoiceRate: 1.7,
    lines: [
      { id: "101", qtyPurchase: 100, qtyStock: stockQuantity(100, 4), unitPriceFc: 25, weightKg: 3000, dutyRatePct: 5 },
      { id: "103", qtyPurchase: 60, qtyStock: stockQuantity(60, 4), unitPriceFc: 22, weightKg: 1800, dutyRatePct: 5 },
      { id: "103d", qtyPurchase: 40, qtyStock: stockQuantity(40, 4), unitPriceFc: 27.5, weightKg: 1200, dutyRatePct: 5 },
    ],
    costs: [
      cost("freight", "freight_international", 800, "by_weight", { rateToAzn: 1.7 }),
      cost("ins", "insurance", 60, "by_value", { rateToAzn: 1.7 }),
      cost("duty", "customs_duty", 0, "per_line_duty"),
      cost("fee", "customs_fee", 30, "by_value"),
      cost("vat", "customs_vat", 1857.11, "by_value", { isCapitalized: false }),
      cost("local", "freight_local", 300, "by_weight", { vatAmountAzn: 54 }),
      cost("labour", "labour", 150, "by_quantity"),
    ],
  });
  assert.equal(r.totals.goodsAzn, 8364);
  assert.equal(r.totals.customsValueAzn, 9826);
  assert.equal(r.totals.dutyAzn, 491.3);
  assert.equal(r.totals.capitalizedAzn, 2433.3);
  assert.equal(r.totals.landedAzn, 10797.3);
  assert.deepEqual(r.lines.map((l) => l.landedAzn), [5471.16, 2956.39, 2369.75]);
  assert.equal(round2(r.lines[0].unitCostStock), 13.68);
  assert.equal(r.totals.recoverableVatAzn, 1911.11);
  assert.ok(reconciledTotals(r).reconciles);
});

// ── Zero basis blocks saving; totals reconcile ───────────────────────────────

test("zero basis: a capitalized cost with nothing to split by is an error and blocks the draft (cost_unallocated)", () => {
  const r = calculateLandedCost({
    invoiceRate: 1.7,
    lines: [{ id: "a", qtyPurchase: 10, qtyStock: 10, unitPriceFc: 0 }],
    costs: [cost("freight", "freight_international", 5616215, "by_value")],
  });
  assert.deepEqual(r.errors.map((e) => [e.code, e.costId]), [["zero_basis", "freight"]]);
  assert.ok(!r.warnings.some((w) => w.code === "zero_basis"));
  const cols = costColumnTotals(r);
  assert.equal(cols[0].allocatedAzn, 0);
  assert.equal(cols[0].unallocatedAzn, 5616215, "the footer shows what was not split");
  const t = reconciledTotals(r);
  assert.equal(t.landedAzn, r.totals.landedAzn, "grand total = the table, never the cost amount");
  assert.equal(t.unallocatedAzn, 5616215);

  const product = { id: UUID(1), code: "P1", name: "P1", unit: "ədəd", sheetLengthM: null };
  const draft = { ...emptyShipment(), supplierId: UUID(2), invoiceRate: 1.7, lines: [newLine(product, 10)], costs: [{ ...newCost("other", DEFAULT_IMPORTS_CONFIG), amount: 100 }] };
  assert.ok(draftIssues(draft, DEFAULT_IMPORTS_CONFIG).includes("cost_unallocated"));
  draft.lines[0].unitPriceFc = 5;
  assert.ok(!draftIssues(draft, DEFAULT_IMPORTS_CONFIG).includes("cost_unallocated"));
});

test("by weight with a missing weight stays a warning (falls back to value), not an error", () => {
  const r = calculateLandedCost({
    invoiceRate: 1,
    lines: [
      { id: "a", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 100, weightKg: 10 },
      { id: "b", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 100 },
    ],
    costs: [cost("f", "freight_local", 50, "by_weight")],
  });
  assert.deepEqual(r.warnings.map((w) => w.code), ["missing_weight"]);
  assert.deepEqual(r.errors, []);
});

// ── Plausibility ─────────────────────────────────────────────────────────────

test("plausibility: a cost above the goods, landed > 3 × goods, a rate > 5 % off CBAR (never blocking)", () => {
  const product = { id: UUID(1), code: "P1", name: "P1", unit: "ədəd", sheetLengthM: null };
  const line = { ...newLine(product, 10), unitPriceFc: 10 };
  const freight = { ...newCost("freight_international", DEFAULT_IMPORTS_CONFIG), amount: 400, currencyCode: "USD", rateToAzn: 1.9, splitMethod: "by_value" };
  const draft = { ...emptyShipment(), supplierId: UUID(2), currencyCode: "USD", invoiceRate: 1.7, invoiceDate: "2026-10-06", lines: [line], costs: [freight] };
  const result = landedCostOf(draft, DEFAULT_IMPORTS_CONFIG);
  const cbar = { [cbarKey("USD", "2026-10-06")]: 1.7 };
  const w = plausibilityWarnings(draft, result, cbar);
  assert.deepEqual(w.map((x) => x.code).sort(), ["cost_over_goods", "landed_over_3x", "rate_off_cbar"]);
  assert.equal(w.find((x) => x.code === "rate_off_cbar").costId, freight.key, "the cost's own rate (1.90 vs 1.70)");
  assert.ok(!draftIssues(draft, DEFAULT_IMPORTS_CONFIG).length, "warnings never block");
  assert.deepEqual(plausibilityWarnings({ ...draft, costs: [{ ...freight, amount: 10, rateToAzn: 1.7 }] }, landedCostOf({ ...draft, costs: [{ ...freight, amount: 10, rateToAzn: 1.7 }] }, DEFAULT_IMPORTS_CONFIG), cbar), []);
  assert.equal(round2(rateDeviationPct(1.8, 1.7)), 5.88);
  assert.ok(rateLooksWrong(1.79, 1.7));
  assert.ok(!rateLooksWrong(1.785, 1.7), "exactly 5 % is fine");
  assert.ok(!rateLooksWrong(1.9, undefined), "no CBAR rate known: no warning");
});

// ── Margin / markup ──────────────────────────────────────────────────────────

test("sale price suggestion: price = cost / (1 − margin); markup next to it", () => {
  assert.equal(priceFromMargin(13.68, 25), 18.24);
  assert.equal(markupFromMargin(25), 33.3);
  assert.equal(markupFromMargin(20), 25);
  assert.equal(priceFromMargin(10, 0), 10);
  assert.equal(priceFromMargin(10, 100), null);
  assert.equal(priceFromMargin(10, null), null);
  assert.equal(markupFromMargin(-1), null);
});

// ── Customs rate follow rule ─────────────────────────────────────────────────

test("customs rate follows the invoice rate until it has its own; AZN is 1", () => {
  let d = { ...emptyShipment(), currencyCode: "USD", invoiceRate: 1.7, invoiceDate: "2026-10-06" };
  assert.deepEqual(customsRateState(d), { rate: 1.7, source: "invoice", date: "2026-10-06" });
  d = { ...d, invoiceRate: 1.72 };
  assert.equal(customsRateState(d).rate, 1.72, "still following");
  const dated = setDeclarationDate(d, "2026-10-28");
  assert.equal(dated.fetchCustomsRate, true, "a declaration date asks CBAR while it follows");
  d = typeCustomsRate(dated.draft, 1.701);
  assert.deepEqual(customsRateState(d), { rate: 1.701, source: "own", date: "2026-10-28" });
  d = { ...d, invoiceRate: 1.8 };
  assert.equal(customsRateState(d).rate, 1.701, "a typed rate no longer follows");
  assert.equal(setDeclarationDate(d, "2026-10-29").fetchCustomsRate, false, "a typed rate is left alone");
  assert.equal(customsRateState(typeCustomsRate(d, null)).source, "invoice", "emptied: follows again");
  const azn = setCurrency(d, "AZN");
  assert.deepEqual([azn.invoiceRate, azn.customsRate, customsRateState(azn).rate], [1, null, 1]);
});

test("refresh all rates: invoice, customs (once dated) and each foreign-currency cost", () => {
  const usd = { ...newCost("freight_international", DEFAULT_IMPORTS_CONFIG), currencyCode: "USD" };
  const azn = newCost("customs_fee", DEFAULT_IMPORTS_CONFIG);
  const duty = { ...newCost("customs_duty", DEFAULT_IMPORTS_CONFIG), currencyCode: "USD" };
  const d = { ...emptyShipment(), currencyCode: "EUR", invoiceDate: "2026-10-06", costs: [usd, azn, duty] };
  assert.deepEqual(rateTargets(d, "2026-11-04").map((x) => [x.target, x.currency, x.date]), [
    ["invoice", "EUR", "2026-10-06"],
    [usd.key, "USD", "2026-10-06"],
  ]);
  assert.deepEqual(rateTargets({ ...d, customsDeclarationDate: "2026-10-28" }, "2026-11-04").map((x) => [x.target, x.date]), [
    ["invoice", "2026-10-06"],
    ["customs", "2026-10-28"],
    [usd.key, "2026-10-28"],
  ]);
  assert.deepEqual(rateTargets({ ...d, currencyCode: "AZN", costs: [] }, "2026-11-04"), []);
});

// ── Warehouse per line and splits ────────────────────────────────────────────

const SHEET = { id: UUID(11), code: "101", name: "101 PARLAQ DOUBLE", unit: "vərəq", sheetLengthM: 4 };
const PIECE = { id: UUID(12), code: "FT", name: "Fittings", unit: "ədəd", sheetLengthM: null };

test("effective warehouses: the split, else the line's own, else the header default (and it follows the header)", () => {
  const line = newLine(SHEET, 100);
  assert.deepEqual(effectiveWarehouses(line, W1, 4), [{ warehouseId: W1, qtyPurchase: 100, qtyStock: 400, source: "header" }]);
  assert.equal(effectiveWarehouses(line, W2, 4)[0].warehouseId, W2, "a line without its own follows the header");
  assert.deepEqual(effectiveWarehouses({ ...line, warehouseId: W3 }, W1, 4).map((w) => [w.warehouseId, w.source]), [[W3, "line"]]);
  const split = applySplit(line, [
    { key: "a", warehouseId: W1, qtyPurchase: 60 },
    { key: "b", warehouseId: W2, qtyPurchase: 40 },
  ]);
  assert.deepEqual(effectiveWarehouses(split, W3, 4).map((w) => [w.warehouseId, w.qtyPurchase, w.qtyStock]), [
    [W1, 60, 240],
    [W2, 40, 160],
  ]);
  assert.deepEqual(applyHeaderWarehouse([split, line], W3).map((l) => [l.warehouseId, l.warehouses.length]), [
    [W3, 0],
    [W3, 0],
  ]);
});

test("split check: sum = line, whole sheets, a warehouse per row (each once); any number of warehouses", () => {
  const rows = (...q) => q.map(([w, n], i) => ({ key: `r${i}`, warehouseId: w, qtyPurchase: n }));
  assert.deepEqual(checkSplit({ qtyPurchase: 100 }, rows([W1, 50], [W2, 30], [W3, 20]), 4), { remaining: 0, issues: [], badRows: [] });
  assert.deepEqual(checkSplit({ qtyPurchase: 100 }, rows([W1, 60], [W2, 30]), 4).issues, ["sum_mismatch"]);
  assert.equal(checkSplit({ qtyPurchase: 100 }, rows([W1, 60], [W2, 30]), 4).remaining, 10);
  assert.deepEqual(checkSplit({ qtyPurchase: 100 }, rows([W1, 60.5], [W2, 39.5]), 4).issues, ["whole_sheets"]);
  assert.deepEqual(checkSplit({ qtyPurchase: 10 }, rows([W1, 2.5], [W2, 7.5]), null).issues, [], "pieces may be split freely");
  assert.deepEqual(checkSplit({ qtyPurchase: 100 }, rows([W1, 60], [W1, 40]), 4).issues, ["warehouse_duplicate"]);
  assert.deepEqual(checkSplit({ qtyPurchase: 100 }, rows([null, 60], [W2, 40]), 4).issues, ["warehouse_missing"]);
  const bad = { ...emptyShipment(), supplierId: UUID(2), invoiceRate: 1, lines: [{ ...newLine(SHEET, 100), unitPriceFc: 1, warehouses: rows([W1, 60], [W2, 30]) }] };
  assert.ok(draftIssues(bad, DEFAULT_IMPORTS_CONFIG).includes("line_warehouse_split"));
  const sheets = new Map([[SHEET.id, 4]]);
  bad.lines[0].warehouses = rows([W1, 60.5], [W2, 39.5]);
  assert.ok(!draftIssues(bad, DEFAULT_IMPORTS_CONFIG).includes("line_warehouse_split"), "without sheet lengths only the sum is checked");
  assert.ok(draftIssues(bad, DEFAULT_IMPORTS_CONFIG, sheets).includes("line_warehouse_split"), "the server knows the sheet length");
});

test("split editing: start, keep, remove; one row left = one warehouse; stock quantities add up exactly", () => {
  const line = { ...newLine(PIECE, 3), qtyStock: 10 };
  const start = startSplit(line, W1);
  assert.deepEqual(start.map((s) => [s.warehouseId, s.qtyPurchase]), [[W1, 3], [null, 0]]);
  const single = applySplit(line, [{ key: "a", warehouseId: W2, qtyPurchase: 3 }, { key: "b", warehouseId: null, qtyPurchase: 0 }]);
  assert.deepEqual([single.warehouseId, single.warehouses.length], [W2, 0]);
  const split = applySplit(line, [{ key: "a", warehouseId: W1, qtyPurchase: 1 }, { key: "b", warehouseId: W2, qtyPurchase: 2 }]);
  assert.deepEqual(splitStockQuantities(split, split.warehouses, null), [3.333, 6.667], "proportional, the remainder on the last row");
  assert.deepEqual(splitStockQuantities(newLine(SHEET, 100), [{ qtyPurchase: 60 }, { qtyPurchase: 40 }], 4), [240, 160]);
  const back = removeSplit(split);
  assert.deepEqual([back.warehouseId, back.warehouses.length], [W1, 0]);
  const two = applySplit(newLine(SHEET, 100), [{ key: "a", warehouseId: W1, qtyPurchase: 60 }, { key: "b", warehouseId: W2, qtyPurchase: 40 }]);
  assert.deepEqual(followLineQuantity(two, 120).warehouses.map((s) => s.qtyPurchase), [60, 60], "the last row follows a new line quantity");
  assert.deepEqual(followLineQuantity(two, 50).warehouses.map((s) => s.qtyPurchase), [60, 40], "kept for the user to fix when it cannot");
});

test("receive prefill: one row per planned warehouse with what is left of it; 'differs from plan'", () => {
  const plan = [{ shipmentLineId: "L1", orderedStock: 400, shares: [{ warehouseId: W1, qtyStock: 240 }, { warehouseId: W2, qtyStock: 160 }] }];
  assert.deepEqual(receivePrefill(plan, []).map((r) => [r.warehouseId, r.expected]), [[W1, 240], [W2, 160]]);
  // 80 m already received into W1: W1 has 160 left, W2 all of its 160.
  assert.deepEqual(receivePrefill(plan, [{ shipmentLineId: "L1", warehouseId: W1, qtyStockUnit: 80 }]).map((r) => [r.warehouseId, r.expected]), [[W1, 160], [W2, 160]]);
  // 100 m went to W3 (not planned): the rows are cut from the last one to what is left (300).
  assert.deepEqual(receivePrefill(plan, [{ shipmentLineId: "L1", warehouseId: W3, qtyStockUnit: 100 }]).map((r) => [r.warehouseId, r.expected]), [[W1, 240], [W2, 60]]);
  assert.deepEqual(receivePrefill(plan, [{ shipmentLineId: "L1", warehouseId: W1, qtyStockUnit: 240 }, { shipmentLineId: "L1", warehouseId: W2, qtyStockUnit: 160 }]), []);

  const row = { warehouseId: W1, expected: 240, actual: null, plannedWarehouseId: W1, plannedQty: 240 };
  assert.equal(differsFromPlan(row), false);
  assert.equal(differsFromPlan({ ...row, warehouseId: W3 }), true);
  assert.equal(differsFromPlan({ ...row, actual: 236 }), true);
  assert.equal(differsFromPlan({ ...row, plannedWarehouseId: null, plannedQty: null }), true, "a row the user added");
  assert.equal(differsFromPlan({ warehouseId: W1, expected: 1, actual: null }), false, "no plan known");
});

test("receive dialog starts from the document's split and posts it as planned", () => {
  const draft = {
    ...emptyShipment(),
    id: UUID(100),
    status: "confirmed",
    defaultWarehouseId: W3,
    lines: [
      { ...newLine(SHEET, 100), key: UUID(21), warehouses: [{ key: "a", warehouseId: W1, qtyPurchase: 60 }, { key: "b", warehouseId: W2, qtyPurchase: 40 }] },
      { ...newLine(PIECE, 10), key: UUID(22) },
    ],
  };
  const products = new Map([[SHEET.id, SHEET], [PIECE.id, PIECE]]);
  const lines = receiveLines(draft, products, []);
  const rows = initialReceiveRows(lines);
  assert.deepEqual(rows.map((r) => [r.shipmentLineId, r.warehouseId, r.expected]), [
    [UUID(21), W1, 240],
    [UUID(21), W2, 160],
    [UUID(22), W3, 10],
  ]);
  const check = checkReceipt(rows, lines);
  assert.deepEqual(check.issues, []);
  assert.equal(check.payload.length, 3);
});

// ── Stored rows and untrusted input ──────────────────────────────────────────

test("splits are read back in order and parsed from untrusted input", () => {
  const draft = shipmentFromRows(
    { id: UUID(100), status: "draft", currency_code: "USD" },
    [{ id: UUID(21), position: 0, product_id: SHEET.id, qty_purchase_unit: 100, qty_stock_unit: 400 }],
    [],
    [],
    true,
    [
      { id: UUID(32), shipment_line_id: UUID(21), warehouse_id: W2, qty_purchase: 40, sort_order: 1 },
      { id: UUID(31), shipment_line_id: UUID(21), warehouse_id: W1, qty_purchase: 60, sort_order: 0 },
    ]
  );
  assert.deepEqual(draft.lines[0].warehouses.map((s) => [s.warehouseId, s.qtyPurchase]), [[W1, 60], [W2, 40]]);
  assert.deepEqual(shipmentFromRows({ id: UUID(100) }, [{ id: UUID(21), product_id: SHEET.id }], [], [], true).lines[0].warehouses, [], "before the migration: no splits");
  const parsed = parseShipmentDraft({ lines: [{ productId: SHEET.id, warehouses: [{ warehouseId: W1, qtyPurchase: "60" }, { warehouseId: "x", qtyPurchase: 40 }, "bad"] }] });
  assert.deepEqual(parsed.lines[0].warehouses.map((s) => [s.warehouseId, s.qtyPurchase]), [[W1, 60], [null, 40], [null, 0]]);
  assert.deepEqual(parseShipmentDraft({ lines: [{ productId: SHEET.id }] }).lines[0].warehouses, []);
});

// ── Migration, wiring and texts ──────────────────────────────────────────────

test("migration: one table with RLS like the lines, the draft save replaced with the same signature", () => {
  const sql = read("supabase/migrations/20261104100000_imports_line_warehouses.sql");
  assert.match(sql, /create table if not exists public\.import_shipment_line_warehouses/);
  assert.match(sql, /references public\.import_shipment_lines \(id\) on delete cascade/);
  assert.match(sql, /references public\.warehouses \(id\) on delete restrict/);
  assert.match(sql, /unique \(shipment_line_id, warehouse_id\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /imports_can_read\(\)/);
  assert.match(sql, /import_shipment_is_draft\(l\.shipment_id\)/);
  assert.match(sql, /create or replace function public\.import_shipment_save_draft\(\s*p_id\s+uuid,\s*p_header\s+jsonb,\s*p_lines\s+jsonb,\s*p_costs\s+jsonb,\s*p_allocations\s+jsonb,\s*p_actor\s+uuid\s*\)/);
  assert.match(sql, /security definer\s*\nset search_path = public/);
  assert.match(sql, /imports_warehouse_split/);
  assert.match(sql, /to service_role;/);
  // The imports_core re-run applies it again, or the old save function would come back.
  assert.match(read("supabase/tests/imports_core.sql"), /\\ir \.\.\/migrations\/20261104100000_imports_line_warehouses\.sql/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/imports_line_warehouses\.sql/);
});

test("no native select, date input or datalist left in the import form and the landed cost panel", () => {
  for (const file of ["src/modules/imports/components/ImportFormScreen.tsx", "src/modules/imports/components/LandedCostPanel.tsx"]) {
    const text = read(file);
    assert.doesNotMatch(text, /<select\b/, file);
    assert.doesNotMatch(text, /type="date"/, file);
    assert.doesNotMatch(text, /<datalist\b/, file);
  }
  const allow = JSON.parse(read("scripts/ui-guard-allowlist.json"));
  for (const cat of ["select", "dateInput", "datalist"]) assert.equal(allow[cat]?.["src/modules/imports/components/ImportFormScreen.tsx"], undefined, cat);
});

test("the new texts exist in az, en and ru, with the zero-basis message Del asked for", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${p}${k}`] : keys(v, `${p}${k}.`)));
  const az = keys(azMessages.imports).sort();
  assert.deepEqual(keys(enMessages.imports).sort(), az);
  assert.deepEqual(keys(ruMessages.imports).sort(), az);
  assert.equal(azMessages.imports.draftIssues.cost_unallocated, "Bölmək üçün əsas yoxdur: məhsulların qiyməti/çəkisi 0-dır. Qiymət daxil edin və ya bölgü üsulunu dəyişin");
  for (const m of [azMessages, enMessages, ruMessages]) {
    assert.ok(m.imports.issues.zero_basis && m.imports.draftIssues.line_warehouse_split && m.imports.whSplit.title && m.imports.rates.refreshAll);
    assert.ok(m.imports.landed.salePrice && m.imports.landed.salePriceHint && m.imports.plausibility.rate_off_cbar);
  }
});
