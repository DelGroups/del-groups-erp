// The tenant admin's billing page in the ERP (prompt 13): the flag, parsing what the control
// plane returns, meters, the plan change request, the texts, and the read-only exception.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  billingPageEnabled,
  daysUntil,
  invoiceOwed,
  parseBillingOverview,
  usageMeters,
  validatePlanRequest,
} from "../src/lib/billing/overview.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const PLAN = "11111111-1111-4111-8111-111111111111";
const INV1 = "22222222-2222-4222-8222-222222222222";
const INV2 = "33333333-3333-4333-8333-333333333333";
const RAW = {
  tenant: { status: "read_only", currency: "AZN", billing_email: "finance@acme.az" },
  subscription: {
    plan_id: PLAN, plan_code: "business", plan_name: "Business", status: "past_due", billing_period: "monthly",
    currency: "AZN", user_count: 5, current_period_start: "2026-11-01", current_period_end: "2026-12-01",
    trial_ends_at: null, auto_billing: true, payment_provider: "manual_bank_transfer", modules: ["inventory", 7],
  },
  entitlements: { seat_limit: 5 },
  invoices: [
    { id: INV1, number: "INV-2026-00001", status: "overdue", kind: "renewal", currency: "AZN", total: 88.5, amount_paid: 20,
      issued_at: "2026-10-25T00:00:00+00:00", due_date: "2026-11-01", paid_at: null, period_start: "2026-11-01", period_end: "2026-12-01", has_pdf: true },
    { id: INV2, number: "INV-2026-00000", status: "paid", currency: "AZN", total: "10.00", amount_paid: "10.00", has_pdf: false },
    { id: "not-a-uuid", number: "X", status: "issued" },
    { id: INV2, number: "draft", status: "draft" },
  ],
  pending_request: { id: "r", plan_id: PLAN, billing_period: "yearly", user_count: 8, note: " More users ", created_at: "2026-11-03T10:00:00Z" },
  plans: [{ id: PLAN, code: "business", name: "Business", max_users: 25 }, { id: "bad" }],
  bank: { seller_name: "Del Groups MMC", seller_tax_id: "", bank_name: "Test Bank", bank_account: "AZ00TEST", bank_swift: null },
};

test("the billing page is off unless NEXT_PUBLIC_BILLING_PAGE_ENABLED is true", () => {
  assert.equal(billingPageEnabled({}), false);
  assert.equal(billingPageEnabled({ NEXT_PUBLIC_BILLING_PAGE_ENABLED: "1" }), false);
  assert.equal(billingPageEnabled({ NEXT_PUBLIC_BILLING_PAGE_ENABLED: " TRUE " }), true);
});

test("the control plane's answer is parsed strictly; unknown or broken rows are dropped", () => {
  const o = parseBillingOverview([RAW]);
  assert.equal(o.tenantStatus, "read_only");
  assert.deepEqual(o.subscription, {
    planId: PLAN, planName: "Business", status: "past_due", billingPeriod: "monthly", currency: "AZN", userCount: 5,
    periodStart: "2026-11-01", periodEnd: "2026-12-01", trialEndsAt: null, modules: ["inventory"],
  });
  assert.deepEqual(o.invoices.map((i) => [i.number, i.status, i.total, i.amountPaid, i.issuedAt, i.hasPdf]), [
    ["INV-2026-00001", "overdue", 88.5, 20, "2026-10-25T00:00:00+00:00", true],
    ["INV-2026-00000", "paid", 10, 10, null, false],
  ]);
  assert.deepEqual(o.pendingRequest, { planId: PLAN, billingPeriod: "yearly", userCount: 8, note: "More users", createdAt: "2026-11-03T10:00:00Z" });
  assert.deepEqual(o.plans, [{ id: PLAN, name: "Business", maxUsers: 25 }]);
  assert.deepEqual(o.bank, [
    { key: "seller_name", value: "Del Groups MMC" },
    { key: "bank_name", value: "Test Bank" },
    { key: "bank_account", value: "AZ00TEST" },
  ]);
  assert.equal(parseBillingOverview(null), null, "unknown tenant");
  assert.equal(parseBillingOverview({ subscription: {} }), null, "no tenant part");
  assert.equal(parseBillingOverview({ tenant: { status: "active" } }).subscription, null);
});

test("owed amounts, days left and meters", () => {
  const [open, paid] = parseBillingOverview(RAW).invoices;
  assert.equal(invoiceOwed(open), 68.5);
  assert.equal(invoiceOwed(paid), 0);
  assert.equal(daysUntil("2026-12-01", "2026-11-20"), 11);
  assert.equal(daysUntil("2026-11-01", "2026-11-20"), 0, "never negative");
  assert.equal(daysUntil(null, "2026-11-20"), null);
  assert.deepEqual(
    usageMeters({ users: { used: 5, limit: 5 }, storage: { used: 9, limit: 10 }, ai: { used: 1, limit: null } }).map((m) => [m.kind, m.percent, m.state]),
    [["users", 100, "blocked"], ["storage", 90, "warning"], ["ai", 0, "unlimited"]]
  );
});

test("plan change requests: a plan on offer, a period, 1 to 10 000 users, a short note", () => {
  const plans = [{ id: PLAN, maxUsers: 5 }];
  assert.deepEqual(validatePlanRequest({ plan_id: PLAN, billing_period: "yearly", user_count: 12, note: "  more seats " }, plans), {
    ok: true,
    value: { plan_id: PLAN, billing_period: "yearly", user_count: 12, note: "more seats" },
  });
  assert.deepEqual(validatePlanRequest({ plan_id: "other", billing_period: "monthly", user_count: 1 }, plans), { ok: false, error: "planInvalid" });
  assert.deepEqual(validatePlanRequest({ plan_id: PLAN, billing_period: "weekly", user_count: 1 }, plans), { ok: false, error: "periodInvalid" });
  assert.deepEqual(validatePlanRequest({ plan_id: PLAN, billing_period: "monthly", user_count: 1.5 }, plans), { ok: false, error: "usersInvalid" });
  assert.deepEqual(validatePlanRequest({ plan_id: PLAN, billing_period: "monthly", user_count: 2, note: "x".repeat(2001) }, plans), { ok: false, error: "noteTooLong" });
  assert.deepEqual(validatePlanRequest(null, plans), { ok: false, error: "planInvalid" });
});

test("billing texts exist in az, en and ru with the same placeholders, and every key used exists", () => {
  const keys = Object.keys(enMessages.tenantBilling).sort();
  const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [locale, messages] of [["az", azMessages], ["ru", ruMessages]]) {
    assert.deepEqual(Object.keys(messages.tenantBilling).sort(), keys, locale);
    for (const key of keys) assert.deepEqual(params(messages.tenantBilling[key]), params(enMessages.tenantBilling[key]), `${locale}.tenantBilling.${key}`);
    assert.ok(messages.settings.billingTab, `${locale}.settings.billingTab`);
  }
  const source = readFileSync(new URL("../src/app/settings/billing/page.client.tsx", import.meta.url), "utf8");
  const used = new Set([...source.matchAll(/"tenantBilling\.(\w+)"/g)].map((m) => m[1]));
  // Keys built at run time.
  for (const k of ["issued", "paid", "overdue", "void"]) used.add(`status_${k}`);
  for (const k of ["users", "storage", "ai"]) used.add(`meter_${k}`);
  for (const k of ["monthly", "yearly"]) used.add(`period_${k}`);
  for (const k of ["past_due", "read_only"]) used.add(`notice_${k}`);
  for (const k of ["planInvalid", "periodInvalid", "usersInvalid", "noteTooLong", "failed"]) used.add(`error_${k}`);
  for (const k of ["seller_name", "seller_tax_id", "bank_name", "bank_code", "bank_tax_id", "bank_swift", "bank_correspondent_account", "bank_account"]) used.add(`bank_${k}`);
  assert.ok(used.size > 40);
  for (const key of used) assert.ok(keys.includes(key), `tenantBilling.${key} missing`);
});

test("a read-only tenant may still post to /api/billing/ (plan change request), nothing else", () => {
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /const READ_ONLY_OPEN_API_PREFIX = "\/api\/billing\/";/);
  assert.match(proxy, /access\.kind === "read_only_blocked" && !pathname\.startsWith\(READ_ONLY_OPEN_API_PREFIX\)/);
  // The billing routes refuse non-admins and answer 404 while the page is off.
  const auth = readFileSync(new URL("../src/lib/billing/apiAuth.ts", import.meta.url), "utf8");
  assert.match(auth, /billingPageEnabled\(process\.env\)/);
  assert.match(auth, /isAdminRole/);
});
