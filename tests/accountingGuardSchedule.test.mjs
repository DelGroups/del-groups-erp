// GUARD-4: the automatic scan: the pure helpers of the "Automatic scan" card, the gates of its actions,
// the migration's promises (off by default, nothing on a posting path, only the guard's own history
// deleted, incremental checks really look at changes only) and the texts in az / en / ru. The database
// behaviour is checked by supabase/tests/accounting_guard_cron.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BAKU_UTC_OFFSET_HOURS,
  DEFAULT_SCHEDULE,
  INCREMENTAL_MINUTES,
  NIGHTLY_HOURS,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  bakuHour,
  hourText,
  scheduleChanged,
  scheduleFromJson,
  validateSchedule,
} from "../src/lib/guard/schedule.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20261120130000_accounting_guard_cron.sql";

test("the schedule answer is read with defaults for anything missing", () => {
  const s = scheduleFromJson({
    pg_cron_available: true,
    settings: { enabled: true, incremental_minutes: 15, nightly_hour_utc: 3, retention_days: 90 },
    jobs: [{ name: "guard-full", schedule: "0 3 * * *", active: true }, { schedule: "x" }],
    next_incremental: "2026-11-14T10:15:00Z",
    next_full: "2026-11-15T03:00:00Z",
    last_scheduled_run: { id: "r1", started_at: "2026-11-14T10:00:00Z", finished_at: null, status: "running", new_count: 2, open_count: 9, resolved_count: 1, since: "2026-11-14T09:55:00Z" },
  });
  assert.equal(s.pgCron, true);
  assert.deepEqual(s.settings, { enabled: true, incrementalMinutes: 15, nightlyHourUtc: 3, retentionDays: 90 });
  assert.deepEqual(s.jobs, [{ name: "guard-full", schedule: "0 3 * * *", active: true }]);
  assert.equal(s.nextFull, "2026-11-15T03:00:00Z");
  assert.equal(s.lastRun.since, "2026-11-14T09:55:00Z");
  assert.equal(s.lastRun.finishedAt, null);
  const empty = scheduleFromJson(null);
  assert.equal(empty.pgCron, false);
  assert.deepEqual(empty.settings, { ...DEFAULT_SCHEDULE });
  assert.deepEqual(empty.jobs, []);
  assert.equal(empty.lastRun, null);
  assert.equal(empty.nextIncremental, null);
  assert.deepEqual({ ...DEFAULT_SCHEDULE }, { enabled: false, incrementalMinutes: 30, nightlyHourUtc: 22, retentionDays: 365 });
});

test("hours: Baku is four hours after UTC, the nightly choices are the 24 hours of the day", () => {
  assert.equal(BAKU_UTC_OFFSET_HOURS, 4);
  assert.equal(bakuHour(22), 2, "22:00 UTC is 02:00 in Baku");
  assert.equal(bakuHour(0), 4);
  assert.equal(bakuHour(20), 0);
  assert.equal(bakuHour(23), 3);
  assert.equal(hourText(2), "02:00");
  assert.equal(hourText(22), "22:00");
  assert.equal(NIGHTLY_HOURS.length, 24);
  assert.deepEqual([...INCREMENTAL_MINUTES], [10, 15, 30, 60]);
});

test("the form is checked before it is sent: the first field out of range is named", () => {
  const ok = { enabled: true, incrementalMinutes: 30, nightlyHourUtc: 22, retentionDays: 365 };
  assert.deepEqual(validateSchedule(ok), { ok: true, value: ok });
  assert.deepEqual(validateSchedule({ ...ok, enabled: false }).value.enabled, false);
  assert.deepEqual(validateSchedule({ ...ok, incrementalMinutes: 7 }), { ok: false, field: "incrementalMinutes" });
  assert.deepEqual(validateSchedule({ ...ok, incrementalMinutes: NaN }), { ok: false, field: "incrementalMinutes" });
  assert.deepEqual(validateSchedule({ ...ok, nightlyHourUtc: 24 }), { ok: false, field: "nightlyHourUtc" });
  assert.deepEqual(validateSchedule({ ...ok, nightlyHourUtc: -1 }), { ok: false, field: "nightlyHourUtc" });
  assert.deepEqual(validateSchedule({ ...ok, nightlyHourUtc: 2.5 }), { ok: false, field: "nightlyHourUtc" });
  assert.deepEqual(validateSchedule({ ...ok, retentionDays: RETENTION_MIN_DAYS - 1 }), { ok: false, field: "retentionDays" });
  assert.deepEqual(validateSchedule({ ...ok, retentionDays: RETENTION_MAX_DAYS + 1 }), { ok: false, field: "retentionDays" });
  assert.deepEqual(validateSchedule({ ...ok, retentionDays: NaN }), { ok: false, field: "retentionDays" });
  assert.equal(validateSchedule({ ...ok, retentionDays: RETENTION_MIN_DAYS }).ok, true);
  assert.equal(validateSchedule({ ...ok, retentionDays: RETENTION_MAX_DAYS }).ok, true);
  assert.equal(scheduleChanged(ok, { ...ok }), false);
  assert.equal(scheduleChanged(ok, { ...ok, enabled: false }), true);
  assert.equal(scheduleChanged(ok, { ...ok, retentionDays: 366 }), true);
});

test("the schedule actions need an admin and the flag, and call only the schedule functions", () => {
  const src = read("src/lib/actions/accountingGuardSection.ts");
  for (const name of ["guardScheduleStateAction", "guardSetScheduleAction"]) {
    const body = src.slice(src.indexOf(`export async function ${name}`));
    const next = body.indexOf("\nexport ", 10);
    assert.match(next > 0 ? body.slice(0, next) : body, /requireGuardAdmin\(\)/, name);
  }
  assert.match(src, /\.rpc\("guard_schedule_state"\)/);
  assert.match(src, /\.rpc\("guard_set_schedule", \{/);
  // Checked before the database, with the same ranges.
  assert.match(src, /const checked = validateSchedule\(/);
  assert.match(src, /guard\.errors\.invalidSchedule/);
  assert.match(read("src/lib/guard/server.ts"), /invalid_schedule/);
  assert.doesNotMatch(src, /^export (const|let|var|class|function) /m);
});

test("the card is on the Rules tab, first, and never offers a way to run something other than the guard", () => {
  const rules = read("src/components/guard/GuardRulesTab.tsx");
  assert.match(rules, /import GuardScheduleCard from "\.\/GuardScheduleCard";/);
  assert.ok(rules.indexOf("<GuardScheduleCard />") > 0 && rules.indexOf("<GuardScheduleCard />") < rules.indexOf("GUARD_CATEGORIES.map"));
  const card = read("src/components/guard/GuardScheduleCard.tsx");
  assert.match(card, /guardScheduleStateAction/);
  assert.match(card, /guardSetScheduleAction/);
  assert.match(card, /state\.pgCron/, "it says what to do when pg_cron is not there");
  assert.doesNotMatch(card, /createSupabaseAdminClient|\.rpc\(/);
});

test("the migration: off by default, nothing on a posting path, only its own history deleted", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /"enabled": false/);
  assert.match(sql, /IF NOT \(v_cfg ->> 'enabled'\)::boolean THEN\s+RETURN NULL;/);
  assert.doesNotMatch(sql, /CREATE (OR REPLACE )?TRIGGER/i);
  assert.doesNotMatch(sql, /CREATE EXTENSION/i, "pg_cron is enabled by a person, never by the migration");
  const business = ["journal_entries", "journal_entry_lines", "sales", "sale_items", "purchases", "payments", "transactions", "accounts", "expenses", "partners", "products"];
  for (const t of business) assert.doesNotMatch(sql, new RegExp(`(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\\s+public\\.${t}\\b`, "i"), t);
  const writes = [...sql.matchAll(/(?:INSERT INTO|DELETE FROM|UPDATE)\s+public\.(\w+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)].sort(), ["audit_logs", "guard_findings", "guard_rules", "guard_runs", "system_settings"].sort());
  // Retention: closed (auto-resolved) findings and old scans only; open and false-positive findings stay.
  assert.match(sql, /DELETE FROM public\.guard_findings f\s+WHERE f\.status = 'auto_resolved'/);
  assert.match(sql, /DELETE FROM public\.guard_runs r\s+WHERE r\.started_at < NOW\(\) - make_interval\(days => v_days\) AND r\.id <> v_run/);
  // pg_cron optional: the jobs are created only when cron.job exists; the migration then says what to do.
  assert.match(sql, /IF to_regclass\('cron\.job'\) IS NULL THEN\s+RETURN FALSE;/);
  assert.match(sql, /RAISE NOTICE 'Accounting Guard: pg_cron is not enabled/);
  // The two jobs, idempotent: the old ones are removed first.
  assert.match(sql, /cron\.unschedule\(jobid\) FROM cron\.job WHERE jobname IN \('guard-incremental', 'guard-full'\)/);
  // Server-only functions are not callable by signed-in users.
  for (const fn of ["_guard_schedule_settings()", "guard_scheduled_run(TEXT)", "guard_apply_schedule()"]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.replace(/[()]/g, "\\$&")} FROM PUBLIC, anon, authenticated`), fn);
  }
  assert.match(sql, /PERFORM public\._guard_authorize\(\);/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/accounting_guard_cron\.sql/);
});

test("the checks marked for incremental scans really look at changes only", () => {
  const sql = read(MIGRATION);
  const marked = sql.match(/SET full_only = \(code = ANY \(ARRAY\[([^\]]*)\]\)\)/);
  assert.ok(marked);
  const fullOnly = new Set([...marked[1].matchAll(/'([A-Z]\d+)'/g)].map((m) => m[1]));
  const functions = read("supabase/migrations/20261120100000_accounting_guard_core.sql") + read("supabase/migrations/20261120110000_accounting_guard_products.sql");
  const codes = new Set();
  for (const m of functions.matchAll(/CREATE OR REPLACE FUNCTION public\.guard_check_(\w+)\(p_params JSONB, p_since TIMESTAMPTZ\)([\s\S]*?)\n\$\$;/g)) {
    const code = m[1].toUpperCase();
    codes.add(code);
    const uses = (m[2].match(/p_since/g) ?? []).length;
    // A check that is not full-only must use p_since in its WHERE; a full-only check may ignore it.
    if (!fullOnly.has(code)) assert.ok(uses >= 1, `${code} is incremental but ignores p_since`);
  }
  assert.equal(codes.size, 34);
  for (const code of fullOnly) assert.ok(codes.has(code), `${code} is not a check`);
  // The whole-ledger and whole-catalogue checks are among the full-only ones.
  for (const code of ["A8", "A9", "A10", "C1", "C2", "D1", "D2", "D3", "F1", "F2", "F3", "F4", "F5", "E1", "E2", "E4"]) assert.ok(fullOnly.has(code), code);
  for (const code of ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "E3", "E5"]) assert.ok(!fullOnly.has(code), code);
});

function leaves(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)));
}
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const lookup = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

test("the schedule texts exist in az, en and ru with the same placeholders", () => {
  const keys = [
    "scheduleTitle", "scheduleOn", "scheduleOff", "scheduleHelp", "noCronTitle", "noCronStep1", "noCronStep2", "noCronStep3", "scheduleEnabled",
    "scheduleEvery", "everyMinutes", "scheduleNightly", "scheduleNightlyHint", "hourOption", "scheduleRetention", "scheduleRetentionHint",
    "scheduleRetentionInvalid", "scheduleSaved", "scheduleSavedNoCron", "nextQuick", "nextNightly", "lastScheduled", "lastScheduledQuick",
    "lastScheduledFull", "noScheduledRun", "cronJobs", "noCronJobs",
  ];
  for (const key of keys) {
    const en = enMessages.guard.ui[key];
    assert.ok(en, `en ${key}`);
    assert.deepEqual(placeholders(azMessages.guard.ui[key] ?? ""), placeholders(en), `az ${key}`);
    assert.deepEqual(placeholders(ruMessages.guard.ui[key] ?? ""), placeholders(en), `ru ${key}`);
  }
  for (const m of [azMessages, enMessages, ruMessages]) assert.ok(m.guard.errors.invalidSchedule);
  assert.deepEqual(leaves(azMessages.guard), leaves(enMessages.guard));
  assert.deepEqual(leaves(ruMessages.guard), leaves(enMessages.guard));
  assert.match(enMessages.guard.ui.hourOption, /\{utc\}.*\{baku\}/);
  assert.equal(lookup(enMessages.guard, "ui.scheduleRetentionInvalid").includes("{min}"), true);
});
