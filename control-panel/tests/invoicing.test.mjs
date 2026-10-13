// Invoices and dunning (prompt 13): numbering, totals, renewal dates, dunning stages.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  DEFAULT_BILLING_SETTINGS,
  formatInvoiceNumber,
  invoiceTotals,
  quoteLines,
  renewalStep,
} from "../lib/billing/invoicing.ts";
import { decideDunning, dunningStage } from "../lib/billing/dunning.ts";
import { quote, toCents } from "../lib/billing/pricing.ts";
import { formatDocDate, formatDocMoney } from "../lib/billing/docFormat.ts";

const CATALOG = [
  { id: "core", depends: [], isCore: true },
  { id: "inventory", depends: ["core"], isCore: false },
  { id: "accounting", depends: ["core"], isCore: false },
  { id: "sales", depends: ["core", "inventory", "accounting"], isCore: false },
];
const PLAN = {
  currency: "AZN",
  baseFee: 50,
  annualDiscountPct: 17,
  maxUsers: 25,
  includedStorageGb: 20,
  includedAiCreditUsd: 5,
  includesCustomDomain: false,
  modules: [
    { moduleId: "accounting", amount: 6, perUser: true },
    { moduleId: "inventory", amount: 5, perUser: true },
    { moduleId: "sales", amount: 8, perUser: true },
  ],
  addons: [{ code: "extra_users", amount: 15 }],
};
const LABELS = { base: "Base", module: (id) => `M:${id}`, addon: (c) => `A:${c}`, discount: (p) => `Discount ${p} %` };

// ── Numbering and totals ─────────────────────────────────────────────────────

test("invoice numbers: prefix, year, five digits (same as public.next_invoice_number)", () => {
  assert.equal(formatInvoiceNumber("INV", 2026, 1), "INV-2026-00001");
  assert.equal(formatInvoiceNumber("DG", 2027, 123456), "DG-2027-123456");
});

test("totals: tax on the subtotal, rounded to the cent; negative lines reduce the subtotal", () => {
  assert.deepEqual(invoiceTotals([{ amount: 100 }, { amount: 0.1 }, { amount: 0.2 }], 18), { subtotalCents: 10030, taxCents: 1805, totalCents: 11835 });
  assert.deepEqual(invoiceTotals([{ amount: 120 }, { amount: -20.4 }], 0), { subtotalCents: 9960, taxCents: 0, totalCents: 9960 });
  assert.equal(invoiceTotals([{ amount: 10 }], 250).taxCents, 1000, "rate is capped at 100 %");
});

test("monthly lines are the quote's lines and add up to the period price", () => {
  const q = quote(PLAN, { period: "monthly", userCount: 5, modules: ["sales"], addons: { extra_users: 2 } }, CATALOG);
  const lines = quoteLines(q, LABELS, PLAN.annualDiscountPct);
  assert.deepEqual(
    lines.map((l) => [l.kind, l.item_id, l.description, l.quantity, l.unit_price, l.amount]),
    [
      ["base", null, "Base", 1, 50, 50],
      ["module", "inventory", "M:inventory", 5, 5, 25],
      ["module", "accounting", "M:accounting", 5, 6, 30],
      ["module", "sales", "M:sales", 5, 8, 40],
      ["addon", "extra_users", "A:extra_users", 2, 15, 30],
    ]
  );
  assert.equal(lines.reduce((s, l) => s + toCents(l.amount), 0), q.periodCents);
});

test("yearly lines are twelve months each plus the yearly discount as a negative line", () => {
  const q = quote(PLAN, { period: "yearly", userCount: 3, modules: ["inventory"], addons: {} }, CATALOG);
  const lines = quoteLines(q, LABELS, PLAN.annualDiscountPct);
  assert.deepEqual(lines.at(-1), { kind: "discount", item_id: null, description: "Discount 17 %", quantity: 1, unit_price: -132.6, amount: -132.6 });
  assert.equal(lines[0].amount, 600);
  assert.equal(lines.reduce((s, l) => s + toCents(l.amount), 0), q.periodCents);
  assert.equal(q.periodCents, 64740);
});

// ── Renewal dates ────────────────────────────────────────────────────────────

test("renewal: invoice issued payment_terms_days before the renewal date, due on it; period moves on that date", () => {
  const sub = { billing_period: "monthly", current_period_start: "2026-10-01", current_period_end: "2026-11-01" };
  const before = renewalStep(sub, "2026-10-24", DEFAULT_BILLING_SETTINGS);
  assert.deepEqual(before, {
    periodStart: "2026-11-01", periodEnd: "2026-12-01", issueDate: "2026-10-25", dueDate: "2026-11-01", issue: false, advance: false,
  });
  assert.equal(renewalStep(sub, "2026-10-25", DEFAULT_BILLING_SETTINGS).issue, true);
  assert.equal(renewalStep(sub, "2026-10-31", DEFAULT_BILLING_SETTINGS).advance, false);
  assert.equal(renewalStep(sub, "2026-11-01", DEFAULT_BILLING_SETTINGS).advance, true);
  assert.equal(renewalStep({ ...sub, current_period_end: null }, "2026-11-01", DEFAULT_BILLING_SETTINGS), null);
});

test("renewal: month ends and yearly periods; zero payment terms issue on the renewal date", () => {
  const jan = renewalStep({ billing_period: "monthly", current_period_start: "2026-12-31", current_period_end: "2027-01-31" }, "2027-01-20", DEFAULT_BILLING_SETTINGS);
  assert.equal(jan.periodEnd, "2027-02-28");
  const yearly = renewalStep({ billing_period: "yearly", current_period_start: "2026-03-01", current_period_end: "2027-03-01" }, "2027-02-01", { paymentTermsDays: 0 });
  assert.deepEqual([yearly.issueDate, yearly.periodEnd, yearly.issue], ["2027-03-01", "2028-03-01", false]);
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

// ── Dunning ──────────────────────────────────────────────────────────────────

const SETTINGS = { graceDays: 7, suspendAfterDays: 30 };

test("dunning stages: due date, 7 days grace, 30 days read-only, then suspended", () => {
  const stages = [0, 1, 7, 8, 37, 38, 400].map((d) => dunningStage(d, SETTINGS));
  assert.deepEqual(stages, ["active", "past_due", "past_due", "read_only", "read_only", "suspended", "suspended"]);
  assert.deepEqual([1, 3, 4, 5].map((d) => dunningStage(d, { graceDays: 2, suspendAfterDays: 2 })), ["past_due", "read_only", "read_only", "suspended"]);
});

test("an unpaid invoice walks the tenant through every state, and paying makes it active again", () => {
  const invoice = { id: "inv-1", dueDate: "2026-11-01" };
  let status = "active";
  let source = "admin";
  const seen = [];
  const day = (today, unpaid = [invoice]) => {
    const d = decideDunning({ tenantStatus: status, statusSource: source, pausedUntil: null, unpaid, lastPaidInvoiceId: "inv-1", today, settings: SETTINGS });
    if (d.status) {
      status = d.status;
      source = "billing";
      seen.push([today, d.status, d.email, d.invoiceId, d.daysOverdue]);
    }
    return d;
  };
  for (let date = "2026-10-25"; date <= "2026-12-20"; date = addDays(date, 1)) day(date);
  assert.deepEqual(seen, [
    ["2026-11-02", "past_due", "past_due", "inv-1", 1],
    ["2026-11-09", "read_only", "read_only", "inv-1", 8],
    ["2026-12-09", "suspended", "suspended", "inv-1", 38],
  ]);
  day("2026-12-21", []); // paid
  assert.deepEqual(seen.at(-1), ["2026-12-21", "active", "reactivated", "inv-1", 0]);
  assert.equal(day("2026-12-22", []).status, null, "nothing more to do");
});

test("dunning leaves alone: trial/active without overdue invoices, admin-set restrictions, paused tenants, provisioning", () => {
  const base = { statusSource: "admin", pausedUntil: null, lastPaidInvoiceId: null, today: "2026-12-01", settings: SETTINGS };
  const late = [{ id: "a", dueDate: "2026-11-01" }];
  assert.equal(decideDunning({ ...base, tenantStatus: "trial", unpaid: [{ id: "a", dueDate: "2026-12-01" }] }).status, null, "due today is not late");
  assert.equal(decideDunning({ ...base, tenantStatus: "suspended", unpaid: [] }).status, null, "an admin's suspension is never lifted");
  assert.equal(decideDunning({ ...base, tenantStatus: "read_only", unpaid: late }).status, null, "an admin's read-only stays");
  assert.equal(decideDunning({ ...base, tenantStatus: "active", pausedUntil: "2026-12-01", unpaid: late }).status, null, "paused up to and including the date");
  assert.equal(decideDunning({ ...base, tenantStatus: "active", pausedUntil: "2026-11-30", unpaid: late }).status, "read_only");
  assert.equal(decideDunning({ ...base, tenantStatus: "provisioning", unpaid: late }).status, null);
  assert.equal(decideDunning({ ...base, tenantStatus: "cancelled", unpaid: late }).status, null);
  assert.equal(decideDunning({ ...base, tenantStatus: "trial", unpaid: late }).status, "read_only", "a trial with a late invoice is dunned");
});

test("dunning: the oldest overdue invoice decides; invoices without a due date are ignored", () => {
  const d = decideDunning({
    tenantStatus: "active",
    statusSource: "admin",
    pausedUntil: null,
    unpaid: [{ id: "new", dueDate: "2026-12-01" }, { id: "none", dueDate: null }, { id: "old", dueDate: "2026-10-01" }],
    lastPaidInvoiceId: null,
    today: "2026-12-05",
    settings: SETTINGS,
  });
  assert.deepEqual([d.status, d.invoiceId, d.daysOverdue], ["suspended", "old", 65]);
});

test("invoice dates and amounts print the same in every language", () => {
  assert.equal(formatDocDate("2026-11-01"), "01.11.2026");
  assert.equal(formatDocDate("2026-11-01T10:00:00Z"), "01.11.2026");
  assert.equal(formatDocDate(null), "");
  assert.equal(formatDocMoney(1234567.5, "AZN"), "1 234 567.50 AZN");
  assert.equal(formatDocMoney(-20.4, "USD"), "−20.40 USD");
});
