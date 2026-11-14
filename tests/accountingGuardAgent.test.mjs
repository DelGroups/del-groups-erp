// GUARD-5: the accountant agent: switches, the secret of the scheduled job, the tools (read-only: no
// way to post, edit, reverse or delete), the report flow with a stand-in for Claude (saved as AI,
// budget, refusal, cut report), the routes' gates and the migration's promises. The database behaviour is
// checked by supabase/tests/accounting_guard_agent.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MONTHLY_BUDGET_USD,
  guardAgentAccess,
  guardCronAuthorized,
  guardMonthlyBudgetUsd,
  isGuardAgentFlagOn,
} from "../src/lib/guard/agentConfig.ts";
import { AGENT_ALLOWED_RPC, AGENT_READABLE_DOCS, GUARD_AGENT_TOOLS, runGuardAgentTool } from "../src/lib/guard/agentTools.ts";
import { BUSY_DAY_NEW_FINDINGS, nextTier, routeGuardTask, routerStats } from "../src/lib/guard/agentRouter.ts";
import { agentSystemPrompt, generateGuardReport, parseAgentReport } from "../src/lib/guard/agent.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const FID = "11111111-1111-4111-8111-111111111111";
const SECRET = "s".repeat(32);
/** A serious finding first seen a few hours before the tests' "now": the day is not quiet, so the standard model is used. */
const NEW_CRITICAL = { id: FID, rule_code: "B6", severity: "critical", status: "open", first_seen_at: "2026-11-14T10:00:00Z" };

test("the agent is off unless the guard, the AI flag and the key are all set", () => {
  assert.deepEqual(guardAgentAccess({}), { enabled: false, reason: "guard_disabled" });
  assert.deepEqual(guardAgentAccess({ ACCOUNTING_GUARD: "true" }), { enabled: false, reason: "ai_disabled" });
  assert.deepEqual(guardAgentAccess({ ACCOUNTING_GUARD: "true", ACCOUNTING_GUARD_AI: "true" }), { enabled: false, reason: "no_api_key" });
  assert.deepEqual(guardAgentAccess({ ACCOUNTING_GUARD_AI: "true", ANTHROPIC_API_KEY: "k" }), { enabled: false, reason: "guard_disabled" });
  assert.deepEqual(guardAgentAccess({ ACCOUNTING_GUARD: "true", ACCOUNTING_GUARD_AI: "true", ANTHROPIC_API_KEY: ' "k" ' }), { enabled: true, apiKey: "k" });
  assert.equal(isGuardAgentFlagOn({ ACCOUNTING_GUARD: "true", ACCOUNTING_GUARD_AI: "true" }), true);
  assert.equal(isGuardAgentFlagOn({ ACCOUNTING_GUARD_AI: "true" }), false);
});

test("the monthly budget defaults to 15 USD and ignores nonsense", () => {
  assert.equal(guardMonthlyBudgetUsd({}), DEFAULT_MONTHLY_BUDGET_USD);
  assert.equal(DEFAULT_MONTHLY_BUDGET_USD, 15);
  assert.equal(guardMonthlyBudgetUsd({ GUARD_AI_MONTHLY_BUDGET_USD: "40" }), 40);
  assert.equal(guardMonthlyBudgetUsd({ GUARD_AI_MONTHLY_BUDGET_USD: "-3" }), 15);
  assert.equal(guardMonthlyBudgetUsd({ GUARD_AI_MONTHLY_BUDGET_USD: "abc" }), 15);
});

test("the scheduled job needs the exact secret; no secret set refuses everyone", () => {
  const env = { GUARD_CRON_SECRET: SECRET };
  assert.equal(guardCronAuthorized(`Bearer ${SECRET}`, env), true);
  assert.equal(guardCronAuthorized(`bearer ${SECRET}`, env), true);
  assert.equal(guardCronAuthorized(`Bearer ${SECRET}x`, env), false);
  assert.equal(guardCronAuthorized(`Bearer ${"t".repeat(32)}`, env), false);
  assert.equal(guardCronAuthorized(SECRET, env), false);
  assert.equal(guardCronAuthorized(null, env), false);
  assert.equal(guardCronAuthorized("Bearer ", env), false);
  assert.equal(guardCronAuthorized("Bearer undefined", {}), false);
  assert.equal(guardCronAuthorized("Bearer ", {}), false);
  assert.equal(guardCronAuthorized("Bearer short", { GUARD_CRON_SECRET: "short" }), false, "a short secret is refused");
});

/** A database stand-in that records every call and answers from a table of canned results. */
function fakeDb(overrides = {}) {
  const calls = [];
  const answer = (key, fallback) => (key in overrides ? overrides[key] : key === "guard_findings.list" ? [NEW_CRITICAL] : fallback);
  const query = (table, args = []) => {
    const q = {
      calls: args,
      eq: (c, v) => query(table, [...args, ["eq", c, v]]),
      in: (c, v) => query(table, [...args, ["in", c, v]]),
      order: (c) => query(table, [...args, ["order", c]]),
      limit: (n) => query(table, [...args, ["limit", n]]),
      maybeSingle: () => {
        calls.push({ table, args, kind: "maybeSingle" });
        return Promise.resolve({ data: answer(`${table}.one`, { id: FID }), error: null });
      },
      then: (resolve, reject) => {
        calls.push({ table, args, kind: "list" });
        return Promise.resolve({ data: answer(`${table}.list`, []), error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return {
    calls,
    from: (table) => ({ select: (columns) => { calls.push({ table, columns, kind: "select" }); return query(table); } }),
    rpc: (fn, args) => {
      calls.push({ fn, args, kind: "rpc" });
      return Promise.resolve({ data: answer(`rpc.${fn}`, null), error: null });
    },
  };
}

test("the tools cannot write business data: no tool name, table or function allows it", () => {
  const names = GUARD_AGENT_TOOLS.map((t) => t.name);
  assert.deepEqual(names, ["list_findings", "get_finding", "get_document", "trial_balance", "partner_statement", "guard_rules", "list_memory", "remember", "suggest_false_positive"]);
  assert.ok(!names.some((n) => /post|create|update|delete|reverse|cancel|void|status|forget/.test(n)), "no tool posts, changes a status or forgets");
  assert.deepEqual([...AGENT_ALLOWED_RPC].sort(), ["get_gl_trial_balance", "get_partner_statement", "guard_memory_save", "guard_set_agent_suggestion"]);
  assert.deepEqual([...AGENT_READABLE_DOCS], ["sales", "purchases", "journal_entries"]);
  const source = read("src/lib/guard/agentTools.ts");
  assert.ok(!/\.(update|delete|upsert|insert)\(/.test(source), "the tools never write with the table API");
  assert.ok(!/guard_set_finding_status|guard_memory_delete|guard_scan\b/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "no status change, no memory delete, no scan");
  const rpcs = [...source.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(rpcs.length > 0 && rpcs.every((r) => AGENT_ALLOWED_RPC.includes(r)), `only allow-listed functions are called: ${rpcs}`);
});

test("an unknown tool, another table and bad ids are refused before the database is touched", async () => {
  const db = fakeDb();
  for (const [name, input] of [
    ["post_journal_entry", {}],
    ["get_document", { table: "profiles", id: FID }],
    ["get_document", { table: "sales; drop table sales", id: FID }],
    ["get_document", { table: "sales", id: "not-a-uuid" }],
    ["get_finding", { id: "x" }],
    ["trial_balance", { from: "2026-01-01", to: "tomorrow" }],
    ["partner_statement", { partner_id: FID, from: "01.01.2026", to: "2026-02-01" }],
    ["suggest_false_positive", { finding_id: "nope", reason: "fine" }],
  ]) {
    const r = await runGuardAgentTool(db, name, input);
    assert.equal(r.isError, true, `${name} ${JSON.stringify(input)} should be refused`);
  }
  assert.equal(db.calls.length, 0, "nothing reached the database");
});

test("reading tools query only what they should; the notes go through the guard's own functions", async () => {
  const db = fakeDb({ "guard_findings.list": [{ id: FID }] });
  const listed = await runGuardAgentTool(db, "list_findings", { status: "open", severity: "high", rule_code: "b6", limit: 999 });
  assert.equal(listed.isError, false);
  assert.deepEqual(JSON.parse(listed.content), [{ id: FID }]);
  const q = db.calls.find((c) => c.kind === "list");
  assert.deepEqual(q.args.filter((a) => a[0] === "eq"), [["eq", "status", "open"], ["eq", "severity", "high"], ["eq", "rule_code", "B6"]]);
  assert.deepEqual(q.args.find((a) => a[0] === "limit"), ["limit", 40], "capped at 40 rows");

  const remembered = await runGuardAgentTool(db, "remember", { subject: "Customer X", body: "Buys below cost by agreement.", kind: "bogus", finding_id: FID });
  assert.equal(remembered.isError, false);
  const save = db.calls.find((c) => c.fn === "guard_memory_save");
  assert.equal(save.args.p_kind, "fact", "an unknown kind becomes a fact");
  assert.equal(save.args.p_source, "agent");
  assert.equal(save.args.p_source_ref, FID);

  const suggested = await runGuardAgentTool(db, "suggest_false_positive", { finding_id: FID, reason: "Agreed discount" });
  assert.equal(suggested.isError, false);
  const sug = db.calls.find((c) => c.fn === "guard_set_agent_suggestion");
  assert.deepEqual(sug.args, { p_id: FID, p_suggestion: { status: "false_positive", reason: "Agreed discount" } });
  assert.ok(!db.calls.some((c) => c.fn === "guard_set_finding_status"), "the finding's status is never changed");
});

test("a database error comes back as a tool error, and very long answers are cut", async () => {
  const failing = { from: () => ({ select: () => { throw new Error("boom"); } }), rpc: () => Promise.resolve({ data: null, error: { message: "denied" } }) };
  assert.equal((await runGuardAgentTool(failing, "guard_rules", {})).isError, true);
  assert.deepEqual(await runGuardAgentTool(failing, "trial_balance", { from: "2026-01-01", to: "2026-01-31" }), { content: "denied", isError: true, links: [] });
  const big = fakeDb({ "guard_agent_memory.list": Array.from({ length: 5000 }, (_, i) => ({ subject: `note ${i}`, body: "x".repeat(50) })) });
  const r = await runGuardAgentTool(big, "list_memory", {});
  assert.ok(r.content.length < 25_000 && r.content.includes("cut"));
});

test("the report body and its closing json block are split; a bad block keeps the body", () => {
  const ok = parseAgentReport('## Review\n\nAll fine.\n\n```json\n{"headline":"One real error","risk":"high","suggestions":[{"text":"Reverse S-1","finding_id":"abc"},{"text":""},{"nope":1}]}\n```');
  assert.equal(ok.body, "## Review\n\nAll fine.");
  assert.deepEqual(ok.summary, { headline: "One real error", risk: "high", suggestions: [{ text: "Reverse S-1", finding_id: "abc" }] });
  const bad = parseAgentReport("Text only");
  assert.deepEqual(bad, { body: "Text only", summary: { headline: "", risk: "medium", suggestions: [] } });
  const broken = parseAgentReport("Body\n\n```json\n{not json}\n```");
  assert.equal(broken.body, "Body");
  assert.equal(broken.summary.risk, "medium");
  assert.equal(parseAgentReport('x\n```json\n{"risk":"weird","suggestions":"no"}\n```').summary.risk, "medium");
});

test("the system prompt: sceptical accountant, never posts, the language, the memory", () => {
  const prompt = agentSystemPrompt({ language: "ru", company: "Del Groups", currency: "AZN", memory: [{ subject: "Customer X", body: "Buys below cost." }] });
  assert.match(prompt, /Del Groups/);
  assert.match(prompt, /AZN/);
  assert.match(prompt, /18%/);
  assert.match(prompt, /NEVER post, edit, reverse or delete/);
  assert.match(prompt, /Russian/);
  assert.match(prompt, /- Customer X: Buys below cost\./);
  assert.match(agentSystemPrompt({ language: "az", company: "A", currency: "AZN", memory: [] }), /nothing remembered yet/);
});

/** A stand-in for the Claude client: answers in order and records what it was sent. */
function fakeClaude(responses) {
  const sent = [];
  let i = 0;
  return {
    sent,
    beta: {
      messages: {
        create: async (params) => {
          sent.push(params);
          return responses[Math.min(i++, responses.length - 1)];
        },
      },
    },
  };
}
const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const answerText = (text, stop = "end_turn") => ({ model: "claude-sonnet-5-5", stop_reason: stop, usage, content: [{ type: "text", text }] });
const toolUse = (name, input) => ({ model: "claude-sonnet-5-5", stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "tu_1", name, input }] });

function writeDb(failReport = false) {
  const rows = [];
  return {
    rows,
    from: (table) => ({
      insert: (row) => {
        rows.push({ table, row });
        const result = { data: null, error: null };
        const chain = {
          select: () => ({ single: () => Promise.resolve(table === "guard_reports" ? (failReport ? { data: null, error: { message: "nope" } } : { data: { id: "report-1" }, error: null }) : result) }),
          then: (resolve) => Promise.resolve(result).then(resolve),
        };
        return chain;
      },
    }),
  };
}

const baseInput = (over = {}) => ({
  kind: "daily",
  apiKey: "k",
  language: "en",
  company: { name: "Del Groups", currency: "AZN" },
  userId: null,
  now: new Date("2026-11-14T20:00:00Z"),
  env: {},
  ...over,
});

test("a daily report: the agent reads, remembers, and the report is saved as written by AI with its cost", async () => {
  const db = fakeDb({ "rpc.guard_ai_month_cost": 1.5, "rpc.guard_dashboard": { open: 3 } });
  const claude = fakeClaude([
    toolUse("remember", { subject: "Customer X", body: "Buys below cost by agreement." }),
    answerText('## Daily review\n\nThree open findings.\n\n```json\n{"headline":"3 open","risk":"low","suggestions":[{"text":"Check S-2","finding_id":null}]}\n```'),
  ]);
  const w = writeDb();
  const result = await generateGuardReport(baseInput({ db, writeDb: w, client: claude }));
  assert.equal(result.ok, true);
  assert.equal(result.reportId, "report-1");
  assert.equal(result.summary.headline, "3 open");
  const report = w.rows.find((r) => r.table === "guard_reports").row;
  assert.equal(report.kind, "daily");
  assert.equal(report.created_by_type, "ai");
  assert.equal(report.created_by, null, "scheduled reports are new to every admin (the bell counts them)");
  assert.equal(report.model, "claude-sonnet-5-5");
  assert.equal(report.body, "## Daily review\n\nThree open findings.");
  assert.equal(report.summary.risk, "low");
  assert.equal(report.summary.tool_calls, 1);
  assert.equal(report.tokens_in, 2000);
  assert.ok(report.cost_usd > 0);
  const usageRow = w.rows.find((r) => r.table === "guard_ai_usage").row;
  assert.equal(usageRow.kind, "daily");
  assert.equal(usageRow.report_id, "report-1");
  assert.equal(usageRow.tool_calls, 1);
  assert.ok(db.calls.some((c) => c.fn === "guard_memory_save"), "the note went through the guard's own function");
  const first = claude.sent[0];
  assert.deepEqual(first.tools.map((t) => t.name), GUARD_AGENT_TOOLS.map((t) => t.name), "only the guard's tools are offered");
  assert.match(first.system[0].text, /chief accountant/);
});

test("the monthly report uses the deep tier; the daily one the standard tier", async () => {
  const run = async (kind) => {
    const claude = fakeClaude([answerText("Body\n\n```json\n{\"headline\":\"h\",\"risk\":\"low\",\"suggestions\":[]}\n```")]);
    await generateGuardReport(baseInput({ kind, db: fakeDb({ "rpc.guard_ai_month_cost": 0 }), writeDb: writeDb(), client: claude }));
    return claude.sent[0].model;
  };
  assert.match(await run("monthly"), /opus/);
  assert.match(await run("daily"), /sonnet/);
});

test("at the monthly budget the agent stops before calling Claude and says so", async () => {
  const claude = fakeClaude([answerText("never")]);
  const w = writeDb();
  const result = await generateGuardReport(baseInput({ db: fakeDb({ "rpc.guard_ai_month_cost": 15 }), writeDb: w, client: claude, env: {} }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "budget");
  assert.equal(claude.sent.length, 0, "Claude was not called");
  assert.equal(w.rows.find((r) => r.table === "guard_ai_usage").row.status, "budget");
  assert.ok(!w.rows.some((r) => r.table === "guard_reports"));
  const own = await generateGuardReport(baseInput({ db: fakeDb({ "rpc.guard_ai_month_cost": 15 }), writeDb: writeDb(), client: fakeClaude([answerText("Body\n\n```json\n{}\n```")]), env: { GUARD_AI_MONTHLY_BUDGET_USD: "20" } }));
  assert.equal(own.ok, true, "a higher budget lets it run");
});

test("a refusal or an empty answer saves no report; a save failure is reported", async () => {
  const w = writeDb();
  const refused = await generateGuardReport(baseInput({ db: fakeDb(), writeDb: w, client: fakeClaude([answerText("", "refusal")]) }));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "refusal");
  assert.ok(!w.rows.some((r) => r.table === "guard_reports"));
  assert.equal(w.rows.find((r) => r.table === "guard_ai_usage").row.status, "refusal");

  const failed = await generateGuardReport(baseInput({ db: fakeDb(), writeDb: writeDb(true), client: fakeClaude([answerText("Body\n\n```json\n{}\n```")]) }));
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "failed");
});

test("an agent that never stops asking for tools is cut at the step limit and the report says so", async () => {
  const w = writeDb();
  const loop = fakeClaude([toolUse("guard_rules", {})]);
  const result = await generateGuardReport(baseInput({ db: fakeDb({ "rpc.guard_ai_month_cost": 0 }), writeDb: w, client: loop }));
  assert.equal(loop.sent.length, 10, "ten steps for a daily report");
  assert.equal(result.ok, false, "no text at all means no report");
});

test("a cut report is saved with a note", async () => {
  const w = writeDb();
  const claude = fakeClaude([answerText("Half a repor", "max_tokens")]);
  const result = await generateGuardReport(baseInput({ db: fakeDb(), writeDb: w, client: claude }));
  assert.equal(result.ok, true);
  assert.match(w.rows.find((r) => r.table === "guard_reports").row.body, /cut: max_tokens/);
});

test("a question from an admin goes into the on-demand report and is charged to them", async () => {
  const claude = fakeClaude([answerText("Answer\n\n```json\n{\"headline\":\"h\",\"risk\":\"low\",\"suggestions\":[]}\n```")]);
  const w = writeDb();
  await generateGuardReport(baseInput({ kind: "on_demand", question: "Why is B6 open for Customer X?", userId: "u-1", db: fakeDb(), writeDb: w, client: claude }));
  assert.match(claude.sent[0].messages.at(-1).content[1].text, /Why is B6 open for Customer X\?/);
  assert.equal(w.rows.find((r) => r.table === "guard_reports").row.kind, "on_demand");
  assert.equal(w.rows.find((r) => r.table === "guard_ai_usage").row.user_id, "u-1");
});

test("the routes: wrong secret is a 401 before anything is read; flags off is a 404; admins only for questions", () => {
  const cron = read("src/app/api/guard/agent/route.ts");
  assert.ok(cron.indexOf("guardCronAuthorized") < cron.indexOf("guardAgentAccess()"), "the secret is checked first");
  assert.match(cron, /status: 401/);
  assert.match(cron, /status: 404/);
  assert.match(cron, /mode must be daily or monthly/);
  const ask = read("src/app/api/guard/agent/ask/route.ts");
  assert.match(ask, /isAdminRole\(auth\.profile\?\.role\)/);
  assert.match(ask, /status: 403/);
  assert.match(ask, /guardAgentAccess\(\)/);
  assert.match(ask, /checkUsage\("ai"\)/);
  assert.match(ask, /rateLimit\(/);
  assert.ok(!/process\.env\.(ANTHROPIC_API_KEY|GUARD_CRON_SECRET)/.test(cron + ask), "secrets are read only by agentConfig");
});

test("the migration: only the guard's own rows, no trigger, nothing that posts; the workflow runs only when switched on", () => {
  const sql = read("supabase/migrations/20261120140000_accounting_guard_agent.sql");
  assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i.test(sql));
  assert.ok(!/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(journal|sales|purchases|invoices|products|accounts|partners|customers|suppliers)/i.test(sql));
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.guard_memory_save/);
  const flow = read(".github/workflows/accounting-guard.yml");
  assert.match(flow, /ACCOUNTING_GUARD_AI_ENABLED == 'true'/);
  assert.match(flow, /secrets\.GUARD_CRON_SECRET/);
  assert.match(flow, /github\.ref == 'refs\/heads\/main'|ref_name == 'main'/);
  assert.ok(!/secrets.ANTHROPIC/.test(flow), "the API key is never passed to the workflow");
});

const REPORT_JSON = (headline, risk) => "Body.\n\n```json\n" + JSON.stringify({ headline, risk, suggestions: [] }) + "\n```";

test("the router: light work goes to the cheap model, thinking work to the expensive ones", () => {
  const quiet = { kind: "daily", newFindings: 2, newSerious: 0, openFindings: 40 };
  assert.deepEqual(routeGuardTask(quiet), { tier: "fast", reason: "quiet_day" });
  assert.deepEqual(routeGuardTask({ ...quiet, openFindings: 0, newFindings: 0 }), { tier: "fast", reason: "nothing_open" });
  assert.deepEqual(routeGuardTask({ ...quiet, newSerious: 1 }), { tier: "standard", reason: "new_serious" });
  assert.deepEqual(routeGuardTask({ ...quiet, newFindings: BUSY_DAY_NEW_FINDINGS + 1 }), { tier: "standard", reason: "busy_day" });
  assert.equal(routeGuardTask({ ...quiet, newFindings: BUSY_DAY_NEW_FINDINGS }).tier, "fast");
  assert.deepEqual(routeGuardTask({ ...quiet, kind: "monthly" }), { tier: "deep", reason: "monthly" });
  assert.deepEqual(routeGuardTask({ ...quiet, kind: "on_demand" }), { tier: "standard", reason: "general_review" });
  assert.equal(routeGuardTask({ ...quiet, kind: "on_demand", question: "How many open findings?" }).tier, "fast");
  assert.equal(routeGuardTask({ ...quiet, kind: "on_demand", question: "Why is Customer X sold below cost? Analyse it." }).tier, "deep");
  assert.equal(routeGuardTask({ ...quiet, kind: "on_demand", question: "Compare B6 and B7 this month" }).tier, "deep");
  assert.deepEqual(routeGuardTask({ ...quiet, kind: "monthly", force: "fast" }), { tier: "fast", reason: "forced" });
  assert.equal(routeGuardTask({ ...quiet, force: "bogus" }).tier, "fast", "an unknown forced tier is ignored");
  assert.equal(nextTier("fast"), "standard");
  assert.equal(nextTier("standard"), "deep");
  assert.equal(nextTier("deep"), null);
});

test("the router counts only recent open findings as new", () => {
  const now = new Date("2026-11-14T20:00:00Z");
  const stats = routerStats(
    [
      { first_seen_at: "2026-11-14T10:00:00Z", severity: "critical" },
      { first_seen_at: "2026-11-13T12:00:00Z", severity: "low" },
      { first_seen_at: "2026-11-01T12:00:00Z", severity: "high" },
      { first_seen_at: "nonsense", severity: "high" },
      {},
    ],
    now,
  );
  assert.deepEqual(stats, { newFindings: 2, newSerious: 1, openFindings: 5 });
});

test("a quiet day uses Haiku and the report keeps the route; a new critical finding uses Sonnet", async () => {
  const claude = fakeClaude([answerText(REPORT_JSON("All quiet", "low"))]);
  const w = writeDb();
  const db = fakeDb({ "guard_findings.list": [{ id: FID, severity: "low", first_seen_at: "2026-11-01T00:00:00Z" }], "rpc.guard_ai_month_cost": 0 });
  const result = await generateGuardReport(baseInput({ db, writeDb: w, client: claude }));
  assert.equal(result.ok, true);
  assert.match(claude.sent[0].model, /haiku/);
  assert.equal(claude.sent.length, 1);
  assert.deepEqual(w.rows.find((r) => r.table === "guard_reports").row.summary.route, { tier: "fast", reason: "quiet_day" });
  assert.equal(w.rows.find((r) => r.table === "guard_ai_usage").row.tier, "fast");
  const claude2 = fakeClaude([answerText(REPORT_JSON("One critical", "high"))]);
  await generateGuardReport(baseInput({ db: fakeDb({ "rpc.guard_ai_month_cost": 0 }), writeDb: writeDb(), client: claude2 }));
  assert.match(claude2.sent[0].model, /sonnet/);
});

test("a light run that fails is repeated once with the standard model, and both runs are logged", async () => {
  const bad = answerText("no json block here");
  const good = answerText(REPORT_JSON("ok", "low"));
  const claude = fakeClaude([bad, good]);
  const w = writeDb();
  const db = fakeDb({ "guard_findings.list": [], "rpc.guard_ai_month_cost": 0 });
  const result = await generateGuardReport(baseInput({ db, writeDb: w, client: claude }));
  assert.equal(result.ok, true);
  assert.equal(claude.sent.length, 2);
  assert.match(claude.sent[0].model, /haiku/);
  assert.match(claude.sent[1].model, /sonnet/);
  const usageRows = w.rows.filter((r) => r.table === "guard_ai_usage").map((r) => r.row);
  assert.deepEqual(usageRows.map((r) => [r.tier, r.status]), [["fast", "escalated"], ["standard", "ok"]]);
  assert.deepEqual(w.rows.find((r) => r.table === "guard_reports").row.summary.route, { tier: "standard", reason: "nothing_open_escalated" });
  const forced = fakeClaude([bad, good]);
  await generateGuardReport(baseInput({ db: fakeDb({ "guard_findings.list": [], "rpc.guard_ai_month_cost": 0 }), writeDb: writeDb(), client: forced, env: { GUARD_AI_FORCE_TIER: "fast" } }));
  assert.equal(forced.sent.length, 1, "a forced tier is never escalated");
});
