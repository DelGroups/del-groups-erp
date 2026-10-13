// Plans and limits (prompt 12): price math, proration, entitlements and validation.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GIB,
  addPeriod,
  daysBetween,
  entitlements,
  fromCents,
  limitState,
  prorate,
  quote,
  validateChoice,
  withDependencies,
} from "../lib/billing/pricing.ts";

const CATALOG = [
  { id: "core", depends: [], isCore: true },
  { id: "accounting", depends: ["core"], isCore: false },
  { id: "inventory", depends: ["core"], isCore: false },
  { id: "contracts", depends: ["core"], isCore: false },
  { id: "sales", depends: ["core", "inventory", "accounting", "contracts"], isCore: false },
  { id: "hr", depends: ["core"], isCore: false },
  { id: "payroll", depends: ["core", "hr", "accounting"], isCore: false },
];

/** Business: 50 AZN base, sales 8/user, inventory 5/user, accounting 6/user, contracts 20 flat, hr 4/user. */
const PLAN = {
  currency: "AZN",
  baseFee: 50,
  annualDiscountPct: 17,
  maxUsers: 25,
  includedStorageGb: 20,
  includedAiCreditUsd: 5,
  includesCustomDomain: false,
  modules: [
    { moduleId: "sales", amount: 8, perUser: true },
    { moduleId: "inventory", amount: 5, perUser: true },
    { moduleId: "accounting", amount: 6, perUser: true },
    { moduleId: "contracts", amount: 20, perUser: false },
    { moduleId: "hr", amount: 4, perUser: true },
  ],
  addons: [
    { code: "extra_users", amount: 15 },
    { code: "storage_gb", amount: 3.5 },
    { code: "ai_credit", amount: 12 },
    { code: "custom_domain", amount: 9.99 },
  ],
};
const choice = (over = {}) => ({ period: "monthly", userCount: 5, modules: ["sales"], addons: {}, ...over });

// ── Price ────────────────────────────────────────────────────────────────────

test("dependencies and core are added in catalog order", () => {
  assert.deepEqual(withDependencies(["sales"], CATALOG), ["core", "accounting", "inventory", "contracts", "sales"]);
  assert.deepEqual(withDependencies([], CATALOG), ["core"]);
  assert.deepEqual(withDependencies(["payroll", "nope"], CATALOG), ["core", "accounting", "hr", "payroll"]);
});

test("monthly = base + per-user modules × users + flat modules", () => {
  const q = quote(PLAN, choice(), CATALOG);
  // 50 + (6 + 5 + 8) × 5 + 20 = 165
  assert.equal(q.monthlyCents, 16_500);
  assert.equal(q.periodCents, 16_500);
  assert.equal(q.discountCents, 0);
  assert.deepEqual(
    q.lines.map((l) => [l.kind, l.id, l.quantity, l.unitCents, l.totalCents]),
    [
      ["base", "base", 1, 5000, 5000],
      ["module", "accounting", 5, 600, 3000],
      ["module", "inventory", 5, 500, 2500],
      ["module", "contracts", 1, 2000, 2000],
      ["module", "sales", 5, 800, 4000],
    ]
  );
  assert.deepEqual(q.modules, ["core", "accounting", "inventory", "contracts", "sales"]);
});

test("yearly = monthly × 12 × (1 − discount), rounded to the cent", () => {
  const q = quote(PLAN, choice({ period: "yearly" }), CATALOG);
  assert.equal(q.monthlyCents, 16_500);
  assert.equal(q.discountCents, Math.round(16_500 * 12 * 0.17)); // 33 660
  assert.equal(q.periodCents, 198_000 - 33_660);
  assert.equal(fromCents(q.periodCents), 1643.4);
  const none = quote({ ...PLAN, annualDiscountPct: 0 }, choice({ period: "yearly" }), CATALOG);
  assert.equal(none.periodCents, 198_000);
});

test("add-ons are priced per unit; 0.1 + 0.2 style float errors cannot appear", () => {
  const q = quote(PLAN, choice({ addons: { extra_users: 2, storage_gb: 3, ai_credit: 1, custom_domain: 1 } }), CATALOG);
  // 165 + 2×15 + 3×3.50 + 12 + 9.99 = 227.49
  assert.equal(q.monthlyCents, 22_749);
  assert.deepEqual(q.lines.filter((l) => l.kind === "addon").map((l) => [l.id, l.quantity, l.totalCents]), [
    ["extra_users", 2, 3000], ["storage_gb", 3, 1050], ["ai_credit", 1, 1200], ["custom_domain", 1, 999],
  ]);
  const tiny = quote({ ...PLAN, baseFee: 0.1, modules: [{ moduleId: "hr", amount: 0.2, perUser: false }] }, choice({ modules: ["hr"] }), CATALOG);
  assert.equal(tiny.monthlyCents, 30);
});

test("an add-on the plan does not sell, or a zero quantity, adds nothing", () => {
  const q = quote({ ...PLAN, addons: [] }, choice({ addons: { extra_users: 3, storage_gb: 0 } }), CATALOG);
  assert.equal(q.monthlyCents, 16_500);
});

// ── Limits ───────────────────────────────────────────────────────────────────

test("entitlements: seats = users + extra seats; storage and AI from plan + add-ons; null = unlimited", () => {
  assert.deepEqual(entitlements(PLAN, choice()), { seatLimit: 5, storageLimitBytes: 20 * GIB, aiLimitUsd: 5, customDomain: false });
  assert.deepEqual(entitlements(PLAN, choice({ addons: { extra_users: 2, storage_gb: 3, ai_credit: 2, custom_domain: 1 } })), {
    seatLimit: 7,
    storageLimitBytes: 50 * GIB,
    aiLimitUsd: 25,
    customDomain: true,
  });
  const unlimited = entitlements({ ...PLAN, includedStorageGb: null, includedAiCreditUsd: null, includesCustomDomain: true }, choice({ addons: { storage_gb: 5 } }));
  assert.deepEqual(unlimited, { seatLimit: 5, storageLimitBytes: null, aiLimitUsd: null, customDomain: true });
});

test("limit states: warning from 80 %, blocked at 100 %", () => {
  assert.equal(limitState(5, null), "unlimited");
  assert.equal(limitState(3, 5), "ok");
  assert.equal(limitState(4, 5), "warning");
  assert.equal(limitState(5, 5), "blocked");
  assert.equal(limitState(6, 5), "blocked");
  assert.equal(limitState(0, 0), "blocked");
  assert.equal(limitState(7.99, 10), "ok");
  assert.equal(limitState(8, 10), "warning");
});

test("validation: seats within the plan cap, modules and add-ons offered by the plan", () => {
  assert.deepEqual(validateChoice(PLAN, choice(), CATALOG, 3), { errors: [], missingModules: [], belowActiveUsers: false });
  assert.deepEqual(validateChoice(PLAN, choice({ userCount: 26 }), CATALOG).errors, ["usersAbovePlan"]);
  assert.deepEqual(validateChoice(PLAN, choice({ userCount: 0 }), CATALOG).errors, ["usersInvalid"]);
  assert.deepEqual(validateChoice(PLAN, choice({ userCount: 2.5 }), CATALOG).errors, ["usersInvalid"]);
  // payroll needs hr + accounting; payroll itself is not in the plan.
  const r = validateChoice(PLAN, choice({ modules: ["payroll"] }), CATALOG);
  assert.deepEqual(r.errors, ["moduleNotInPlan"]);
  assert.deepEqual(r.missingModules, ["payroll"]);
  assert.deepEqual(validateChoice({ ...PLAN, addons: [] }, choice({ addons: { storage_gb: 1 } }), CATALOG).errors, ["addonNotInPlan"]);
  assert.deepEqual(validateChoice(PLAN, choice({ addons: { custom_domain: 2 } }), CATALOG).errors, ["addonQuantityInvalid"]);
  assert.deepEqual(validateChoice(PLAN, choice({ addons: { storage_gb: -1 } }), CATALOG).errors, ["addonQuantityInvalid"]);
  assert.deepEqual(validateChoice(PLAN, choice({ period: "weekly" }), CATALOG).errors, ["periodInvalid"]);
  // Fewer seats than active users is allowed but flagged.
  assert.equal(validateChoice(PLAN, choice({ userCount: 5 }), CATALOG, 6).belowActiveUsers, true);
  assert.equal(validateChoice(PLAN, choice({ userCount: 5, addons: { extra_users: 1 } }), CATALOG, 6).belowActiveUsers, false);
  // No cap on the plan.
  assert.deepEqual(validateChoice({ ...PLAN, maxUsers: null }, choice({ userCount: 500 }), CATALOG).errors, []);
});

// ── Proration ────────────────────────────────────────────────────────────────

test("calendar helpers", () => {
  assert.equal(daysBetween("2026-10-01", "2026-11-01"), 31);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // DST change does not matter (UTC)
  assert.equal(addPeriod("2026-10-15", "monthly"), "2026-11-15");
  assert.equal(addPeriod("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(addPeriod("2028-01-31", "monthly"), "2028-02-29");
  assert.equal(addPeriod("2028-02-29", "yearly"), "2029-02-28");
});

test("upgrade in the middle of a month: charge the new price and credit the old for the days left", () => {
  // 30-day period, 12 days left; 165 → 227.49
  const p = prorate({
    current: { periodCents: 16_500, period: "monthly", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    next: { periodCents: 22_749, period: "monthly" },
    changeDate: "2026-10-19",
  });
  assert.deepEqual(p, {
    daysTotal: 30,
    daysLeft: 12,
    creditCents: 6600, // 165 × 12/30
    chargeCents: 9100, // 227.49 × 12/30 = 90.996
    dueCents: 2500,
    nextChargeDate: "2026-10-31",
    nextChargeCents: 22_749,
  });
});

test("downgrade gives a credit (negative amount due)", () => {
  const p = prorate({
    current: { periodCents: 22_749, period: "monthly", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    next: { periodCents: 16_500, period: "monthly" },
    changeDate: "2026-10-19",
  });
  assert.equal(p.dueCents, 6600 - 9100);
});

test("a change on the first day costs the full difference, on the last day nothing", () => {
  const current = { periodCents: 10_000, period: "monthly", periodStart: "2026-10-01", periodEnd: "2026-10-31" };
  const next = { periodCents: 13_000, period: "monthly" };
  assert.equal(prorate({ current, next, changeDate: "2026-10-01" }).dueCents, 3000);
  assert.equal(prorate({ current, next, changeDate: "2026-10-31" }).dueCents, 0);
  // Dates outside the period are clamped.
  assert.equal(prorate({ current, next, changeDate: "2026-09-20" }).dueCents, 3000);
  assert.equal(prorate({ current, next, changeDate: "2026-11-20" }).dueCents, 0);
});

test("monthly → yearly: credit the unused month, start a full discounted year today", () => {
  const p = prorate({
    current: { periodCents: 16_500, period: "monthly", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
    next: { periodCents: 164_340, period: "yearly" },
    changeDate: "2026-10-16",
  });
  assert.equal(p.creditCents, 8250); // 15 of 30 days
  assert.equal(p.chargeCents, 164_340);
  assert.equal(p.dueCents, 164_340 - 8250);
  assert.equal(p.nextChargeDate, "2027-10-16");
});

test("a new subscription (or one without a period yet) pays the first full period", () => {
  const p = prorate({ current: null, next: { periodCents: 16_500, period: "monthly" }, changeDate: "2026-10-13" });
  assert.deepEqual(p, { daysTotal: 0, daysLeft: 0, creditCents: 0, chargeCents: 16_500, dueCents: 16_500, nextChargeDate: "2026-11-13", nextChargeCents: 16_500 });
  const trial = prorate({
    current: { periodCents: 0, period: "monthly", periodStart: null, periodEnd: null },
    next: { periodCents: 16_500, period: "monthly" },
    changeDate: "2026-10-13",
  });
  assert.equal(trial.dueCents, 16_500);
});
