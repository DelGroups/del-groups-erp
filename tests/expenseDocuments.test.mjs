// Expense documents: VAT split, totals and dates used by /expenses.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthlyReport,
  computeVat,
  firstDayOfMonthIsoDate,
  guessVatAccountId,
  isExpenseAttachmentPath,
  isOwedToEmployee,
  monthRange,
  validateExpenseAttachment,
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

test("monthly report books paid and approved expenses and fills empty months", () => {
  const report = buildMonthlyReport(
    [
      row({ expense_date: "2026-07-03", category: "İcarə", amount: 500 }),
      row({ expense_date: "2026-09-10", category: "İcarə", amount: 500 }),
      row({ expense_date: "2026-09-12", category: "Yanacaq", amount: 40.5 }),
      row({ expense_date: "2026-09-13", status: "approved", payment_mode: "employee", category: "Yanacaq", amount: 9.5 }),
      row({ expense_date: "2026-08-01", status: "draft", amount: 70 }),
      row({ expense_date: "2026-08-02", status: "cancelled", amount: 70 }),
    ],
    "category"
  );
  assert.deepEqual(report.months, ["2026-07", "2026-08", "2026-09"]);
  assert.equal(report.total, 1050);
  assert.deepEqual(report.monthTotals, { "2026-07": 500, "2026-08": 0, "2026-09": 550 });
  assert.deepEqual(
    report.lines.map((l) => [l.label, l.total]),
    [
      ["İcarə", 1000],
      ["Yanacaq", 50],
    ]
  );
});

test("department report puts rows without a department under one label", () => {
  const report = buildMonthlyReport(
    [row({ department_name: "Satış" }), row({ department_name: null }), row({ department_name: "  " })],
    "department",
    "Şöbəsiz"
  );
  assert.deepEqual(
    report.lines.map((l) => [l.label, l.total]),
    [
      ["Şöbəsiz", 236],
      ["Satış", 118],
    ]
  );
});

test("month ranges cross the year end", () => {
  assert.deepEqual(monthRange("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(monthRange("", ""), []);
});

test("attachments accept receipts up to 10 MB and only module-issued paths", () => {
  assert.equal(validateExpenseAttachment({ type: "image/jpg", size: 2000 }), null);
  assert.equal(validateExpenseAttachment({ type: "application/pdf", size: 10 * 1024 * 1024 }), null);
  assert.notEqual(validateExpenseAttachment({ type: "application/pdf", size: 10 * 1024 * 1024 + 1 }), null);
  assert.notEqual(validateExpenseAttachment({ type: "text/html", size: 10 }), null);
  assert.notEqual(validateExpenseAttachment({ type: "image/png", size: 0 }), null);

  const id = "4f0c1c2e-1111-4222-8333-944455556666";
  assert.equal(isExpenseAttachmentPath(id, `${id}/0b7f3c1a-2222-4333-8444-955566667777.pdf`), true);
  assert.equal(isExpenseAttachmentPath(id, `other/0b7f3c1a-2222-4333-8444-955566667777.pdf`), false);
  assert.equal(isExpenseAttachmentPath(id, `${id}/../x.pdf`), false);
  assert.equal(isExpenseAttachmentPath(id, `${id}/0b7f3c1a-2222-4333-8444-955566667777.exe`), false);
});

test("the VAT account defaults to the flagged one, else one named EDV", () => {
  assert.equal(
    guessVatAccountId([
      { id: "a", name: "ABB bank" },
      { id: "b", name: "EDV" },
    ]),
    "b"
  );
  assert.equal(
    guessVatAccountId([
      { id: "a", name: "ƏDV depozit" },
      { id: "c", name: "Depozit", is_vat_account: true },
    ]),
    "c"
  );
  assert.equal(guessVatAccountId([{ id: "a", name: "Nəğd kassa" }, { id: "d", name: "EDVX" }]), "");
});
