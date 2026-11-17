// AST-6: insights for management. Each analysis tool on one fixture with numbers worked out by hand, the
// tool gates (permission, admin-only, plan), the skill selection, the morning briefing (facts cut to each
// person's access, the composer with a stand-in Claude client, one per day), the guard form replaced by
// the chat only when the assistant is on, and the texts. The database part is supabase/tests/assistant_briefings.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  coPurchasePairs,
  debtorsAgeing,
  dormantCustomers,
  employeeOverview,
  grossMarginByProduct,
  previousPeriod,
  priceChanges,
  salesByPeriod,
  stockCover,
} from "../src/lib/assistant/insights/compute.ts";
import { canUseInsights, insightToolsFor, INSIGHT_TOOLS, runInsightTool } from "../src/lib/assistant/insights/tools.ts";
import { BRIEFING_SYSTEM_PROMPT, briefingFacts, briefingLinks, briefingUserMessage, cleanBriefingBody } from "../src/lib/assistant/insights/briefing.ts";
import { briefingAccess, briefingRecipients, writeBriefing, nightlyBriefings } from "../src/lib/assistant/insights/briefingServer.ts";
import { selectSkills, skillById } from "../src/lib/assistant/skills.ts";
import { estimateCostUsd } from "../src/lib/ai/native/router.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TODAY = "2026-11-20";

const sale = (id, customer, date, total, paid, extra = {}) => ({
  id,
  doc_no: `SS-${id}`,
  doc_date: date,
  due_date: null,
  customer_id: customer,
  customer_name: { c1: "Konik MMC", c2: "Bakı Dekor", c3: "Xəzər Mebel" }[customer],
  total_amount: total,
  paid_amount: paid,
  status: "posted",
  ...extra,
});
const SALES = [
  sale("s1", "c1", "2026-11-19", 300, 300),
  sale("s2", "c1", "2026-11-10", 200, 0, { due_date: "2026-11-15" }),
  sale("s3", "c2", "2026-10-25", 100, 0),
  sale("s4", "c2", "2026-10-05", 150, 50),
  sale("s5", "c3", "2026-08-01", 80, 80),
  sale("s6", "c3", "2026-08-15", 80, 80),
  sale("s7", "c3", "2026-09-01", 80, 80),
  sale("s8", "c1", "2026-11-18", 999, 0, { status: "draft" }),
  sale("s9", "c1", "2026-10-20", 100, 100),
  sale("s10", "c2", "2026-11-01", 70, 70),
];
const line = (sale_id, product_id, quantity, line_total, cogs_amount) => ({
  sale_id,
  product_id,
  product_name: { p1: "Panel", p2: "Vint", p3: "Lent" }[product_id],
  quantity,
  unit_price: line_total / quantity,
  line_total,
  cogs_amount,
});
const LINES = [
  line("s1", "p1", 5, 250, 150),
  line("s1", "p2", 10, 50, null),
  line("s2", "p1", 2, 100, 60),
  line("s2", "p3", 4, 100, 80),
  line("s3", "p1", 1, 50, 30),
  line("s3", "p3", 1, 50, 20),
  line("s9", "p1", 2, 80, 60),
  line("s4", "p2", 10, 150, 30),
  line("s10", "p1", 1, 40, 24),
  line("s10", "p3", 1, 30, 20),
  line("s8", "p1", 99, 999, 1),
];
const PRODUCTS = [
  { id: "p1", code: "P-1", name: "Panel", unit: "ədəd", stock: 6, min_stock: 2, buy_price: 30, sell_price: 50 },
  { id: "p2", code: "P-2", name: "Vint", unit: "ədəd", stock: 4, min_stock: null, buy_price: 4, sell_price: 6 },
  { id: "p3", code: "P-3", name: "Lent", unit: "ədəd", stock: 1, min_stock: 2, buy_price: 20, sell_price: 30 },
  { id: "p4", code: "P-4", name: "Köhnə", unit: "ədəd", stock: 7, min_stock: null, buy_price: 10, sell_price: 15 },
];

// ─── The tools' numbers ─────────────────────────────────────────────────────

test("previous period has the same length and ends the day before", () => {
  assert.deepEqual(previousPeriod("2026-10-22", "2026-11-20"), { from: "2026-09-22", to: "2026-10-21" });
  assert.deepEqual(previousPeriod("2026-11-01", "2026-11-01"), { from: "2026-10-31", to: "2026-10-31" });
});

test("sales_compare: posted only, against the previous 30 days, by customer", () => {
  const r = salesByPeriod({ sales: SALES, lines: LINES, from: "2026-10-22", to: TODAY, group: "customer" });
  assert.deepEqual([r.documents, r.revenue, r.previous_documents, r.previous_revenue, r.change_pct], [4, 670, 2, 250, 168]);
  assert.deepEqual(
    r.rows.map((x) => [x.label, x.revenue, x.previous_revenue, x.change_pct]),
    [
      ["Konik MMC", 500, 100, 400],
      ["Bakı Dekor", 170, 150, 13.3],
    ]
  );
  const byProduct = salesByPeriod({ sales: SALES, lines: LINES, from: "2026-10-22", to: TODAY, group: "product" });
  assert.deepEqual(byProduct.rows.map((x) => [x.label, x.revenue, x.quantity]), [["Panel", 440, 9], ["Lent", 180, 6], ["Vint", 50, 10]]);
  assert.equal(byProduct.caveats.length, 1);
});

test("gross_margin: FIFO cost where recorded, buy price where not (and says so)", () => {
  const r = grossMarginByProduct({ sales: SALES, lines: LINES, products: PRODUCTS, from: "2026-10-22", to: TODAY });
  assert.deepEqual([r.lines_counted, r.revenue, r.cost, r.margin, r.margin_pct], [8, 670, 424, 246, 36.7]);
  assert.deepEqual(r.rows.map((x) => [x.name, x.quantity, x.revenue, x.cost, x.margin, x.margin_pct]), [
    ["Panel", 9, 440, 264, 176, 40],
    ["Lent", 6, 180, 120, 60, 33.3],
    ["Vint", 10, 50, 40, 10, 20],
  ]);
  assert.match(r.caveats[0], /1 of 8 lines/);
  const weakest = grossMarginByProduct({ sales: SALES, lines: LINES, products: PRODUCTS, from: "2026-10-22", to: TODAY, order: "margin_pct_low" });
  assert.equal(weakest.rows[0].name, "Vint");
});

test("debtors_ageing: what is still owed, by age, overdue from the due date or after 30 days", () => {
  const r = debtorsAgeing({ sales: SALES, today: TODAY });
  assert.deepEqual([r.open_invoices, r.total, r.overdue], [3, 400, 300]);
  assert.deepEqual(r.buckets, { "0_30": 300, "31_60": 100, "61_90": 0, over_90: 0 });
  assert.deepEqual(r.rows.map((x) => [x.name, x.owed, x.overdue, x.oldest_doc, x.oldest_days]), [
    ["Konik MMC", 200, 200, "SS-s2", 5],
    ["Bakı Dekor", 200, 100, "SS-s4", 46],
  ]);
});

test("stock_cover: running out within 14 days or below minimum; slow movers with their value", () => {
  const r = stockCover({ sales: SALES, lines: LINES, products: PRODUCTS, today: TODAY });
  assert.deepEqual(r.running_out.map((x) => [x.name, x.stock, x.per_day, x.days_of_cover]), [
    ["Lent", 1, 0.1, 10],
    ["Vint", 4, 0.33, 12],
  ]);
  assert.deepEqual(r.slow_movers.map((x) => [x.name, x.stock_value, x.last_sold]), [["Köhnə", 70, null]]);
  assert.equal(r.slow_stock_value, 70);
});

test("dormant_customers: at least 3 orders and none in 60 days", () => {
  const r = dormantCustomers({ sales: SALES, today: TODAY });
  assert.deepEqual(r.rows, [{ customer_id: "c3", name: "Xəzər Mebel", orders: 3, revenue: 240, average_order: 80, last_order: "2026-09-01", days_since: 80 }]);
});

test("bought_together: pairs on 3 or more invoices, with how often each comes with the other", () => {
  const r = coPurchasePairs({ sales: SALES, lines: LINES, from: "2026-05-24", to: TODAY });
  assert.equal(r.invoices_counted, 6);
  assert.deepEqual(r.rows, [{ product_a: "Panel", product_b: "Lent", together: 3, share_of_a: 60, share_of_b: 100, invoices_with_a: 5, invoices_with_b: 3 }]);
});

test("price_changes: average price and margin now against the previous period, biggest moves first", () => {
  const r = priceChanges({ sales: SALES, lines: LINES, products: PRODUCTS, from: "2026-10-22", to: TODAY });
  assert.deepEqual(r.rows.map((x) => [x.name, x.price_before, x.price_now, x.price_change_pct, x.margin_pct_before, x.margin_pct_now]), [
    ["Vint", 15, 5, -66.7, 80, 20],
    ["Panel", 40, 48.89, 22.2, 25, 40],
  ]);
});

test("employee_overview: facts per person by name, recurring warnings, no score or ranking", () => {
  const at = (d) => `${d}T10:00:00Z`;
  const r = employeeOverview({
    from: "2026-11-14",
    to: TODAY,
    people: [{ id: "u2", name: "Bəhruz" }, { id: "u1", name: "Aysel" }],
    audit: [
      { user_id: "u1", action: "CREATE", table_name: "sales", created_at: at("2026-11-15") },
      { user_id: "u1", action: "CREATE", table_name: "sales", created_at: at("2026-11-16") },
      { user_id: "u1", action: "UPDATE", table_name: "sales", created_at: at("2026-11-16") },
      { user_id: "u1", action: "CREATE", table_name: "customers", created_at: at("2026-11-17") },
      { user_id: "u1", action: "CREATE", table_name: "sales", created_at: at("2026-11-01") },
      { user_id: "u2", action: "CREATE", table_name: "purchases", created_at: at("2026-11-18") },
      { user_id: "u2", action: "CREATE", table_name: "secret_table", created_at: at("2026-11-18") },
      { user_id: "u3", action: "CREATE", table_name: "sales", created_at: at("2026-11-18") },
    ],
    watch: [
      { user_id: "u1", code: "below_cost", action: "fixed", created_at: at("2026-11-15") },
      { user_id: "u1", code: "below_cost", action: "fixed", created_at: at("2026-11-16") },
      { user_id: "u1", code: "vat_unusual", action: "fixed", created_at: at("2026-11-16") },
      { user_id: "u1", code: "stock_short", action: "ignored", created_at: at("2026-11-16") },
    ],
  });
  assert.deepEqual(r.people, [
    { name: "Aysel", created: { "sales invoices": 2, "new customers": 1 }, documents_changed: 1, recurring_warnings: [{ code: "below_cost", times_fixed: 2 }], warnings_ignored: 1 },
    { name: "Bəhruz", created: { "purchase invoices": 1 }, documents_changed: 0, recurring_warnings: [], warnings_ignored: 0 },
  ]);
  assert.match(r.note, /Do not score, rank or compare people/);
  assert.doesNotMatch(JSON.stringify(r), /score"|rank"/);
});

// ─── Gates ──────────────────────────────────────────────────────────────────

test("insights: admins or financial reports, a tenant with sales; employee_overview only for admins", () => {
  const mods = new Set(["sales"]);
  assert.equal(canUseInsights({ isAdmin: true, can: () => false, enabledModules: mods }), true);
  assert.equal(canUseInsights({ isAdmin: false, can: (p) => p === "can_view_financial_reports", enabledModules: mods }), true);
  assert.equal(canUseInsights({ isAdmin: false, can: (p) => p === "can_view_sales", enabledModules: mods }), false);
  assert.equal(canUseInsights({ isAdmin: true, can: () => true, enabledModules: new Set(["inventory"]) }), false);
  assert.ok(insightToolsFor(true).some((t) => t.name === "employee_overview"));
  assert.ok(!insightToolsFor(false).some((t) => t.name === "employee_overview"));
  assert.deepEqual(skillById("insights").tools, INSIGHT_TOOLS.map((t) => t.name));
});

test("the skill is chosen for analysis questions only when the user may have it", () => {
  const ask = (question, canInsights, page = "/") => selectSkills({ page, recordType: null, question, isAdmin: false, canInsights });
  assert.ok(ask("Compare this month's sales with last month", true).includes("insights"));
  assert.ok(ask("Bu ayın satışını təhlil et", true).includes("insights"));
  assert.ok(ask("Сравни продажи", true).includes("insights"));
  assert.ok(!ask("Compare this month's sales with last month", false).includes("insights"));
  assert.ok(ask("hello", true, "/reports").includes("insights"));
  assert.ok(!ask("hello", true).includes("insights"), "the fallback does not add it");
  assert.match(skillById("insights").instructions, /never invent market facts/);
  assert.match(skillById("insights").instructions, /never score, rank or compare people/);
});

function fakeDb(tables, writes = []) {
  const builder = (table) => {
    const rows = tables[table] ?? [];
    const q = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      lte: () => q,
      in: () => q,
      gt: () => q,
      order: () => q,
      limit: () => q,
      range: (a, b) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: (row) => (writes.push({ table, op: "insert", row }), Promise.resolve({ error: null })),
      upsert: (row, opts) => (writes.push({ table, op: "upsert", row, opts }), Promise.resolve({ error: null })),
      then: (ok, bad) => Promise.resolve({ data: rows, error: null }).then(ok, bad),
    };
    return q;
  };
  return { from: builder, rpc: async () => ({ data: 0, error: null }) };
}

test("a tool runs with the user's client and refuses without the gate", async () => {
  const db = fakeDb({ sales: SALES });
  const ok = await runInsightTool(db, "dormant_customers", {}, { today: TODAY, isAdmin: false, allowed: true });
  assert.equal(ok.isError, false);
  assert.equal(JSON.parse(ok.content).rows[0].name, "Xəzər Mebel");
  assert.equal((await runInsightTool(db, "dormant_customers", {}, { today: TODAY, isAdmin: true, allowed: false })).content, "Permission denied for this user.");
  assert.equal((await runInsightTool(db, "employee_overview", {}, { today: TODAY, isAdmin: false, allowed: true })).isError, true);
  assert.equal((await runInsightTool(db, "drop_tables", {}, { today: TODAY, isAdmin: true, allowed: true })).isError, true);
  const ageing = await runInsightTool(db, "debtors_ageing", {}, { today: TODAY, isAdmin: false, allowed: true });
  assert.deepEqual(ageing.links.map((l) => l.href), ["/sales/s2", "/sales/s4"]);
});

test("the engine offers the insight tools only through the gate", () => {
  const engine = read("src/lib/assistant/engine.ts");
  assert.match(engine, /canInsights && skills\.includes\("insights"\) \? \(insightToolsFor\(input\.isAdmin\)/);
  assert.match(engine, /runInsightTool\(input\.db, name, args, \{ today, isAdmin: input\.isAdmin, allowed: canInsights \}\)/);
});

// ─── The morning briefing ───────────────────────────────────────────────────

const DATA = {
  sales: SALES,
  lines: LINES,
  products: PRODUCTS,
  accounts: [{ name: "Kassa", balance: 1000 }, { name: "Bank", balance: 2500 }],
  findings: [
    { severity: "high", first_seen_at: "2026-11-19T08:00:00Z" },
    { severity: "medium", first_seen_at: "2026-11-19T09:00:00Z" },
    { severity: "high", first_seen_at: "2026-11-10T08:00:00Z" },
  ],
};
const ALL = { isAdmin: true, sales: true, finance: true, customers: true, products: true };

test("briefing facts: yesterday, cash, overdue, stock, guard, and three suggestions with links", () => {
  const f = briefingFacts(DATA, ALL, TODAY);
  assert.deepEqual(f.sales, { revenue: 300, documents: 1, usual: null, change_pct: null });
  assert.deepEqual(f.cash, { total: 3500, accounts: [{ name: "Bank", balance: 2500 }, { name: "Kassa", balance: 1000 }] });
  assert.deepEqual(f.receivables, { overdue: 300, total: 400, customers_overdue: 2 });
  assert.deepEqual(f.stock, { running_out: 2, slow_value: 70 });
  assert.deepEqual(f.guard, { new_findings: 2, high: 1 });
  assert.deepEqual(f.suggestions.map((s) => [s.kind, s.href]), [
    ["guard", "/finance/guard?tab=findings"],
    ["call", "/sales/s2"],
    ["reorder", "/products?q=P-3"],
  ]);
  assert.match(f.suggestions[1].facts, /Konik MMC owes 200\.00 overdue/);
  assert.equal(f.all_well, false);
  assert.deepEqual(briefingLinks(f).map((l) => l.href), ["/finance/guard?tab=findings", "/sales/s2", "/products?q=P-3"]);
});

test("briefing facts follow the person's access; a quiet day is all well", () => {
  const f = briefingFacts(DATA, { isAdmin: false, sales: true, finance: false, customers: false, products: false }, TODAY);
  assert.equal(f.cash, undefined);
  assert.equal(f.receivables, undefined);
  assert.equal(f.stock, undefined);
  assert.equal(f.guard, undefined);
  assert.deepEqual(f.suggestions, []);
  assert.equal(f.all_well, true);
  // A weekday far below usual is a suggestion.
  const usual = [1, 2, 3, 4].map((w) => sale(`u${w}`, "c1", ["2026-11-12", "2026-11-05", "2026-10-29", "2026-10-22"][w - 1], 1000, 1000));
  const low = briefingFacts({ ...DATA, sales: [...SALES, ...usual] }, { isAdmin: false, sales: true, finance: false, customers: false, products: false }, TODAY);
  assert.deepEqual(low.sales, { revenue: 300, documents: 1, usual: 1000, change_pct: -70 });
  assert.equal(low.suggestions[0].kind, "sales");
});

test("recipients: active admins and people who may see financial reports", () => {
  const p = (id, role, perms = {}, active = true) => ({ id, is_active: active, full_name: id, role: { name: role, permissions: perms } });
  const list = briefingRecipients([p("a", "Admin"), p("m", "Manager", { can_view_financial_reports: true }), p("e", "Sales", { can_view_sales: true }), p("x", "Admin", {}, false)]);
  assert.deepEqual(list.map((x) => x.id), ["a", "m"]);
  assert.deepEqual(briefingAccess(p("m", "Manager", { can_view_financial_reports: true, can_view_sales: true })), { isAdmin: false, sales: true, finance: false, customers: false, products: false });
});

test("the composer writes one briefing per person and day with the fast model, and logs its cost", async () => {
  let asked = null;
  const client = { messages: { create: async (req) => ((asked = req), { content: [{ type: "text", text: "Sabahınız xeyir, Aysel.\n\nBu gün:\n1. [SS-s2](/sales/s2)" }], usage: { input_tokens: 900, output_tokens: 180 } }) } };
  const writes = [];
  const db = fakeDb({}, writes);
  const profile = { id: "a", is_active: true, full_name: "Aysel Məmmədova", locale: "az", role: { name: "Admin", permissions: {} } };
  const r = await writeBriefing({ db, client, model: "claude-haiku-4-5", profile, data: DATA, today: TODAY });
  assert.equal(r.status, "written");
  assert.equal(asked.model, "claude-haiku-4-5");
  assert.equal(asked.system, BRIEFING_SYSTEM_PROMPT);
  assert.match(asked.messages[0].content, /Language: Azerbaijani\.\nName: Aysel\./);
  const usage = writes.find((w) => w.table === "ai_usage_log").row;
  assert.deepEqual([usage.route_reason, usage.tier, usage.cost_usd], ["briefing", "fast", 0.0018]);
  const row = writes.find((w) => w.table === "assistant_briefings");
  assert.deepEqual(row.opts, { onConflict: "user_id,day", ignoreDuplicates: true });
  assert.deepEqual([row.row.day, row.row.language, row.row.all_well], [TODAY, "az", false]);
  assert.equal(cleanBriefingBody("   "), null);
});

test("the nightly job stops at the budget and skips people without access", async () => {
  const db = { ...fakeDb({ sales: SALES, products: PRODUCTS }), rpc: async () => ({ data: 50, error: null }) };
  const client = { messages: { create: async () => assert.fail("no call over budget") } };
  const profiles = [{ id: "a", is_active: true, full_name: "A", role: { name: "Admin", permissions: {} } }, { id: "e", is_active: true, full_name: "E", role: { name: "Sales", permissions: {} } }];
  const r = await nightlyBriefings({ apiKey: "k", db, env: { ASSISTANT_MONTHLY_BUDGET_USD: "50" }, today: TODAY, client, profiles });
  assert.deepEqual([r.recipients, r.written, r.budget], [1, 0, true]);
});

test("cost per day on the fixture: one briefing is about a fifth of a cent with Haiku", () => {
  const facts = briefingFacts(DATA, ALL, TODAY);
  const inputChars = BRIEFING_SYSTEM_PROMPT.length + briefingUserMessage(facts, "Aysel", "az").length;
  const inputTokens = Math.ceil(inputChars / 3.5);
  const outputTokens = 300;
  const perBriefing = estimateCostUsd("claude-haiku-4-5", { input_tokens: inputTokens, output_tokens: outputTokens, cache_read_tokens: 0, cache_write_tokens: 0 });
  assert.ok(inputTokens < 1200, `input ${inputTokens} tokens`);
  assert.ok(perBriefing < 0.003, `per briefing ${perBriefing}`);
  // Five managers a day, thirty days: well under a dollar a month.
  assert.ok(perBriefing * 5 * 30 < 0.5);
});

test("the briefing is the panel's first message of the day; routes and the workflow are gated", () => {
  const panel = read("src/components/assistant/AssistantPanel.tsx");
  assert.match(panel, /chat\.messages\.length === 0 && morning\.message \?/);
  const hook = read("src/components/assistant/useMorningBriefing.ts");
  assert.match(hook, /safeLinks\(b\.links\)/);
  assert.match(read("src/app/api/assistant/briefing/route.ts"), /assistantHistoryGate\(\)/);
  const nightly = read("src/app/api/assistant/briefing/nightly/route.ts");
  assert.match(nightly, /assistantCronAuthorized\(request\.headers\.get\("authorization"\)\)[\s\S]*isAssistantV2On\(\)/);
  const wf = read(".github/workflows/assistant-briefing.yml");
  assert.match(wf, /vars\.ASSISTANT_BRIEFING_ENABLED == 'true' && github\.ref_name == 'main'/);
  assert.doesNotMatch(wf, /sk-ant|ANTHROPIC_API_KEY:/);
});

// ─── The accountant in the chat ─────────────────────────────────────────────

test("the guard's Ask form gives way to the chat only when the assistant is on; saved reports stay", () => {
  const page = read("src/components/guard/GuardPage.tsx");
  assert.match(page, /\{inChat \? <GuardReviewInChat \/> : agent \? <GuardAskPanel \/> : null\}/);
  assert.match(page, /<GuardReportsTab \/>/);
  const inChat = read("src/components/guard/GuardReviewInChat.tsx");
  assert.match(inChat, /return useAssistantUi\(\)\.active;/);
  assert.match(inChat, /ui\.ask\(t\("assistant\.insights\.buildReviewQuestion"\)\)/);
  assert.match(inChat, /variant="secondary"/, "Scan now stays the one primary action");
});

// ─── Texts ──────────────────────────────────────────────────────────────────

test("insight texts exist in az / en / ru", () => {
  for (const k of ["briefingLabel", "guardInChat", "buildReview", "buildReviewQuestion"]) {
    assert.ok(azMessages.assistant.insights[k] && enMessages.assistant.insights[k], k);
    assert.match(ruMessages.assistant.insights[k], /[А-Яа-яЁё]/, k);
    assert.doesNotMatch(azMessages.assistant.insights[k], /[А-Яа-яЁё]/, k);
  }
});
