// Plans and subscriptions (prompt 12): editor validation, row mapping and the tenant sync.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlanForm, parseSubscriptionForm } from "../lib/billing/forms.ts";
import { toChoice, toPlanPricing } from "../lib/billing/catalog.ts";
import { syncTenant, tenantLimitsSql, tenantSyncSql } from "../lib/billing/sync.ts";
import { quote } from "../lib/billing/pricing.ts";

const MODULE_IDS = ["core", "inventory", "sales", "hr"];
const TOKEN = "test-management-token-not-real-0003";

// ── Plan editor ──────────────────────────────────────────────────────────────

test("plan form: modules ticked with prices, add-ons with a price are sold, empty limits are unlimited", () => {
  const r = parsePlanForm(
    {
      code: " Business ", name: "Business", annual_discount_pct: "17", is_active: "on", sort_order: "2",
      max_users: "25", included_storage_gb: "", included_ai_credit_usd: "5,50", currency: "azn", base_fee: "49.90",
      module_inventory: "on", price_inventory: "5", per_user_inventory: "on",
      module_sales: "on", price_sales: "8,5",
      price_hr: "4", // not ticked: not offered
      addon_extra_users: "15", addon_storage_gb: "", addon_custom_domain: "0",
    },
    MODULE_IDS,
    "plan-1"
  );
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value, {
    id: "plan-1", code: "business", name: "Business", description: "", annual_discount_pct: 17, is_active: true, sort_order: 2,
    max_users: 25, included_storage_gb: null, included_ai_credit_usd: 5.5, includes_custom_domain: false, currency: "AZN", base_fee: 49.9,
    modules: [{ module_id: "inventory", amount: 5, per_user: true }, { module_id: "sales", amount: 8.5, per_user: false }],
    addons: [{ addon_code: "extra_users", amount: 15 }, { addon_code: "custom_domain", amount: 0 }],
  });
});

test("plan form: every bad field is reported", () => {
  const r = parsePlanForm(
    { code: "9bad", name: "", annual_discount_pct: "120", max_users: "0", base_fee: "-1", currency: "manat",
      module_sales: "on", price_sales: "1.234", addon_ai_credit: "x", included_storage_gb: "lots", sort_order: "1.5" },
    MODULE_IDS
  );
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), [
    "addon_ai_credit", "annual_discount_pct", "base_fee", "code", "currency", "included_storage_gb", "max_users", "name", "price_sales", "sort_order",
  ]);
});

// ── Subscription editor ──────────────────────────────────────────────────────

test("subscription form: shape, dates and add-on quantities", () => {
  const ok = parseSubscriptionForm(
    { plan_id: "p1", status: "active", billing_period: "monthly", user_count: "5", current_period_start: "2026-10-01",
      current_period_end: "2026-10-31", module_sales: "on", module_hr: "", addon_extra_users: "2", addon_storage_gb: "0" },
    "t1", ["p1"], MODULE_IDS
  );
  assert.deepEqual(ok, {
    ok: true,
    value: { tenant_id: "t1", plan_id: "p1", status: "active", billing_period: "monthly", user_count: 5, current_period_start: "2026-10-01",
      current_period_end: "2026-10-31", trial_ends_at: "", modules: ["sales"], addons: [{ addon_code: "extra_users", quantity: 2 }] },
  });
  const bad = parseSubscriptionForm(
    { plan_id: "nope", status: "expired", billing_period: "weekly", user_count: "0", current_period_start: "2026-10-31",
      current_period_end: "2026-10-01", addon_custom_domain: "2", addon_extra_users: "-1" },
    "t1", ["p1"], MODULE_IDS
  );
  assert.deepEqual(Object.keys(bad.errors).sort(), ["addon_custom_domain", "addon_extra_users", "billing_period", "current_period_end", "plan_id", "status", "user_count"]);
});

// ── Mapping ──────────────────────────────────────────────────────────────────

const PLAN_ROW = {
  id: "p1", code: "business", name: "Business", description: null, annual_discount_pct: "17.00", is_active: true, sort_order: 0,
  max_users: 25, included_storage_gb: "20.00", included_ai_credit_usd: null, includes_custom_domain: false,
  plan_prices: [
    { module_id: null, billing_period: "monthly", currency: "AZN", amount: "50.00", per_user: false },
    { module_id: "sales", billing_period: "monthly", currency: "AZN", amount: "8.00", per_user: true },
    { module_id: "inventory", billing_period: "monthly", currency: "AZN", amount: "5.00", per_user: true },
    { module_id: "sales", billing_period: "yearly", currency: "AZN", amount: "80.00", per_user: true }, // ignored: yearly is derived
    { module_id: "hr", billing_period: "monthly", currency: "USD", amount: "3.00", per_user: true }, // other currency: ignored
  ],
  plan_addon_prices: [{ addon_code: "storage_gb", currency: "AZN", amount: "3.50" }, { addon_code: "extra_users", currency: "AZN", amount: "15" }],
};

test("plan rows map to monthly prices in the plan's currency", () => {
  assert.deepEqual(toPlanPricing(PLAN_ROW), {
    currency: "AZN", baseFee: 50, annualDiscountPct: 17, maxUsers: 25, includedStorageGb: 20, includedAiCreditUsd: null,
    includesCustomDomain: false,
    modules: [{ moduleId: "inventory", amount: 5, perUser: true }, { moduleId: "sales", amount: 8, perUser: true }],
    addons: [{ code: "extra_users", amount: 15 }, { code: "storage_gb", amount: 3.5 }],
  });
});

test("subscription rows map to a choice the price module can quote", () => {
  const choice = toChoice({
    id: "s1", plan_id: "p1", status: "active", billing_period: "monthly", currency: "AZN", user_count: 5,
    current_period_start: null, current_period_end: null, trial_ends_at: null, sync_status: "synced", synced_at: null, sync_error: null,
    subscription_items: [{ module_id: "sales" }, { module_id: "inventory" }],
    subscription_addons: [{ addon_code: "extra_users", quantity: 2 }, { addon_code: "storage_gb", quantity: 0 }, { addon_code: "bogus", quantity: 1 }],
  });
  assert.deepEqual(choice, { period: "monthly", userCount: 5, modules: ["inventory", "sales"], addons: { extra_users: 2 } });
  const catalog = [
    { id: "core", depends: [], isCore: true },
    { id: "inventory", depends: ["core"], isCore: false },
    { id: "sales", depends: ["core", "inventory"], isCore: false },
  ];
  // 50 + (5 + 8) × 5 + 2 × 15 = 145
  assert.equal(quote(toPlanPricing(PLAN_ROW), choice, catalog).monthlyCents, 14_500);
});

// ── Sync to the tenant database ──────────────────────────────────────────────

const ENT = { subscription_id: "s1", status: "active", seat_limit: 5, storage_limit_bytes: "21474836480", ai_limit_usd: "5.00", custom_domain: false, modules: ["core", "inventory", "sales"] };

test("limits SQL: one row from the entitlements, or no row; only validated numbers reach SQL", () => {
  const sql = tenantLimitsSql(ENT);
  assert.match(sql, /values \(true, 5, 21474836480, 5\.00, now\(\), now\(\)\)/);
  assert.match(sql, /on conflict \(id\) do update/);
  assert.match(tenantLimitsSql({ ...ENT, storage_limit_bytes: null, ai_limit_usd: null }), /values \(true, 5, null, null,/);
  assert.match(tenantLimitsSql(null), /if to_regclass\('public\.tenant_limits'\) is not null then delete from public\.tenant_limits;/);
  assert.throws(() => tenantLimitsSql({ ...ENT, seat_limit: "5; drop table x" }), /not a whole number/);
  assert.throws(() => tenantLimitsSql({ ...ENT, ai_limit_usd: "1); drop" }), /not an amount/);
});

test("sync SQL: modules and limits in one transaction; without a subscription only the limits go", () => {
  const sql = tenantSyncSql(ENT, ["core", "hr", "inventory", "sales"]);
  assert.ok(sql.startsWith("begin;") && sql.endsWith("commit;"));
  assert.match(sql, /\('inventory', true\)/);
  assert.match(sql, /\('hr', false\)/);
  assert.match(sql, /insert into public\.tenant_limits/);
  const none = tenantSyncSql(null, ["core", "hr"]);
  assert.doesNotMatch(none, /tenant_modules/);
  assert.match(none, /delete from public\.tenant_limits/);
});

function syncWorld({ ref = "abcdefghijklmnopqrst", ent = ENT, fail = null } = {}) {
  const recorded = [];
  const queries = [];
  return {
    recorded,
    queries,
    deps: {
      secrets: [TOKEN],
      store: {
        async entitlements() { return ent; },
        async allModules() { return ["core", "hr", "inventory", "sales"]; },
        async projectRef() { return ref; },
        async recordSync(id, result) { recorded.push([id, result]); },
      },
      api: {
        async runQuery(r, q) {
          queries.push([r, q]);
          if (fail) throw new Error(fail);
          return [];
        },
      },
    },
  };
}

test("syncTenant writes to the tenant's project and records the result on the subscription", async () => {
  const w = syncWorld();
  assert.deepEqual(await syncTenant(w.deps, "t1"), { status: "synced", modules: ENT.modules, seatLimit: 5 });
  assert.equal(w.queries[0][0], "abcdefghijklmnopqrst");
  assert.deepEqual(w.recorded, [["s1", { status: "synced", error: null }]]);
});

test("syncTenant: no database is skipped; a missing ERP migration is explained; tokens are redacted", async () => {
  assert.deepEqual(await syncTenant(syncWorld({ ref: null }).deps, "t1"), { status: "skipped", reason: "no_database" });
  const w = syncWorld({ fail: `HTTP 400 relation "public.tenant_limits" does not exist (token ${TOKEN})` });
  const r = await syncTenant(w.deps, "t1");
  assert.equal(r.status, "failed");
  assert.match(r.error, /lacks migration 20261014100000_tenant_limits/);
  assert.ok(!r.error.includes(TOKEN));
  assert.equal(w.recorded[0][1].status, "failed");
});

// ── Daily usage snapshot ─────────────────────────────────────────────────────

import { parseUsage, runUsageSnapshot, TENANT_USAGE_SQL } from "../lib/billing/usage.ts";

test("usage SQL reads the tenant's own tables; output is parsed strictly", () => {
  for (const part of ["public.profiles where is_active", "storage.objects", "public.ai_usage_log", "date_trunc('month', now())"]) {
    assert.ok(TENANT_USAGE_SQL.includes(part), part);
  }
  assert.deepEqual(parseUsage([{ usage: { active_users: 4, storage_bytes: "1024", ai_requests: 3, ai_cost: "1.234567" } }]), {
    active_users: 4, storage_bytes: 1024, ai_requests: 3, ai_cost: 1.2346,
  });
  assert.throws(() => parseUsage([]), /no usage/);
  assert.throws(() => parseUsage([{ usage: { active_users: -1 } }]), /bad usage/);
});

test("usage job: snapshots every tenant with a database, alerts at 80 % / 100 %, keeps going after a failure", async () => {
  const tenant = (slug, extra = {}) => ({ id: `id-${slug}`, slug, status: "active", projectRef: `ref-${slug}`, isCanary: false, schemaVersion: null, lastMigration: null, ...extra });
  const saved = [];
  const synced = [];
  const usageBySlug = {
    full: { active_users: 5, storage_bytes: 9 * 1024 ** 3, ai_requests: 10, ai_cost: 4.5 },
    free: { active_users: 50, storage_bytes: 1, ai_requests: 0, ai_cost: 0 },
  };
  const summary = await runUsageSnapshot(
    {
      secrets: [TOKEN],
      async tenants() {
        return [tenant("full"), tenant("free"), tenant("broken"), tenant("new", { status: "provisioning" }), tenant("nodb", { projectRef: null })];
      },
      async readUsage(t) {
        if (t.slug === "broken") throw new Error(`HTTP 500 (token ${TOKEN})`);
        return usageBySlug[t.slug];
      },
      async saveSnapshot(id, date, usage) { saved.push([id, date, usage.active_users]); },
      async entitlements(id) {
        return id === "id-full" ? { ...ENT, seat_limit: 5, storage_limit_bytes: 10 * 1024 ** 3, ai_limit_usd: "5.00" } : null;
      },
      async sync(id) { synced.push(id); return { status: "synced", modules: null, seatLimit: null }; },
    },
    "2026-10-14"
  );
  assert.equal(summary.ok, false, "one tenant failed");
  assert.deepEqual(saved, [["id-full", "2026-10-14", 5], ["id-free", "2026-10-14", 50]]);
  assert.deepEqual(synced, ["id-full", "id-free"]);
  assert.deepEqual(summary.alerts, ["full: users 5/5 (blocked)", "full: storage 90 % (warning)", "full: AI 90 % (warning)"]);
  assert.deepEqual(summary.results.find((r) => r.slug === "free").states, { users: "unlimited", storage: "unlimited", ai: "unlimited" });
  const broken = summary.results.find((r) => r.slug === "broken");
  assert.equal(broken.ok, false);
  assert.ok(!broken.error.includes(TOKEN));
  assert.deepEqual(summary.results.map((r) => r.slug), ["full", "free", "broken"]);
});
