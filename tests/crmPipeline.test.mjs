// New CRM pipeline (prompt 21): stages per team, codes, values and form checks, the reports
// (funnel, forecast, win rate, lost reasons, targets), quotation → invoice lines, the view
// definitions, the NEW_CRM switch, the shell items, the migration's guards and the az/en/ru
// texts. The database behaviour itself is checked in supabase/tests/crm_pipeline.sql.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addMonths,
  checkDeal,
  clampPriority,
  clampProbability,
  forecastByMonth,
  funnel,
  LOST_REASON_CODES,
  lostReasonLabel,
  lostReasons,
  outcomeStage,
  parseTags,
  quotationToInvoiceLines,
  stageCode,
  stagesForTeam,
  targetMonth,
  targetProgress,
  TEAM_CODES,
  teamLabel,
  weightedValue,
  winRateByUser,
} from "../src/modules/crm/lib/pipeline.ts";
import { leadsDefinition, opportunitiesDefinition, pipelineRecordFromRow } from "../src/modules/crm/views/pipeline.ts";
import { validateDefinition } from "../src/views/logic.ts";
import { isNewCrmEnabled } from "../src/lib/features/newCrm.ts";
import { extraItemsFor, SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const MIGRATION = "supabase/migrations/20261025100000_crm_pipeline.sql";
const t = (k, vars) => (vars ? `T(${k}:${JSON.stringify(vars)})` : `T(${k})`);

const TEAM_A = "team-a";
const TEAM_B = "team-b";
const stage = (id, sequence, over = {}) => ({ id, team_id: null, code: id.toUpperCase(), name: id, color: "#000000", sequence, probability: 10, is_won: false, is_lost: false, folded: false, ...over });
const STAGES = [
  stage("won", 90, { is_won: true, probability: 100 }),
  stage("lead", 10, { probability: 10 }),
  stage("qualified", 20, { probability: 40 }),
  stage("proposal", 30, { probability: 70 }),
  stage("lost", 95, { is_lost: true, probability: 0, folded: true }),
  stage("b_only", 25, { team_id: TEAM_B }),
  stage("b_won", 80, { team_id: TEAM_B, is_won: true, probability: 100 }),
];
const deal = (id, over = {}) => ({ id, title: id, type: "opportunity", team_id: TEAM_A, stage_id: "lead", expected_value: 1000, probability: 10, expected_close: null, assigned_to: "u1", lost_reason_id: null, won_at: null, lost_at: null, created_at: "2026-10-01T10:00:00Z", ...over });

test("stages: shared ones plus the team's own, by order; won/lost stage prefers the team's", () => {
  assert.deepEqual(stagesForTeam(STAGES, TEAM_A).map((s) => s.id), ["lead", "qualified", "proposal", "won", "lost"]);
  assert.deepEqual(stagesForTeam(STAGES, TEAM_B).map((s) => s.id), ["lead", "qualified", "b_only", "proposal", "b_won", "won", "lost"]);
  assert.deepEqual(stagesForTeam(STAGES, null).map((s) => s.id), ["lead", "qualified", "proposal", "won", "lost"]);
  assert.equal(outcomeStage(STAGES, TEAM_B, true)?.id, "b_won");
  assert.equal(outcomeStage(STAGES, TEAM_A, true)?.id, "won");
  assert.equal(outcomeStage(STAGES, TEAM_A, false)?.id, "lost");
});

test("stage codes: upper-case ASCII from the name, unique, never starting with a digit", () => {
  assert.equal(stageCode("Qiymət təklifi", []), "QIYMET_TEKLIFI");
  assert.equal(stageCode("Переговоры", []), "STAGE");
  assert.equal(stageCode("Lead", ["LEAD"]), "LEAD_2");
  assert.equal(stageCode("Lead", ["LEAD", "LEAD_2"]), "LEAD_3");
  assert.equal(stageCode("2nd call", []), "S_2ND_CALL");
  assert.match(stageCode("x".repeat(80), []), /^[A-Z][A-Z0-9_]{0,39}$/);
});

test("values: weighted revenue, clamps, tags and the form checks", () => {
  assert.equal(weightedValue({ expected_value: 1234.5, probability: 40 }), 493.8);
  assert.equal(clampProbability(140), 100);
  assert.equal(clampProbability(-3), 0);
  assert.equal(clampProbability("x"), 0);
  assert.equal(clampPriority(7), 3);
  assert.equal(clampPriority(1.6), 2);
  assert.deepEqual(parseTags(" vip,  Export ,vip, ,  long   tag "), ["vip", "Export", "long tag"]);
  assert.equal(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 20);
  assert.equal(checkDeal({ title: "  " }), "title");
  assert.equal(checkDeal({ title: "A", email: "not-an-email" }), "email");
  assert.equal(checkDeal({ title: "A", expectedValue: -1 }), "value");
  assert.equal(checkDeal({ title: "A", probability: 101 }), "probability");
  assert.equal(checkDeal({ title: "A", expectedClose: "31.10.2026" }), "date");
  assert.equal(checkDeal({ title: "A", email: "a@b.az", expectedValue: "", probability: 55, expectedClose: "2026-10-31" }), null);
});

test("funnel: a deal counts for every step up to its stage, won counts for all, lost is left out", () => {
  const deals = [deal("1"), deal("2", { stage_id: "qualified" }), deal("3", { stage_id: "proposal" }), deal("4", { stage_id: "won" }), deal("5", { stage_id: "lost" })];
  const steps = funnel(deals, stagesForTeam(STAGES, TEAM_A));
  assert.deepEqual(steps.map((s) => [s.stage.id, s.count]), [["lead", 4], ["qualified", 3], ["proposal", 2], ["won", 1]]);
  assert.equal(steps[0].rate, 100);
  assert.equal(steps[3].rate, 25);
  assert.equal(steps[0].value, 4000);
  assert.deepEqual(funnel([], STAGES).map((s) => s.count), [0, 0, 0, 0, 0]);
});

test("forecast: open opportunities by close month (overdue now, no date left out), won by month", () => {
  const now = new Date(2026, 9, 25);
  const rows = forecastByMonth(
    [
      deal("a", { expected_close: "2026-10-30", expected_value: 1000, probability: 50 }),
      deal("b", { expected_close: "2026-09-02", expected_value: 500, probability: 20 }),
      deal("c", { expected_close: "2026-12-15", expected_value: 2000, probability: 10 }),
      deal("d", { expected_close: null }),
      deal("e", { expected_close: "2026-11-01", type: "lead" }),
      deal("f", { stage_id: "won", won_at: "2026-10-05T09:00:00Z", expected_value: 700 }),
      deal("g", { stage_id: "lost", expected_close: "2026-10-20" }),
      deal("h", { expected_close: "2027-08-01" }),
    ],
    STAGES,
    now,
    3
  );
  assert.deepEqual(rows.map((r) => r.month), ["2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(rows[0], { month: "2026-10", expected: 1500, weighted: 600, count: 2, won: 700 });
  assert.deepEqual(rows[1], { month: "2026-11", expected: 0, weighted: 0, count: 0, won: 0 });
  assert.deepEqual(rows[2], { month: "2026-12", expected: 2000, weighted: 200, count: 1, won: 0 });
  assert.equal(addMonths("2026-12", 1), "2027-01");
});

test("win rate per salesperson and lost reasons", () => {
  const deals = [
    deal("1", { stage_id: "won", expected_value: 300 }),
    deal("2", { stage_id: "won", expected_value: 200 }),
    deal("3", { stage_id: "lost", lost_reason_id: "r1" }),
    deal("4", { stage_id: "lead" }),
    deal("5", { assigned_to: "u2", stage_id: "lost", lost_reason_id: "r1", expected_value: 50 }),
    deal("6", { assigned_to: null, stage_id: "lost" }),
    deal("7", { type: "lead", stage_id: "won" }),
  ];
  const rates = winRateByUser(deals, STAGES);
  assert.deepEqual(rates[0], { userId: "u1", won: 2, lost: 1, open: 1, wonValue: 500, rate: 66.7 });
  assert.equal(rates.find((r) => r.userId === "u2").rate, 0);
  assert.equal(rates.find((r) => r.userId === null).lost, 1);
  assert.deepEqual(lostReasons(deals, STAGES), [
    { reasonId: "r1", count: 2, value: 1050 },
    { reasonId: null, count: 1, value: 1000 },
  ]);
});

test("targets: team targets count the team's wins of the month, personal ones the person's", () => {
  const targets = [
    { id: "t1", team_id: TEAM_A, user_id: "u1", month: "2026-10-01", amount: 1000 },
    { id: "t2", team_id: TEAM_A, user_id: null, month: "2026-10-01", amount: 4000 },
    { id: "t3", team_id: TEAM_A, user_id: null, month: "2026-11-01", amount: 1 },
    { id: "t4", team_id: TEAM_B, user_id: null, month: "2026-10-01", amount: 0 },
  ];
  const deals = [
    deal("1", { stage_id: "won", won_at: "2026-10-03T00:00:00Z", expected_value: 600 }),
    deal("2", { stage_id: "won", won_at: "2026-10-09T00:00:00Z", expected_value: 900, assigned_to: "u2" }),
    deal("3", { stage_id: "won", won_at: "2026-09-30T00:00:00Z", expected_value: 5000 }),
    deal("4", { stage_id: "lead", expected_value: 9999 }),
  ];
  const rows = targetProgress(targets, deals, STAGES, "2026-10");
  assert.deepEqual(rows.map((r) => [r.target.id, r.won, r.rate]), [["t2", 1500, 37.5], ["t4", 0, null], ["t1", 600, 60]]);
  assert.equal(targetMonth("2026-10"), "2026-10-01");
  assert.equal(targetMonth("2026-10-17"), "2026-10-01");
  assert.equal(targetMonth("2026-13"), null);
  assert.equal(targetMonth("oct"), null);
});

test("quotation → invoice lines: catalogue products only, discount and tax keep the totals", () => {
  const items = [
    { product_id: "p1", product_code: "A", product_name: "Panel", unit: "m2", quantity: 10, cost_price: 5, margin_percent: 20, unit_price: 6, line_total: 60 },
    { product_id: "p2", product_code: "B", product_name: "Edge", unit: "m", quantity: 4, cost_price: 8, margin_percent: 25, unit_price: 10, line_total: 40 },
  ];
  const { lines, missing } = quotationToInvoiceLines({ items, discount: 10, tax: 16.2 });
  assert.deepEqual(missing, []);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].discount_percent, 10);
  assert.equal(lines[0].vat_rate, 18);
  const net = lines.reduce((s, l) => s + l.total, 0);
  assert.equal(net, 90);
  assert.ok(Math.abs(net * 0.18 - 16.2) < 0.001);
  const hand = quotationToInvoiceLines({ items: [...items, { ...items[0], product_id: null, product_name: "Installation" }], discount: 0, tax: 0 });
  assert.deepEqual(hand.missing, ["Installation"]);
  assert.deepEqual(quotationToInvoiceLines({ items: [], discount: 50, tax: 0 }), { lines: [], missing: [] });
});

test("records and view definitions: valid, stages from the settings, priority and tags as the form edits them", () => {
  const ctx = {
    teams: [{ id: TEAM_A, code: "default", name: null, leader_id: null, sequence: 10, active: true, member_ids: [] }],
    stages: STAGES,
    lostReasons: [{ id: "r1", code: "competitor", name: null, sequence: 10, active: true }],
    customers: [{ id: "c1", full_name: "Nərgiz", company_name: "Mebel MMC" }],
    salespeople: [{ id: "u1", full_name: "Səbinə" }],
    t,
    fetchAll: async () => [],
    fetchOne: async () => null,
  };
  for (const def of [opportunitiesDefinition(ctx), leadsDefinition(ctx)]) assert.deepEqual(validateDefinition(def), [], def.model.key);
  const opp = opportunitiesDefinition(ctx);
  assert.equal(opp.kanban.groupBy, "stage_id");
  assert.deepEqual(opp.kanban.folded, ["lost"]);
  assert.deepEqual(opp.fields.find((f) => f.name === "stage_id").options.map((o) => o.value), ["lead", "qualified", "b_only", "proposal", "b_won", "won", "lost"]);
  const rec = pipelineRecordFromRow(
    { id: "d1", title: "Kitchen", type: "opportunity", stage_id: "won", stage: "WON", expected_value: "2000", probability: "100", priority: 9, tags: ["vip", "export"], customers: { full_name: "Nərgiz" }, profiles: [{ full_name: "Səbinə" }], quotations: [{ quote_number: "Q-1", created_at: "2026-10-01" }, { quote_number: "Q-2", created_at: "2026-10-05" }] },
    STAGES
  );
  assert.equal(rec.outcome, "won");
  assert.equal(rec.priority, "3");
  assert.equal(rec.tags, "vip, export");
  assert.equal(rec.weighted_value, 2000);
  assert.equal(rec.customer_name, "Nərgiz");
  assert.equal(rec.salesperson, "Səbinə");
  assert.equal(rec.last_quote, "Q-2");
  assert.equal(pipelineRecordFromRow({ id: "x", type: "weird" }).type, "opportunity");
  assert.equal(teamLabel(ctx.teams[0], t), "T(crm.pipeline.teamCodes.default)");
  assert.equal(teamLabel({ code: "default", name: "Export" }, t), "Export");
  assert.equal(lostReasonLabel(null, t), "T(crm.pipeline.noReason)");
});

test("NEW_CRM is off unless set to true; its shell items show only when it is on", () => {
  assert.equal(isNewCrmEnabled({}), false);
  assert.equal(isNewCrmEnabled({ NEW_CRM: "false" }), false);
  assert.equal(isNewCrmEnabled({ NEW_CRM: " TRUE " }), true);
  const paths = (on) => extraItemsFor(SHELL_EXTRA_ITEMS, { newCrm: on }).map((e) => e.path);
  for (const p of ["/crm/leads", "/crm/reports", "/crm/config"]) {
    assert.ok(!paths(false).includes(p), p);
    assert.ok(paths(true).includes(p), p);
  }
  assert.ok(paths(false).includes("/calendar"));
  // The classic CRM routes are unchanged while the flag is off.
  assert.match(read("src/app/crm/page.tsx"), /if \(!isNewUiEnabled\(\)\) return <CrmPipelinePage \/>;/);
  for (const page of ["leads", "reports", "config"]) {
    assert.match(read(`src/app/crm/${page}/page.tsx`), /if \(!isNewUiEnabled\(\) \|\| !isNewCrmEnabled\(\)\) notFound\(\);/, page);
  }
});

test("every server action of the pipeline refuses while NEW_CRM is off and checks the user's right", () => {
  const src = read("src/modules/crm/actions/pipeline.ts");
  const bodies = src.split(/\nexport async function /).slice(1);
  assert.ok(bodies.length >= 15);
  for (const body of bodies) {
    const name = body.slice(0, body.indexOf("("));
    assert.ok(/await (crmWriter|settingsWriter)\(\)/.test(body) || /return updatePipelineDealAction\(/.test(body), name);
  }
  assert.match(src, /function requireFlag\(\) \{\s*if \(!isNewCrmEnabled\(\)\)/);
  assert.match(src, /crmWriter[\s\S]*requireFlag\(\);\s*return requirePermissionAction\("can_manage_crm"/);
  assert.match(src, /settingsWriter[\s\S]*requireFlag\(\);\s*return requirePermissionAction\("can_manage_settings"/);
});

test("migration: seeds the built-in codes, guards the CRM tables, keeps stage in sync, has a rollback", () => {
  const sql = read(MIGRATION);
  for (const code of TEAM_CODES) assert.match(sql, new RegExp(`values \\('${code}', 10\\)`));
  for (const code of LOST_REASON_CODES) assert.match(sql, new RegExp(`\\('${code}', \\d+\\)`), code);
  for (const table of ["deals", "quotations", "sales"]) assert.ok(sql.includes(`to_regclass('public.${table}')`), table);
  assert.match(sql, /new\.stage := v_stage\.code;/);
  assert.match(sql, /crm_stage_for_code\(new\.stage, new\.team_id\)/);
  for (const table of ["crm_teams", "crm_team_members", "crm_stages", "crm_lost_reasons", "crm_targets"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`), table);
  }
  const rollback = read("supabase/scripts/crm_pipeline_rollback.sql");
  for (const name of ["crm_targets", "crm_team_members", "crm_stages", "crm_lost_reasons", "crm_teams", "crm_deals_sync", "crm_stage_for_code"]) assert.ok(rollback.includes(name), name);
  for (const col of ["type", "team_id", "stage_id", "probability", "lost_reason_id", "sequence"]) assert.match(rollback, new RegExp(`drop column if exists ${col}\\b`), col);
  // One migration file for this change, with a unique timestamp.
  const files = readdirSync(join(root, "supabase/migrations"));
  assert.equal(files.filter((f) => f.startsWith("20261025100000")).length, 1);
  // The SQL checks run in CI.
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/crm_pipeline\.sql/);
});

test("texts: every key the new CRM uses exists in az, en and ru", () => {
  const dir = "src/modules/crm/components/pipeline";
  const sources = [...readdirSync(join(root, dir)).map((f) => read(`${dir}/${f}`)), read("src/modules/crm/views/pipeline.ts"), read("src/modules/crm/lib/pipeline.ts"), read("src/modules/crm/actions/pipeline.ts")].join("\n");
  // Literal keys; templates such as `crm.pipeline.errors.${x}` are covered by the lists below.
  const keys = new Set([...sources.matchAll(/["'`](crm\.pipeline\.[a-zA-Z0-9_.]+)["'`]/g)].map((m) => m[1]).filter((k) => !k.endsWith(".")));
  for (const code of TEAM_CODES) keys.add(`crm.pipeline.teamCodes.${code}`);
  for (const code of LOST_REASON_CODES) keys.add(`crm.pipeline.lostReasonCodes.${code}`);
  for (const n of ["0", "1", "2", "3"]) keys.add(`crm.pipeline.priority.${n}`);
  for (const k of ["open", "won", "lost"]) keys.add(`crm.pipeline.config.kind.${k}`);
  for (const e of ["title", "email", "value", "probability", "date"]) keys.add(`crm.pipeline.errors.${e}`);
  for (const e of ["noCustomer", "noLines"]) keys.add(`crm.pipeline.invoice.${e}`);
  for (const k of ["newShell.extra_crmLeads", "newShell.extra_crmReports", "newShell.extra_crmConfig"]) keys.add(k);
  assert.ok(keys.size > 150, `only ${keys.size} keys found`);
  const get = (obj, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string" || !get(messages, k).trim());
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
  // Placeholders are the same in every language.
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) {
    assert.equal(vars(get(azMessages, k)), vars(get(enMessages, k)), k);
    assert.equal(vars(get(ruMessages, k)), vars(get(enMessages, k)), k);
  }
});
