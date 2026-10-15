// Activities and Chatter (phase 19): the client's table list matches the migration's, every
// listed table exists, the activity and message logic, the form wiring, the migration's RLS
// and the az/en/ru texts. The RLS behaviour itself is checked in supabase/tests/activities_chatter.sql.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activityState,
  canChangeActivity,
  canDeleteActivity,
  chatterEnabledFor,
  CHATTER_MODELS,
  checkActivity,
  checkMessage,
  counts,
  daysUntil,
  initials,
  parseLog,
  sortActivities,
} from "../src/views/chatter/logic.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const MIGRATION = "supabase/migrations/20261015100000_activities_chatter.sql";
const NOW = new Date(2026, 9, 15, 12);
const ID = "00000000-0000-0000-00c4-0000000000d1";

test("the client's chatter tables are exactly the migration's, and every one exists", () => {
  const sql = read(MIGRATION);
  const block = /select array\[([\s\S]*?)\]::text\[\]/.exec(sql)[1];
  const fromSql = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...CHATTER_MODELS].sort(), fromSql.sort());
  const schema = [read("supabase/baseline/03_tables.sql"), ...readdirSync(join(root, "supabase/modules"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => read(`supabase/modules/${d.name}/install.sql`))].join("\n");
  for (const table of CHATTER_MODELS) assert.match(schema, new RegExp(`create table if not exists public\\.${table} \\(\\s*id uuid not null`), table);
});

test("only one migration for chatter, RLS on both tables, visibility follows the record", () => {
  assert.equal(readdirSync(join(root, "supabase/migrations")).filter((f) => f.startsWith("20261015100000")).length, 1);
  const sql = read(MIGRATION);
  assert.match(sql, /alter table public\.mail_messages enable row level security;/);
  assert.match(sql, /alter table public\.activities enable row level security;/);
  assert.equal((sql.match(/using \(public\.chatter_record_visible\(res_model, res_id\)\)/g) ?? []).length, 2);
  assert.match(sql, /security invoker/);
  assert.match(sql, /kind in \('note', 'message'\) and public\.chatter_record_visible/);
  assert.doesNotMatch(sql, /grant [^;]* to anon/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261015100000_activities_chatter/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/activities_chatter\.sql/);
});

test("records carry chatter only for listed tables with a real row id", () => {
  assert.equal(chatterEnabledFor("deals", ID), true);
  assert.equal(chatterEnabledFor("sale_items", ID), false);
  assert.equal(chatterEnabledFor("consignment_dispatches", `dispatch-${ID}`), false);
  assert.equal(chatterEnabledFor("deals", "row-1"), false);
  assert.equal(chatterEnabledFor(null, ID), false);
  assert.equal(chatterEnabledFor("deals", null), false);
});

test("activity state by due date, days left, ordering and counts", () => {
  const a = (due_date, done_at = null) => ({ due_date, done_at });
  assert.equal(activityState(a("2026-10-14"), NOW), "overdue");
  assert.equal(activityState(a("2026-10-15"), NOW), "today");
  assert.equal(activityState(a("2026-10-20"), NOW), "planned");
  assert.equal(activityState(a("2026-10-01", "2026-10-02T10:00:00Z"), NOW), "done");
  assert.equal(daysUntil("2026-10-12", NOW), -3);
  assert.equal(daysUntil("2026-10-17", NOW), 2);
  const list = [a("2026-10-20"), a("2026-10-10", "2026-10-11T00:00:00Z"), a("2026-10-14"), a("2026-10-09", "2026-10-12T00:00:00Z"), a("2026-10-15")];
  assert.deepEqual(sortActivities(list).map((x) => x.due_date), ["2026-10-14", "2026-10-15", "2026-10-20", "2026-10-09", "2026-10-10"]);
  assert.deepEqual(counts(list, NOW), { overdue: 1, today: 1, planned: 1, done: 2 });
});

test("message and activity input checks mirror the table's limits", () => {
  assert.deepEqual(checkMessage("  hello  "), { ok: true, body: "hello" });
  assert.equal(checkMessage("   ").ok, false);
  assert.equal(checkMessage("x".repeat(10001)).ok, false);
  const ok = checkActivity({ activity_type: "call", summary: " Call back ", due_date: "2026-10-20", assigned_to: "", note: "  " });
  assert.deepEqual(ok, { ok: true, value: { activity_type: "call", summary: "Call back", due_date: "2026-10-20", assigned_to: null, note: null } });
  assert.equal(checkActivity({ activity_type: "lunch", summary: "x", due_date: "2026-10-20", assigned_to: null }).ok, false);
  assert.equal(checkActivity({ activity_type: "todo", summary: " ", due_date: "2026-10-20", assigned_to: null }).ok, false);
  assert.equal(checkActivity({ activity_type: "todo", summary: "x", due_date: "20/10/2026", assigned_to: null }).ok, false);
  assert.equal(checkActivity({ activity_type: "todo", summary: "x".repeat(201), due_date: "2026-10-20", assigned_to: null }).ok, false);
});

test("system log lines, initials and who may change an activity", () => {
  assert.deepEqual(parseLog("activity_done:call:Follow-up: price"), { event: "activity_done", type: "call", summary: "Follow-up: price" });
  assert.equal(parseLog("activity_done:odd:x").type, null);
  assert.equal(parseLog("hello"), null);
  assert.equal(initials("Aysel Məmmədova"), "AM");
  assert.equal(initials("leyla"), "L");
  assert.equal(initials(""), "?");
  const act = { created_by: "u1", assigned_to: "u2" };
  assert.equal(canChangeActivity(act, "u1", false), true);
  assert.equal(canChangeActivity(act, "u2", false), true);
  assert.equal(canChangeActivity(act, "u3", false), false);
  assert.equal(canChangeActivity(act, "u3", true), true);
  assert.equal(canDeleteActivity(act, "u2", false), false);
  assert.equal(canDeleteActivity(act, "u1", false), true);
  assert.equal(canChangeActivity(act, null, false), false);
});

test("every view-engine form shows the record's chatter; only new-UI screens render forms", () => {
  const form = read("src/views/components/FormView.tsx");
  assert.match(form, /const showChatter = withChatter && chatterEnabledFor\(table, record\.id\);/);
  assert.match(form, /<Chatter model=\{table as ChatterModel\} recordId=\{record\.id\} fmt=\{fmt\} \/>/);
  // The classic layout and classic pages never import the view engine.
  assert.doesNotMatch(read("src/components/layout/ERPLayout.tsx"), /@\/views/);
  for (const page of ["src/modules/sales/components/SalesPage.tsx", "src/modules/crm/components/CrmPipelinePage.tsx", "src/modules/purchases/components/PurchasesPage.tsx"]) {
    assert.doesNotMatch(read(page), /@\/views|Chatter/, page);
  }
});

test("every chatter text exists in az, en and ru", () => {
  const keys = new Set();
  for (const f of ["src/views/chatter/Chatter.tsx", "src/views/chatter/logic.ts"]) {
    for (const m of read(f).matchAll(/["'`](views\.chatter\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) keys.add(m[1]);
  }
  for (const x of ["todo", "call", "meeting"]) keys.add(`views.chatter.type.${x}`);
  for (const x of ["overdue", "today", "planned", "done"]) keys.add(`views.chatter.state.${x}`);
  const get = (messages, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), messages);
  assert.ok(keys.size > 35);
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string");
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
});
