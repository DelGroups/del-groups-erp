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
  ACTIVITY_ICONS,
  activityState,
  activityTypeLabel,
  attachmentPath,
  canChangeActivity,
  canDeleteActivity,
  chatterEnabledFor,
  CHATTER_MODELS,
  checkActivity,
  checkActivityType,
  checkFiles,
  checkMessage,
  counts,
  daysUntil,
  DEFAULT_ACTIVITY_TYPES,
  dueIn,
  fileSize,
  initials,
  parseLog,
  recordHref,
  selectableTypes,
  sortActivities,
  TRACKED_FIELDS,
  trackedValue,
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

test("only one migration for chatter, RLS on every table, visibility follows the record", () => {
  assert.equal(readdirSync(join(root, "supabase/migrations")).filter((f) => f.startsWith("20261015100000")).length, 1);
  const sql = read(MIGRATION);
  for (const table of ["mail_messages", "activities", "activity_types", "mail_followers", "mail_attachments"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`), table);
  }
  // messages, activities, followers and attachments are read with the record.
  assert.equal((sql.match(/using \(public\.chatter_record_visible\(res_model, res_id\)\)/g) ?? []).length, 4);
  // Files: the bucket is private and its policies follow the record path.
  assert.match(sql, /values \('chatter-attachments', 'chatter-attachments', false, 10485760\)/);
  assert.equal((sql.match(/bucket_id = 'chatter-attachments' and public\.chatter_path_visible\(name\)/g) ?? []).length, 2);
  // Activity types are changed by admins only; chatter_follow is internal.
  assert.match(sql, /create policy activity_types_write on public\.activity_types\s+for all to authenticated\s+using \(public\.is_admin\(\)\)\s+with check \(public\.is_admin\(\)\)/);
  assert.match(sql, /revoke all on function public\.chatter_follow\(text, uuid, uuid\) from public, anon, authenticated;/);
  // Tracking never blocks the business write.
  assert.match(sql, /exception when others then\s+return null;/);
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
  assert.equal(parseLog("activity_done:site_visit:x").type, "site_visit");
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

test("activity types: labels, order, default due dates and the settings form's checks", () => {
  const t = (k) => `T(${k})`;
  const types = [...DEFAULT_ACTIVITY_TYPES, { code: "site_visit", name: "Site visit", icon: "meeting", default_days: 2, sequence: 15, active: true }, { code: "old", name: "Old", icon: "todo", default_days: 0, sequence: 5, active: false }];
  assert.equal(activityTypeLabel("call", types, t), "T(views.chatter.type.call)");
  assert.equal(activityTypeLabel("site_visit", types, t), "Site visit");
  assert.equal(activityTypeLabel("gone", types, t), "gone");
  assert.deepEqual(selectableTypes(types).map((x) => x.code), ["todo", "site_visit", "call", "meeting"]);
  assert.equal(dueIn(0, NOW), "2026-10-15");
  assert.equal(dueIn(20, NOW), "2026-11-04");
  assert.equal(dueIn(-3, NOW), "2026-10-15");
  // A custom type passes once it is among the allowed codes.
  assert.equal(checkActivity({ activity_type: "site_visit", summary: "x", due_date: "2026-10-20", assigned_to: null }).ok, false);
  assert.equal(checkActivity({ activity_type: "site_visit", summary: "x", due_date: "2026-10-20", assigned_to: null }, ["todo", "site_visit"]).ok, true);
  const codes = types.map((x) => x.code);
  assert.deepEqual(checkActivityType({ code: " Site_Check ", name: " Site check ", icon: "meeting", default_days: "2" }, codes), { ok: true, value: { code: "site_check", name: "Site check", icon: "meeting", default_days: 2 } });
  assert.equal(checkActivityType({ code: "site_visit", name: "x", icon: "todo", default_days: 0 }, codes).ok, false);
  assert.equal(checkActivityType({ code: "9lives", name: "x", icon: "todo", default_days: 0 }, codes).ok, false);
  assert.equal(checkActivityType({ code: "ok_code", name: " ", icon: "todo", default_days: 0 }, codes).ok, false);
  assert.equal(checkActivityType({ code: "ok_code", name: "x", icon: "rocket", default_days: 0 }, codes).ok, false);
  assert.equal(checkActivityType({ code: "ok_code", name: "x", icon: "todo", default_days: "1.5" }, codes).ok, false);
  assert.equal(checkActivityType({ code: "ok_code", name: "x", icon: "todo", default_days: 366 }, codes).ok, false);
  // Icons and built-in rows match the table's check and seed.
  const sql = read(MIGRATION);
  assert.match(sql, new RegExp(`icon in \\(${ACTIVITY_ICONS.map((i) => `'${i}'`).join(", ")}\\)`));
  for (const row of DEFAULT_ACTIVITY_TYPES) assert.match(sql, new RegExp(`\\('${row.code}', null, '${row.icon}', ${row.default_days}, ${row.sequence}\\)`), row.code);
});

test("tracking lines: parsed, shown, and the tracked fields match the migration", () => {
  assert.deepEqual(parseLog('tracking:[{"f":"stage","o":"NEW","n":"WON"},{"f":"expected_value","o":null,"n":1200}]'), {
    event: "tracking",
    changes: [
      { field: "stage", from: "NEW", to: "WON" },
      { field: "expected_value", from: null, to: 1200 },
    ],
  });
  assert.equal(parseLog("tracking:not json"), null);
  assert.equal(parseLog("tracking:[]"), null);
  assert.equal(parseLog('tracking:{"f":"x"}'), null);
  const users = [{ id: "u1", full_name: "Aysel" }];
  assert.equal(trackedValue("assigned_to", "u1", users), "Aysel");
  assert.equal(trackedValue("assigned_to", "u9", users), "—");
  assert.equal(trackedValue("stage", null, users), "—");
  assert.equal(trackedValue("grand_total", 1500.5, users), "1500.5");
  const sql = read(MIGRATION);
  for (const [table, fields] of Object.entries(TRACKED_FIELDS)) {
    assert.ok(sql.includes(`('${table}', array[${fields.map((f) => `'${f}'`).join(", ")}])`), table);
  }
});

test("attachments: safe storage paths under the record, limits and sizes", () => {
  const path = attachmentPath("deals", ID, "Plan (v2) ünvan.PDF", "abc");
  assert.equal(path, `deals/${ID}/abc-Plan-v2-unvan.pdf`);
  assert.equal(attachmentPath("sales", ID, ".env", "u"), `sales/${ID}/u-env`);
  assert.equal(attachmentPath("sales", ID, "../../etc/passwd", "u"), `sales/${ID}/u-passwd`);
  assert.equal(attachmentPath("sales", ID, "файл.png", "u"), `sales/${ID}/u-file.png`);
  assert.deepEqual(checkFiles([{ size: 10 }, { size: 10 * 1024 * 1024 }]), { ok: true });
  assert.equal(checkFiles([{ size: 0 }]).ok, false);
  assert.equal(checkFiles([{ size: 10 * 1024 * 1024 + 1 }]).ok, false);
  assert.equal(checkFiles(Array.from({ length: 6 }, () => ({ size: 1 }))).ok, false);
  assert.equal(fileSize(512), "512 B");
  assert.equal(fileSize(14 * 1024), "14 KB");
  assert.equal(fileSize(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(fileSize(null), "");
});

test("My activities links open the record's new-UI screen", () => {
  assert.equal(recordHref("deals", ID), `/crm/${ID}`);
  assert.equal(recordHref("sales", ID), `/sales/${ID}`);
  assert.equal(recordHref("purchases", ID), `/purchases?record=${ID}`);
  assert.equal(recordHref("customers", ID), `/customers?record=${ID}`);
  assert.equal(recordHref("payrolls", ID), null);
  assert.match(read("src/components/shell/NewShell.tsx"), /<MyActivitiesButton \/>/);
  // The customers page shows chatter and follows ?record= only with the new UI on.
  const customers = read("src/app/customers/page.client.tsx");
  assert.match(customers, /const withChatter = newUi && Boolean\(editingCustomerId\);/);
  assert.match(customers, /if \(!newUi \|\| openedFromLink\.current/);
  assert.match(read("src/views/chatter/RecordChatter.tsx"), /if \(!active \|\| !recordId/);
  // The activity types page is an admin settings tab shown only with the new UI.
  assert.match(read("src/components/settings/SettingsTabs.tsx"), /id: "activity-types",[\s\S]*?adminOnly: true,\s+newUiOnly: true,/);
});

test("every chatter text exists in az, en and ru", () => {
  const keys = new Set();
  for (const f of ["src/views/chatter/Chatter.tsx", "src/views/chatter/logic.ts", "src/components/shell/MyActivitiesButton.tsx", "src/app/settings/activity-types/page.client.tsx", "src/components/settings/SettingsTabs.tsx"]) {
    for (const m of read(f).matchAll(/["'`](views\.chatter\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) keys.add(m[1]);
  }
  for (const x of ["todo", "call", "meeting"]) keys.add(`views.chatter.type.${x}`);
  for (const x of ["overdue", "today", "planned", "done"]) keys.add(`views.chatter.state.${x}`);
  for (const x of ["overdue", "today", "planned"]) keys.add(`views.chatter.mine.${x}`);
  for (const x of ACTIVITY_ICONS) keys.add(`views.chatter.typesAdmin.icons.${x}`);
  for (const x of CHATTER_MODELS) keys.add(`views.chatter.models.${x}`);
  for (const fields of Object.values(TRACKED_FIELDS)) for (const x of fields) keys.add(`views.chatter.tracked.${x}`);
  const get = (messages, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), messages);
  assert.ok(keys.size > 35);
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string");
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
});
