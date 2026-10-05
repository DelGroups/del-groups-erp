// Expense documents: VAT split, totals and dates used by /expenses.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeVat,
  firstDayOfMonthIsoDate,
  isOwedToEmployee,
  splitGross,
  summarizeExpenses,
  todayIsoDate,
} from "../src/lib/expenses/expenseDocuments.ts";

test("a VAT-inclusive amount splits into net + VAT that add back up", () => {
  assert.deepEqual(splitGross(118, 18), { net: 100, vat: 18 });
  const { net, vat } = splitGross(50, 18);
  assert.equal(net, 42.37);
  assert.equal(vat, 7.63);
  assert.equal(Math.round((net + vat) * 100) / 100, 50);
});

test("no VAT or a zero amount leaves everything as net", () => {
  assert.deepEqual(splitGross(25.5, 0), { net: 25.5, vat: 0 });
  assert.deepEqual(splitGross(0, 18), { net: 0, vat: 0 });
  assert.equal(computeVat(100, 18), 18);
  assert.equal(computeVat(100, 0), 0);
});

const row = (overrides) => ({
  id: "x",
  code: "XR-2026-00001",
  expense_date: "2026-10-01",
  status: "posted",
  payment_mode: "company",
  category: "İcarə",
  net_amount: 100,
  vat_amount: 18,
  amount: 118,
  ...overrides,
});

test("totals book paid and approved employee expenses, keep pending apart and skip cancelled", () => {
  const summary = summarizeExpenses([
    row({}),
    row({ category: "Elektrik", net_amount: 40, vat_amount: 0, amount: 40 }),
    row({ status: "draft", amount: 10, net_amount: 10, vat_amount: 0 }),
    row({ status: "submitted", amount: 7, net_amount: 7, vat_amount: 0 }),
    row({ status: "approved", payment_mode: "employee", category: "Yanacaq", amount: 25, net_amount: 25, vat_amount: 0 }),
    row({ status: "cancelled", amount: 999 }),
  ]);
  assert.equal(summary.count, 3);
  assert.equal(summary.total, 183);
  assert.equal(summary.net, 165);
  assert.equal(summary.vat, 18);
  assert.equal(summary.pendingCount, 2);
  assert.equal(summary.pendingTotal, 17);
  assert.equal(summary.owedCount, 1);
  assert.equal(summary.owedTotal, 25);
  assert.deepEqual(
    summary.byCategory.map((c) => [c.category, c.amount]),
    [
      ["İcarə", 118],
      ["Elektrik", 40],
      ["Yanacaq", 25],
    ]
  );
});

test("only approved employee-paid expenses are owed", () => {
  assert.equal(isOwedToEmployee({ status: "approved", payment_mode: "employee" }), true);
  assert.equal(isOwedToEmployee({ status: "posted", payment_mode: "employee" }), false);
  assert.equal(isOwedToEmployee({ status: "approved", payment_mode: "company" }), false);
});

test("dates are taken in Baku time", () => {
  // 22:30 UTC on 31 Oct is already 1 Nov in Baku (UTC+4).
  const late = new Date("2026-10-31T22:30:00Z");
  assert.equal(todayIsoDate(late), "2026-11-01");
  assert.equal(firstDayOfMonthIsoDate(late), "2026-11-01");
});
