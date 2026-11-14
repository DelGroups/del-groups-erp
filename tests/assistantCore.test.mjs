// AST-1: Del Assistant core. Switches, skill selection (page, record, words, admin-only accountant), tools
// filtered by permission, context validation and reload with the user's client, the router cap, the
// streaming loop with a stand-in Claude client, the SSE format, the budget, and the route's gates.
// The database part is checked by supabase/tests/assistant_core.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assistantAccess, assistantAudience, assistantBudgetUsd, assistantForcedTier, isAssistantV2On } from "../src/lib/assistant/config.ts";
import { MAX_SKILLS, SKILLS, selectSkills } from "../src/lib/assistant/skills.ts";
import { loadTurnContext, parseClientContext } from "../src/lib/assistant/context.ts";
import { assistantSystemPrompt, turnPreamble } from "../src/lib/assistant/prompt.ts";
import { encodeSse, parseSse } from "../src/lib/assistant/sse.ts";
import { routeAssistantTurn, runAssistantTurn, toolsForSkills } from "../src/lib/assistant/engine.ts";
import { runNativeAgent } from "../src/lib/ai/native/agent.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = "11111111-1111-4111-8111-111111111111";
const ON = { ASSISTANT_V2: "true", ANTHROPIC_API_KEY: "k" };

test("the assistant is off unless the flag and key are set; admins only by default", () => {
  assert.deepEqual(assistantAccess({ isAdmin: true }, {}), { enabled: false, reason: "disabled" });
  assert.deepEqual(assistantAccess({ isAdmin: false }, ON), { enabled: false, reason: "not_in_audience" });
  assert.deepEqual(assistantAccess({ isAdmin: true }, { ASSISTANT_V2: "true" }), { enabled: false, reason: "no_api_key" });
  assert.deepEqual(assistantAccess({ isAdmin: true }, ON), { enabled: true, apiKey: "k" });
  assert.deepEqual(assistantAccess({ isAdmin: false }, { ...ON, ASSISTANT_V2_AUDIENCE: "all" }), { enabled: true, apiKey: "k" });
  assert.equal(isAssistantV2On({ ASSISTANT_V2: "TRUE" }), true);
  assert.equal(assistantAudience({ ASSISTANT_V2_AUDIENCE: "everyone" }), "admins");
  assert.equal(assistantBudgetUsd({}), 30);
  assert.equal(assistantBudgetUsd({ ASSISTANT_MONTHLY_BUDGET_USD: "50" }), 50);
  assert.equal(assistantBudgetUsd({ ASSISTANT_MONTHLY_BUDGET_USD: "x" }), 30);
  assert.equal(assistantForcedTier({ ASSISTANT_FORCE_TIER: "fast" }), "fast");
  assert.equal(assistantForcedTier({ ASSISTANT_FORCE_TIER: "turbo" }), null);
});

test("skills come from the page, the record and the question's words, in a stable order", () => {
  assert.deepEqual(selectSkills({ page: "/sales/abc", question: "show it", isAdmin: false }), ["sales"]);
  assert.deepEqual(selectSkills({ page: "/products", question: "", isAdmin: false }), ["inventory"]);
  assert.deepEqual(selectSkills({ recordType: "customer", question: "", isAdmin: false }), ["customers"]);
  assert.deepEqual(selectSkills({ question: "Müştəri borcları və anbar qalığı", isAdmin: false }), ["customers", "inventory"]);
  assert.deepEqual(selectSkills({ question: "сколько товара на складе", isAdmin: false }), ["inventory"]);
  assert.deepEqual(selectSkills({ question: "موجودی انبار چقدر است", isAdmin: false }), ["inventory"]);
  // Nothing matched: every skill except the accountant (which is never a default).
  assert.deepEqual(selectSkills({ question: "hello", isAdmin: true }), ["sales", "customers", "inventory", "finance", "production"]);
  // The order never depends on the order of the words.
  assert.deepEqual(selectSkills({ question: "stock and invoices", isAdmin: false }), selectSkills({ question: "invoices and stock", isAdmin: false }));
  assert.ok(selectSkills({ question: "invoice customer stock cash production guard", isAdmin: true }).length <= MAX_SKILLS);
});

test("the accountant skill is for admins only", () => {
  assert.deepEqual(selectSkills({ page: "/finance/guard", question: "", isAdmin: true }), ["accountant"]);
  assert.ok(!selectSkills({ page: "/finance/guard", question: "guard findings", isAdmin: false }).includes("accountant"));
  assert.ok(!selectSkills({ recordType: "guard_finding", question: "", isAdmin: false }).includes("accountant"));
  const profile = { role: { name: "Admin", permissions: {} } };
  const adminTools = toolsForSkills(["accountant"], profile, new Set(), true).map((t) => t.name);
  assert.ok(adminTools.includes("list_findings"));
  assert.deepEqual(toolsForSkills(["accountant"], profile, new Set(), false), [], "never for a non-admin, even if asked for");
  assert.ok(!adminTools.includes("remember"), "the guard memory tool is not part of the assistant (memory comes in AST-3)");
});

test("tools are filtered by the user's permissions", () => {
  const seller = { role: { name: "Seller", permissions: { can_view_sales: true } } };
  const names = toolsForSkills(["sales", "customers", "inventory", "finance"], seller, new Set(["sales", "crm", "inventory", "finance", "ai"]), false).map((t) => t.name);
  assert.ok(names.includes("list_sales"));
  assert.ok(!names.includes("finance_summary"), "no finance permission, no finance tool");
  assert.ok(!names.includes("search_products"), "no product permission, no product tool");
});

test("the browser's context is validated; odd values are dropped", () => {
  assert.deepEqual(parseClientContext({ page: "/sales/x", recordType: "sale", recordId: ID }), { page: "/sales/x", recordType: "sale", recordId: ID });
  assert.deepEqual(parseClientContext({ page: "javascript:alert(1)", recordType: "sale", recordId: "1" }), { page: null, recordType: null, recordId: null });
  assert.deepEqual(parseClientContext({ page: "/x", recordType: "profiles", recordId: ID }), { page: "/x", recordType: null, recordId: null });
  assert.deepEqual(parseClientContext(null), { page: null, recordType: null, recordId: null });
});

function contextDb(row) {
  const calls = [];
  return {
    calls,
    from: (table) => ({
      select: (columns) => ({
        eq: (c, v) => ({
          maybeSingle: async () => {
            calls.push({ table, columns, c, v });
            return { data: row, error: null };
          },
        }),
      }),
    }),
  };
}

test("the record is reloaded with the user's client; one they cannot read gives no context", async () => {
  const db = contextDb({ id: ID, doc_no: "SS-1", customer_name: "Konik", doc_date: "2026-11-15", status: "posted", total_amount: 100, remaining_balance: 40, currency: "AZN" });
  const ctx = await loadTurnContext(db, { page: "/sales/x", recordType: "sale", recordId: ID });
  assert.equal(db.calls[0].table, "sales");
  assert.match(ctx.summary, /Sale SS-1 of Konik/);
  const none = await loadTurnContext(contextDb(null), { page: "/sales/x", recordType: "sale", recordId: ID });
  assert.deepEqual(none, { page: "/sales/x", recordType: null, recordId: null, summary: null });
});

test("the system prompt: rules, language, skills; the per-turn part stays out of it", () => {
  const p = assistantSystemPrompt({ productName: "Del ERP", company: "Del Groups", currency: "AZN", language: "ru", userName: "Aysel", role: "Admin", isAdmin: true, skills: ["sales"] });
  assert.match(p, /Del Groups/);
  assert.match(p, /Russian/);
  assert.match(p, /own permissions/);
  assert.match(p, /cannot create, change, post or delete/);
  assert.match(p, /- sales:/);
  assert.ok(!/Today is/.test(p), "the date is not in the cached prompt");
  assert.equal(turnPreamble({ page: "/sales", recordSummary: "Sale SS-1" }), "The user is on the page /sales. They are looking at: Sale SS-1.");
  assert.equal(turnPreamble({ page: null, recordSummary: null }), "");
});

test("the router: deep only for admins; a forced tier wins", () => {
  assert.equal(routeAssistantTurn("Why did sales drop? Analyse it.", { isAdmin: true, skills: [], forced: null }).tier, "deep");
  assert.deepEqual(routeAssistantTurn("Why did sales drop? Analyse it.", { isAdmin: false, skills: [], forced: null }), { tier: "standard", reason: "analysis_capped" });
  assert.equal(routeAssistantTurn("hi", { isAdmin: false, skills: [], forced: null }).tier, "fast");
  assert.deepEqual(routeAssistantTurn("hi", { isAdmin: false, skills: [], forced: "deep" }), { tier: "deep", reason: "forced" });
});

test("SSE events round-trip, split across chunks", () => {
  const a = encodeSse({ type: "text_delta", text: "Sa" });
  const b = encodeSse({ type: "done", reply: "Salam", status: "ok", links: [], conversationId: null, skills: ["sales"], tier: "fast" });
  const whole = a + b;
  const first = parseSse(whole.slice(0, 10));
  assert.deepEqual(first.events, []);
  const second = parseSse(first.rest + whole.slice(10));
  assert.deepEqual(second.events.map((e) => e.type), ["text_delta", "done"]);
  assert.equal(second.rest, "");
  assert.deepEqual(parseSse("data: {broken\n\n").events, []);
});

/** A stand-in Claude client with streaming: yields text deltas, then the final message. */
function streamingClaude(responses) {
  const sent = [];
  let i = 0;
  const next = () => responses[Math.min(i++, responses.length - 1)];
  return {
    sent,
    beta: {
      messages: {
        create: async (params) => {
          sent.push(params);
          return next();
        },
        stream: (params) => {
          sent.push(params);
          const msg = next();
          const events = msg.content.filter((b) => b.type === "text").flatMap((b) => [...b.text].map((ch) => ({ type: "content_block_delta", delta: { type: "text_delta", text: ch } })));
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of events) yield e;
            },
            finalMessage: async () => msg,
          };
        },
      },
    },
  };
}
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const text = (t) => ({ model: "claude-haiku-4-5", stop_reason: "end_turn", usage, content: [{ type: "text", text: t }] });
const toolCall = (name, input) => ({ model: "claude-haiku-4-5", stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "tu1", name, input }] });

test("the loop streams text deltas and tool steps when asked; without onEvent it is unchanged", async () => {
  const events = [];
  const claude = streamingClaude([toolCall("x_tool", { q: 1 }), text("Hi!")]);
  const result = await runNativeAgent({
    apiKey: "k",
    model: "claude-haiku-4-5",
    tier: "fast",
    system: "s",
    history: [],
    userMessage: "hello",
    today: "2026-11-15",
    ctx: { client: null, profile: null, enabledModules: new Set() },
    client: claude,
    toolset: { tools: [{ name: "x_tool", description: "d", input_schema: { type: "object" } }], run: async () => ({ content: "{}", isError: false, links: [{ label: "SS-1", href: "/sales/1" }] }) },
    onEvent: (e) => events.push(e),
  });
  assert.equal(result.reply, "Hi!");
  assert.deepEqual(events.map((e) => e.type), ["tool_start", "tool_end", "text_delta", "text_delta", "text_delta"]);
  assert.equal(events.filter((e) => e.type === "text_delta").map((e) => e.text).join(""), "Hi!");
  const plain = streamingClaude([text("ok")]);
  await runNativeAgent({ apiKey: "k", model: "m", tier: "fast", system: "s", history: [], userMessage: "u", today: "d", ctx: { client: null, profile: null, enabledModules: new Set() }, client: { beta: { messages: { create: plain.beta.messages.create } } }, toolset: { tools: [], run: async () => ({ content: "", isError: false, links: [] }) } });
  assert.equal(plain.sent.length, 1, "no onEvent: the non-streaming call");
});

const baseTurn = (over = {}) => ({
  apiKey: "k",
  db: contextDb(null),
  profile: { full_name: "Aysel", role: { name: "Seller", permissions: { can_view_sales: true } } },
  isAdmin: false,
  enabledModules: new Set(["sales", "crm", "inventory", "finance", "ai"]),
  language: "az",
  productName: "Del ERP",
  company: { name: "Del Groups", currency: "AZN" },
  userName: "Aysel",
  history: [],
  message: "Satışları göstər",
  clientContext: { page: "/sales", recordType: null, recordId: null },
  monthSpent: async () => 0,
  today: "2026-11-15",
  env: { ASSISTANT_V2: "true" },
  ...over,
});

test("a turn: only the chosen skills' permitted tools are offered; a tool outside them is refused", async () => {
  const claude = streamingClaude([toolCall("finance_summary", {}), text("Done")]);
  const events = [];
  const turn = await runAssistantTurn(baseTurn({ client: claude, onEvent: (e) => events.push(e) }));
  assert.equal(turn.ok, true);
  assert.deepEqual(turn.skills, ["sales"]);
  assert.deepEqual(claude.sent[0].tools.map((t) => t.name), ["list_sales", "get_sale"]);
  assert.match(claude.sent[0].system[0].text, /Aysel/);
  assert.match(claude.sent[0].messages[0].content[1].text, /The user is on the page \/sales/);
  const end = events.find((e) => e.type === "tool_end");
  assert.equal(end.ok, false, "finance_summary was not offered, so it is refused");
  assert.equal(turn.result.reply, "Done");
});

test("at the monthly budget no Claude call is made", async () => {
  const claude = streamingClaude([text("never")]);
  const turn = await runAssistantTurn(baseTurn({ client: claude, monthSpent: async () => 30 }));
  assert.equal(turn.ok, false);
  assert.equal(turn.reason, "budget");
  assert.equal(claude.sent.length, 0);
});

test("the route's gates, and nothing writes business data", () => {
  const route = read("src/app/api/assistant/chat/route.ts");
  assert.match(route, /requireAuthenticatedApi\(\)/);
  assert.match(route, /requireModuleApi\("ai"\)/);
  assert.match(route, /assistantAccess\(\{ isAdmin \}\)/);
  assert.match(route, /status: 404/);
  assert.match(route, /rateLimit\(/);
  assert.match(route, /checkUsage\("ai"\)/);
  assert.match(route, /text\/event-stream/);
  assert.match(route, /source: "assistant_v2"/);
  assert.ok(!/process\.env\.ANTHROPIC_API_KEY/.test(route), "the key is read only by config");
  const engine = read("src/lib/assistant/engine.ts") + read("src/lib/assistant/skills.ts") + read("src/lib/assistant/context.ts");
  assert.ok(!/\.(insert|update|delete|upsert)\(/.test(engine), "the engine only reads");
  const sql = read("supabase/migrations/20261121100000_assistant_core.sql");
  assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i.test(sql));
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.assistant_month_cost\(\) FROM PUBLIC, anon/);
  assert.equal(new Set(SKILLS.map((s) => s.id)).size, SKILLS.length);
});

test("the old assistant route is untouched", () => {
  const old = read("src/app/api/ai/agent/route.ts");
  assert.match(old, /nativeAssistantAccess/);
  assert.ok(!/assistant_v2/.test(old));
});
