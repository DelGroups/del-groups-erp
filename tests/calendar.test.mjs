// Calendar (phase 20): recurrence parsing and expansion, calendar records (my / team, busy
// blocks), due reminders, the event form's checks, ICS export, the module's registration and
// the migration's access rules, and the az/en/ru texts. The RLS behaviour itself is checked in
// supabase/tests/calendar.sql.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandOccurrences, formatRule, MAX_OCCURRENCES, parseRule } from "../src/modules/calendar/lib/recurrence.ts";
import { buildIcs, checkEvent, deliveryKey, dueReminders, eventToInput, icsFold, icsText, isMine, REMINDER_CHOICES, toCalendarRecords, userColor, USER_COLORS } from "../src/modules/calendar/lib/calendar.ts";
import { MODULES } from "../src/modules/registry.ts";
import { MODULE_IDS } from "../src/modules/types.ts";
import { SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const MIGRATION = "supabase/migrations/20261024100000_calendar.sql";
const L = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi);
const starts = (list) => list.map((o) => o.start.getTime());

// ── Recurrence ───────────────────────────────────────────────────────────────

test("rules: the supported subset parses and formats back; everything else is refused", () => {
  assert.deepEqual(parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR,MO;COUNT=10"), { freq: "WEEKLY", interval: 2, byDay: ["MO", "FR"], count: 10 });
  assert.equal(formatRule(parseRule("freq=weekly;byday=fr,mo;interval=2;count=10")), "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=10");
  assert.equal(parseRule("FREQ=DAILY;UNTIL=20261031").until.toISOString(), "2026-10-31T23:59:59.000Z");
  assert.equal(formatRule(parseRule("FREQ=DAILY;UNTIL=20261031T080000Z")), "FREQ=DAILY;UNTIL=20261031T080000Z");
  for (const bad of ["", "FREQ=HOURLY", "FREQ=DAILY;BYDAY=MO", "FREQ=WEEKLY;BYDAY=XX", "FREQ=WEEKLY;BYDAY=MO,MO", "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;COUNT=1000", "FREQ=DAILY;FREQ=WEEKLY", "FREQ=DAILY;BYMONTH=2", "FREQ=DAILY;UNTIL=2026-10-31", "INTERVAL=2"]) {
    assert.equal(parseRule(bad), null, bad);
  }
  // The table accepts exactly what the client produces (constraint in the migration).
  const sql = read(MIGRATION);
  assert.match(sql, /recurrence ~ '\^FREQ=\(DAILY\|WEEKLY\|MONTHLY\|YEARLY\)/);
});

test("expansion: a single event appears only when it overlaps the period", () => {
  const ev = { start: L(2026, 10, 20, 10), end: L(2026, 10, 20, 11) };
  assert.equal(expandOccurrences(ev, L(2026, 10, 1), L(2026, 11, 1)).length, 1);
  assert.equal(expandOccurrences(ev, L(2026, 10, 20, 11), L(2026, 11, 1)).length, 0);
  assert.equal(expandOccurrences(ev, L(2026, 10, 20, 10, 30), L(2026, 11, 1)).length, 1);
});

test("expansion: daily with interval and COUNT counts from the first occurrence", () => {
  const ev = { start: L(2026, 10, 1, 9), end: L(2026, 10, 1, 9, 30), recurrence: "FREQ=DAILY;INTERVAL=2;COUNT=5" };
  assert.deepEqual(starts(expandOccurrences(ev, L(2026, 9, 1), L(2026, 12, 1))), starts([L(2026, 10, 1, 9), L(2026, 10, 3, 9), L(2026, 10, 5, 9), L(2026, 10, 7, 9), L(2026, 10, 9, 9)].map((start) => ({ start }))));
  // A period after the first two still ends at the fifth.
  const later = expandOccurrences(ev, L(2026, 10, 4), L(2026, 12, 1));
  assert.deepEqual(later.map((o) => o.index), [2, 3, 4]);
  assert.equal(later[0].end.getTime() - later[0].start.getTime(), 30 * 60_000);
});

test("expansion: weekly on weekdays skips the days before the start and stops at UNTIL", () => {
  // Wednesday 7 Oct 2026, Mon/Wed/Fri until Friday 16 Oct.
  const ev = { start: L(2026, 10, 7, 10), end: L(2026, 10, 7, 11), recurrence: "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261016T235959Z" };
  const got = expandOccurrences(ev, L(2026, 10, 1), L(2026, 11, 1)).map((o) => o.start.getDate());
  assert.deepEqual(got, [7, 9, 12, 14, 16]);
  // Every second week, no BYDAY: the start's weekday.
  const biweekly = { start: L(2026, 10, 7, 10), end: L(2026, 10, 7, 11), recurrence: "FREQ=WEEKLY;INTERVAL=2;COUNT=3" };
  assert.deepEqual(expandOccurrences(biweekly, L(2026, 10, 1), L(2027, 1, 1)).map((o) => [o.start.getMonth() + 1, o.start.getDate()]), [[10, 7], [10, 21], [11, 4]]);
});

test("expansion: monthly on the 31st and yearly on 29 February skip the short months", () => {
  const monthly = { start: L(2026, 1, 31, 12), end: L(2026, 1, 31, 13), recurrence: "FREQ=MONTHLY;COUNT=4" };
  assert.deepEqual(expandOccurrences(monthly, L(2026, 1, 1), L(2027, 1, 1)).map((o) => o.start.getMonth() + 1), [1, 3, 5, 7]);
  const leap = { start: L(2024, 2, 29, 9), end: L(2024, 2, 29, 10), recurrence: "FREQ=YEARLY" };
  assert.deepEqual(expandOccurrences(leap, L(2024, 1, 1), L(2033, 1, 1)).map((o) => o.start.getFullYear()), [2024, 2028, 2032]);
});

test("expansion: wall-clock time stays across a daylight-saving change; all-day events use UTC dates", () => {
  const ev = { start: L(2026, 3, 20, 10), end: L(2026, 3, 20, 11), recurrence: "FREQ=WEEKLY;COUNT=4" };
  assert.ok(expandOccurrences(ev, L(2026, 3, 1), L(2026, 5, 1)).every((o) => o.start.getHours() === 10));
  const allDay = { start: new Date(Date.UTC(2026, 9, 30)), end: new Date(Date.UTC(2026, 9, 30)), recurrence: "FREQ=DAILY;COUNT=3", allDay: true };
  assert.deepEqual(expandOccurrences(allDay, new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 11, 1))).map((o) => o.start.toISOString().slice(0, 10)), ["2026-10-30", "2026-10-31", "2026-11-01"]);
});

test("expansion: an endless rule is bounded by the period and the hard limit", () => {
  const ev = { start: L(2020, 1, 1, 8), end: L(2020, 1, 1, 9), recurrence: "FREQ=DAILY" };
  const got = expandOccurrences(ev, L(2026, 10, 1), L(2026, 10, 8));
  assert.equal(got.length, 7);
  assert.equal(got[0].start.getDate(), 1);
  assert.equal(expandOccurrences(ev, L(2020, 1, 1), L(2040, 1, 1)).length, MAX_OCCURRENCES);
  assert.equal(expandOccurrences(ev, L(2020, 1, 1), L(2040, 1, 1), 10).length, 10);
});

// ── Calendar records ─────────────────────────────────────────────────────────

const U1 = "00000000-0000-0000-0000-0000000000a1";
const U2 = "00000000-0000-0000-0000-0000000000b2";
const row = (over = {}) => ({
  id: "e1", title: "Site visit", start_at: L(2026, 10, 20, 10).toISOString(), end_at: L(2026, 10, 20, 11).toISOString(), all_day: false,
  location: null, description: null, organizer_id: U2, recurrence: null, privacy: "public", res_model: null, res_id: null, activity_id: null,
  calendar_attendees: [], calendar_reminders: [], ...over,
});
const WINDOW = { from: L(2026, 10, 1), to: L(2026, 12, 1) };

test("records: mine = organised or invited (not declined); team adds colleagues' busy blocks", () => {
  const invited = row({ id: "e2", calendar_attendees: [{ id: "a", user_id: U1, partner_model: null, partner_id: null, display_name: null, response: "accepted" }] });
  const declined = row({ id: "e3", calendar_attendees: [{ id: "b", user_id: U1, partner_model: null, partner_id: null, display_name: null, response: "declined" }] });
  assert.equal(isMine(row(), U1), false);
  assert.equal(isMine(invited, U1), true);
  assert.equal(isMine(declined, U1), false);
  assert.equal(isMine(row({ organizer_id: U1 }), U1), true);
  const busy = [{ user_id: U2, start_at: L(2026, 10, 21, 14).toISOString(), end_at: L(2026, 10, 21, 15).toISOString(), all_day: false, recurrence: "FREQ=DAILY;COUNT=2" }, { user_id: U1, start_at: L(2026, 10, 22, 9).toISOString(), end_at: L(2026, 10, 22, 10).toISOString(), all_day: false, recurrence: null }];
  const mine = toCalendarRecords([row(), invited, declined], busy, WINDOW, "mine", U1);
  assert.deepEqual(mine.map((r) => r.event_id), ["e2"]);
  const team = toCalendarRecords([row(), invited, declined], busy, WINDOW, "team", U1);
  assert.equal(team.filter((r) => !r.busy).length, 3);
  // Two busy occurrences of the colleague; the user's own busy block is not shown twice.
  assert.equal(team.filter((r) => r.busy).length, 2);
  assert.ok(team.filter((r) => r.busy).every((r) => r.title === "" && r.owner_id === U2 && r.event_id === ""));
  assert.equal(new Set(team.map((r) => r.id)).size, team.length);
});

test("records: recurring events give one record per occurrence; all-day events sit on their date", () => {
  const weekly = row({ organizer_id: U1, recurrence: "FREQ=WEEKLY;COUNT=3" });
  const recs = toCalendarRecords([weekly], [], WINDOW, "mine", U1);
  assert.deepEqual(recs.map((r) => new Date(r.start_at).getDate()), [20, 27, 3]);
  assert.ok(recs.every((r) => r.recurring && r.id.startsWith("e1@")));
  const allDay = row({ id: "d", organizer_id: U1, all_day: true, start_at: "2026-10-25T00:00:00.000Z", end_at: "2026-10-25T00:00:00.000Z" });
  const [d] = toCalendarRecords([allDay], [], WINDOW, "mine", U1);
  assert.equal(new Date(d.start_at).getDate(), 25);
  assert.equal(new Date(d.start_at).getHours(), 0);
  assert.equal(new Date(d.end_at).getDate(), 25);
});

test("one stable colour per person", () => {
  assert.equal(userColor(U1), userColor(U1));
  assert.ok(USER_COLORS.includes(userColor(U2)));
  assert.equal(userColor(null), "var(--ds-text-subtle)");
});

// ── Reminders ────────────────────────────────────────────────────────────────

test("reminders: due once per occurrence, only the user's in-app ones, not long after the start", () => {
  const ev = row({
    recurrence: "FREQ=DAILY;COUNT=3",
    calendar_reminders: [
      { id: "r1", user_id: U1, minutes_before: 15, channel: "in_app" },
      { id: "r2", user_id: U2, minutes_before: 15, channel: "in_app" },
      { id: "r3", user_id: U1, minutes_before: 60, channel: "email" },
    ],
  });
  assert.deepEqual(dueReminders([ev], new Set(), U1, L(2026, 10, 20, 9, 40)), []);
  const due = dueReminders([ev], new Set(), U1, L(2026, 10, 20, 9, 46));
  assert.deepEqual(due.map((d) => [d.reminder_id, new Date(d.occurrence_start).getDate()]), [["r1", 20]]);
  assert.deepEqual(dueReminders([ev], new Set([deliveryKey("r1", due[0].occurrence_start)]), U1, L(2026, 10, 20, 9, 50)), []);
  // The next day's occurrence reminds again; an hour after the start it is too late.
  assert.equal(dueReminders([ev], new Set([deliveryKey("r1", due[0].occurrence_start)]), U1, L(2026, 10, 21, 9, 50)).length, 1);
  assert.deepEqual(dueReminders([row({ calendar_reminders: [{ id: "r1", user_id: U1, minutes_before: 0, channel: "in_app" }] })], new Set(), U1, L(2026, 10, 20, 11, 30)), []);
  assert.deepEqual([...REMINDER_CHOICES], [0, 5, 10, 15, 30, 60, 120, 1440]);
});

// ── Form and export ──────────────────────────────────────────────────────────

test("event form: checks mirror the table; all-day events are stored at 00:00 UTC", () => {
  const base = { title: " Site visit ", date: "2026-10-20", startTime: "10:00", endTime: "11:30", allDay: false, location: " Baku ", description: "", privacy: "public", recurrence: "" };
  const ok = checkEvent(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.title, "Site visit");
  assert.equal(new Date(ok.value.start_at).getHours(), 10);
  assert.equal(new Date(ok.value.end_at).getTime() - new Date(ok.value.start_at).getTime(), 90 * 60_000);
  assert.equal(ok.value.location, "Baku");
  assert.equal(ok.value.description, null);
  assert.equal(checkEvent({ ...base, allDay: true }).value.start_at, "2026-10-20T00:00:00.000Z");
  for (const [over, error] of [
    [{ title: " " }, "calendar.errors.title"],
    [{ title: "x".repeat(201) }, "calendar.errors.tooLong"],
    [{ date: "20.10.2026" }, "calendar.errors.date"],
    [{ date: "2026-02-31" }, "calendar.errors.date"],
    [{ endTime: "10:00" }, "calendar.errors.endBeforeStart"],
    [{ startTime: "" }, "calendar.errors.time"],
    [{ recurrence: "FREQ=HOURLY" }, "calendar.errors.recurrence"],
  ]) {
    assert.deepEqual(checkEvent({ ...base, ...over }), { ok: false, error }, JSON.stringify(over));
  }
  // A saved event reads back into the same form.
  const back = eventToInput({ ...ok.value, title: "Site visit" });
  assert.deepEqual([back.date, back.startTime, back.endTime, back.allDay], ["2026-10-20", "10:00", "11:30", false]);
  assert.equal(eventToInput({ ...checkEvent({ ...base, allDay: true }).value }).date, "2026-10-20");
});

test("ICS export: valid calendar with escaped text, all-day dates, RRULE and folded lines", () => {
  const ics = buildIcs(
    [
      { id: "e1", title: "Meeting; with, Acme", start_at: "2026-10-20T06:00:00.000Z", end_at: "2026-10-20T07:00:00.000Z", all_day: false, location: "Baku\nOffice", description: "x".repeat(120), recurrence: "FREQ=WEEKLY;COUNT=2" },
      { id: "e2", title: "Holiday", start_at: "2026-11-08T00:00:00.000Z", end_at: "2026-11-08T00:00:00.000Z", all_day: true, location: null, description: null, recurrence: "FREQ=SECONDLY" },
    ],
    "Test ERP",
    new Date("2026-10-24T12:00:00Z")
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /DTSTART:20261020T060000Z\r\nDTEND:20261020T070000Z/);
  assert.match(ics, /SUMMARY:Meeting\\; with\\, Acme/);
  assert.match(ics, /LOCATION:Baku\\nOffice/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;COUNT=2/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261108\r\nDTEND;VALUE=DATE:20261109/);
  assert.doesNotMatch(ics, /SECONDLY/);
  assert.ok(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75));
  assert.equal(icsText("a\\b"), "a\\\\b");
  assert.equal(icsFold("ə".repeat(50)).split("\r\n ").join(""), "ə".repeat(50));
});

// ── Module, migration and texts ──────────────────────────────────────────────

test("the calendar module is registered, depends on core, opens from the new shell only", () => {
  const m = MODULES.find((x) => x.id === "calendar");
  assert.ok(m && MODULE_IDS.includes("calendar"));
  assert.deepEqual(m.depends, ["core"]);
  assert.deepEqual(m.menus, [], "no classic sidebar item");
  assert.deepEqual(m.routes, [{ prefix: "/calendar", permission: "can_view_dashboard" }]);
  assert.ok(SHELL_EXTRA_ITEMS.some((i) => i.path === "/calendar" && i.module === "calendar"));
  assert.match(read("src/app/calendar/page.tsx"), /if \(!isNewUiEnabled\(\)\) notFound\(\);/);
  assert.match(read("control-panel/supabase/migrations/20261024100000_calendar_module.sql"), /\('calendar', 'Calendar', '\{core\}', false\)/);
});

test("one migration; RLS on every table; access rules as designed", () => {
  assert.equal(readdirSync(join(root, "supabase/migrations")).filter((f) => f.startsWith("20261024100000")).length, 1);
  const sql = read(MIGRATION);
  for (const table of ["calendar_events", "calendar_attendees", "calendar_reminders", "calendar_reminder_deliveries"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`), table);
  }
  assert.match(sql, /using \(privacy = 'public' or organizer_id = auth\.uid\(\) or public\.calendar_can_see\(id\)\)/);
  assert.match(sql, /organizer_id = auth\.uid\(\)\s+and activity_id is null\s+and \(res_model is null or public\.chatter_record_visible\(res_model, res_id\)\)/);
  assert.match(sql, /create policy calendar_reminders_own on public\.calendar_reminders\s+for all to authenticated\s+using \(user_id = auth\.uid\(\)\)/);
  // Busy blocks never carry titles, places or records.
  const busy = /create or replace function public\.calendar_busy[\s\S]*?\$\$;/.exec(sql)[0];
  assert.doesNotMatch(busy, /e\.title|e\.location|e\.description|e\.res_/);
  assert.doesNotMatch(sql, /grant [^;]* to anon/);
  // Meeting activities create their event; CI runs the SQL checks; the preflight knows the migration.
  assert.match(sql, /create trigger calendar_sync_meeting_activity after insert or update of activity_type, summary, due_date, assigned_to on public\.activities/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/calendar\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261024100000_calendar/);
});

test("every calendar text exists in az, en and ru", () => {
  const keys = new Set();
  const files = ["src/modules/calendar/components/CalendarScreen.tsx", "src/modules/calendar/components/EventForm.tsx", "src/modules/calendar/components/ReminderAlerts.tsx", "src/modules/calendar/lib/calendar.ts", "src/modules/calendar/views/calendar.ts", "src/app/calendar/page.client.tsx", "src/views/chatter/Chatter.tsx", "src/views/components/CalendarView.tsx"];
  for (const f of files) for (const m of read(f).matchAll(/["'`]((?:calendar|views\.calendar|views\.chatter\.meeting)\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) keys.add(m[1]);
  keys.delete("calendar.events"); // the view's model key, not a text
  for (const s of ["mine", "team"]) keys.add(`calendar.scopes.${s}`);
  for (const r of ["none", "daily", "weekdays", "weekly", "monthly", "yearly"]) keys.add(`calendar.repeat.${r}`);
  for (const m of REMINDER_CHOICES) keys.add(`calendar.reminder.m${m}`);
  for (const r of ["needs_action", "accepted", "declined", "tentative"]) keys.add(`calendar.response.${r}`);
  keys.add("modules.names.calendar");
  keys.add("newShell.extra_calendar");
  const get = (messages, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), messages);
  assert.ok(keys.size > 60, String(keys.size));
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string");
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
});
