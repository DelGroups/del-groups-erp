// IMP-6: the customs duty typed from the customs declaration. A customs_duty cost split per line is
// computed from the lines' rates unless the user typed the declaration amount; the typed amount is
// split in proportion to each line's computed duty (by customs value when every rate is 0).
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateLandedCost } from "../src/lib/imports/landedCost.ts";
import { DEFAULT_IMPORTS_CONFIG } from "../src/lib/imports/config.ts";
import { isTypedDuty, landedCostInput, newCost, parseShipmentDraft } from "../src/modules/imports/lib/shipment.ts";
import { shipmentFromRows } from "../src/modules/imports/lib/rows.ts";
import { costPayload } from "../src/modules/imports/lib/posting.ts";
import { azMessages } from "../src/i18n/messages/az.ts";
import { enMessages } from "../src/i18n/messages/en.ts";
import { ruMessages } from "../src/i18n/messages/ru.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const cost = (id, costType, amount, splitMethod, extra = {}) => ({ id, costType, amount, rateToAzn: 1, isCapitalized: true, splitMethod, ...extra });
const line = (id, value, dutyRatePct) => ({ id, qtyPurchase: 1, qtyStock: 1, unitPriceFc: value, dutyRatePct });
const sum = (alloc) => Math.round(Object.values(alloc).reduce((s, v) => s + v, 0) * 100) / 100;

// The PR's example: three lines of 1,000 / 2,000 / 3,000 AZN at 5 % / 5 % / 10 % duty.
const LINES = [line("a", 1000, 5), line("b", 2000, 5), line("c", 3000, 10)];

test("computed mode is unchanged: the duty is customs value × rate per line", () => {
  const r = calculateLandedCost({ invoiceRate: 1, lines: LINES, costs: [cost("duty", "customs_duty", 0, "per_line_duty")] });
  const duty = r.costs[0];
  assert.equal(duty.amountAzn, 450);
  assert.deepEqual(duty.allocations, { a: 50, b: 100, c: 300 });
  assert.deepEqual(r.lines.map((l) => l.dutyAzn), [50, 100, 300]);
  assert.equal(r.totals.dutyAzn, 450);
  assert.equal(r.totals.computedDutyAzn, 450);
  assert.deepEqual(r.warnings, []);
  // A stale amount on a computed duty is still ignored, as before.
  const stale = calculateLandedCost({ invoiceRate: 1, lines: LINES, costs: [cost("duty", "customs_duty", 999, "per_line_duty")] });
  assert.equal(stale.costs[0].amountAzn, 450);
});

test("a typed duty of 500 AZN is split in proportion to the computed duty and adds up exactly", () => {
  const r = calculateLandedCost({ invoiceRate: 1, lines: LINES, costs: [cost("duty", "customs_duty", 500, "per_line_duty", { amountTyped: true })] });
  const duty = r.costs[0];
  assert.equal(duty.amountAzn, 500);
  assert.equal(duty.method, "per_line_duty");
  assert.deepEqual(duty.allocations, { a: 55.56, b: 111.11, c: 333.33 });
  assert.equal(sum(duty.allocations), 500);
  // The lines carry their share of the typed duty (and the landed cost includes it).
  assert.deepEqual(r.lines.map((l) => l.dutyAzn), [55.56, 111.11, 333.33]);
  assert.deepEqual(r.lines.map((l) => l.landedAzn), [1055.56, 2111.11, 3333.33]);
  assert.equal(r.totals.dutyAzn, 500);
  assert.equal(r.totals.computedDutyAzn, 450, "the computed duty stays available as the placeholder");
  // Customs VAT suggestion follows the typed duty: 18 % × (6,000 + 500).
  assert.equal(r.totals.customsVatSuggestionAzn, 1170);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.errors, []);
});

test("remainder cents go to the largest share, so any typed amount adds up to the cent", () => {
  for (const typed of [0.01, 1, 99.99, 333.33, 500, 1234.57, 100000]) {
    const r = calculateLandedCost({ invoiceRate: 1.7, lines: LINES, costs: [cost("duty", "customs_duty", typed, "per_line_duty", { amountTyped: true })] });
    assert.equal(sum(r.costs[0].allocations), typed, `typed ${typed}`);
  }
  const r = calculateLandedCost({ invoiceRate: 1, lines: [line("a", 100, 10), line("b", 100, 10), line("c", 100, 10)], costs: [cost("d", "customs_duty", 100, "per_line_duty", { amountTyped: true })] });
  assert.deepEqual(r.costs[0].allocations, { a: 33.34, b: 33.33, c: 33.33 });
});

test("every rate 0: the typed duty is split by customs value with a warning", () => {
  const zero = [line("a", 1000, 0), line("b", 2000, 0), line("c", 3000, 0)];
  const computed = calculateLandedCost({ invoiceRate: 1, lines: zero, costs: [cost("duty", "customs_duty", 0, "per_line_duty")] });
  assert.equal(computed.costs[0].amountAzn, 0, "without a typed amount the duty stays 0");
  const r = calculateLandedCost({ invoiceRate: 1, lines: zero, costs: [cost("duty", "customs_duty", 600, "per_line_duty", { amountTyped: true })] });
  assert.deepEqual(r.costs[0].allocations, { a: 100, b: 200, c: 300 });
  assert.equal(sum(r.costs[0].allocations), 600);
  assert.deepEqual(r.warnings, [{ code: "duty_by_value", costId: "duty" }]);
  assert.deepEqual(r.errors, []);
  // The customs value includes international freight, as for the computed duty.
  const withFreight = calculateLandedCost({
    invoiceRate: 1,
    lines: [line("a", 1000, 0), line("b", 1000, 0)],
    costs: [cost("fr", "freight_international", 200, "manual", { manual: { a: 200, b: 0 } }), cost("duty", "customs_duty", 110, "per_line_duty", { amountTyped: true })],
  });
  assert.deepEqual(withFreight.costs[1].allocations, { a: 60, b: 50 });
});

test("clearing the typed amount returns to the computed duty", () => {
  const draft = parseShipmentDraft({
    invoiceRate: 1,
    lines: [],
    costs: [{ key: "duty", costType: "customs_duty", amount: 500, amountTyped: true, splitMethod: "per_line_duty", currencyCode: "AZN" }],
  });
  assert.equal(draft.costs[0].amountTyped, true);
  assert.equal(isTypedDuty(draft.costs[0]), true);
  const cleared = { ...draft.costs[0], amountTyped: false, amount: 0 };
  assert.equal(isTypedDuty(cleared), false);
  const typed = calculateLandedCost({ invoiceRate: 1, lines: LINES, costs: [cost("duty", "customs_duty", 500, "per_line_duty", { amountTyped: true })] });
  const back = calculateLandedCost({ invoiceRate: 1, lines: LINES, costs: [cost("duty", "customs_duty", 0, "per_line_duty", { amountTyped: false })] });
  assert.equal(typed.costs[0].amountAzn, 500);
  assert.equal(back.costs[0].amountAzn, 450);
  // A new cost starts computed; the flag only counts for a customs duty split per line.
  assert.equal(newCost("customs_duty", DEFAULT_IMPORTS_CONFIG).amountTyped, false);
  assert.equal(isTypedDuty({ costType: "customs_duty", splitMethod: "by_value", amountTyped: true }), false);
  assert.equal(isTypedDuty({ costType: "broker", splitMethod: "per_line_duty", amountTyped: true }), false);
});

test("the draft input, the stored rows and the late-cost payload carry the typed duty", () => {
  const draft = parseShipmentDraft({
    invoiceRate: 1,
    lines: [{ key: "l1", productId: "00000000-0000-4000-8000-000000000001", qtyPurchase: 1, qtyStock: 1, unitPriceFc: 1000, dutyRatePct: 5 }],
    costs: [{ key: "c1", costType: "customs_duty", amount: 80, amountTyped: true, splitMethod: "per_line_duty", currencyCode: "AZN", isCapitalized: true }],
  });
  const input = landedCostInput(draft, DEFAULT_IMPORTS_CONFIG);
  assert.equal(input.costs[0].amountTyped, true);
  const payload = costPayload(draft, DEFAULT_IMPORTS_CONFIG, draft.costs[0]);
  assert.equal(payload.amount, 80, "the late cost posts the typed duty, not the computed 50");
  assert.equal(payload.amount_typed, true);
  assert.deepEqual(payload.allocations, [{ shipment_line_id: "l1", amount_azn: 80 }]);
  // From the database: amount_typed only counts on a duty split per line; a database without the
  // column reads as computed.
  const row = { id: "s", number: "IMP-1", status: "draft", currency_code: "USD", invoice_rate: 1 };
  const costRow = { id: "c1", position: 0, cost_type: "customs_duty", amount: 80, currency_code: "AZN", rate_to_azn: 1, split_method: "per_line_duty", is_capitalized: true };
  assert.equal(shipmentFromRows(row, [], [{ ...costRow, amount_typed: true }], []).costs[0].amountTyped, true);
  assert.equal(shipmentFromRows(row, [], [costRow], []).costs[0].amountTyped, false);
  assert.equal(shipmentFromRows(row, [], [{ ...costRow, amount_typed: true, split_method: "by_value" }], []).costs[0].amountTyped, false);
});

test("the save sends amount_typed, the migration stores it, and the texts exist in az, en and ru", () => {
  const save = read("src/modules/imports/actions/imports.ts");
  assert.match(save, /amount_typed: duty && c\.amountTyped/);
  const sql = read("supabase/migrations/20261106100000_imports_duty_override.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS amount_typed BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.import_shipment_save_draft\(/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._imports_cost_from_json\(/);
  assert.equal(sql.match(/amount_typed\)/g)?.length, 2, "both inserts list the column");
  for (const [lang, m] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    assert.ok(m.imports.costFields.dutyTypedHelp, `${lang} dutyTypedHelp`);
    assert.ok(m.imports.costFields.dutyRecompute, `${lang} dutyRecompute`);
    assert.ok(m.imports.issues.duty_by_value, `${lang} duty_by_value`);
  }
  assert.equal(azMessages.imports.costFields.dutyTypedHelp, "Rüsum sətirlərdəki faizdən hesablanır. Gömrük bəyannaməsindəki məbləği yazsanız, o istifadə olunacaq");
  assert.equal(azMessages.imports.issues.duty_by_value, "Rüsum faizi yoxdur, dəyərə görə bölündü");
  const grid = read("src/modules/imports/components/ImportCostsGrid.tsx");
  assert.doesNotMatch(grid, /computedDutyHint/, "the hidden tooltip is replaced by visible text");
  assert.match(grid, /dutyTypedHelp/);
});
