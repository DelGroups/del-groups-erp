/**
 * Calendar (phase 20), pure parts: event rows as calendar records (recurring events expanded),
 * "my" / "team" scope, a colour per user, reminders that are due, the event form's checks and the
 * ICS export. Kept free of React and Supabase so `node --test` covers it.
 */
import { expandOccurrences, parseRule } from "./recurrence";

export interface CalendarAttendee {
  id: string;
  user_id: string | null;
  partner_model: "customers" | "suppliers" | null;
  partner_id: string | null;
  display_name: string | null;
  response: "needs_action" | "accepted" | "declined" | "tentative";
}

export interface CalendarReminder {
  id: string;
  user_id: string;
  minutes_before: number;
  channel: "in_app" | "email";
}

export interface CalendarEventRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  organizer_id: string | null;
  recurrence: string | null;
  privacy: "public" | "private";
  res_model: string | null;
  res_id: string | null;
  activity_id: string | null;
  calendar_attendees?: CalendarAttendee[];
  calendar_reminders?: CalendarReminder[];
}

/** One occurrence on the calendar: the view engine's record. */
export interface CalendarRecord {
  /** Unique per occurrence: "<event id>@<start ISO>". */
  id: string;
  event_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  organizer_id: string | null;
  privacy: "public" | "private";
  recurring: boolean;
  res_model: string | null;
  res_id: string | null;
  attendee_count: number;
  /** The colour key: organizer, or the colleague a busy block belongs to. */
  owner_id: string | null;
  busy: boolean;
  [field: string]: unknown;
}

export type CalendarScope = "mine" | "team";

/** Whether the user takes part: organizer or an attendee who did not decline. */
export function isMine(event: Pick<CalendarEventRow, "organizer_id" | "calendar_attendees">, userId: string | null): boolean {
  if (!userId) return false;
  if (event.organizer_id === userId) return true;
  return (event.calendar_attendees ?? []).some((a) => a.user_id === userId && a.response !== "declined");
}

/** Window the calendar reads and expands: a month back, a year ahead. */
export function calendarWindow(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear() + 1, now.getMonth() + 1, 1) };
}

/** All-day events are stored at 00:00 UTC; on the calendar they sit on that date, local midnight. */
function shown(iso: string, allDay: boolean): Date {
  const d = new Date(iso);
  return allDay ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : d;
}

/** Event rows (and busy blocks) as calendar records in the window, recurring ones expanded. */
export function toCalendarRecords(
  rows: readonly CalendarEventRow[],
  busy: readonly { user_id: string; start_at: string; end_at: string; all_day: boolean; recurrence: string | null }[],
  window: { from: Date; to: Date },
  scope: CalendarScope,
  userId: string | null
): CalendarRecord[] {
  const out: CalendarRecord[] = [];
  for (const row of rows) {
    if (scope === "mine" && !isMine(row, userId)) continue;
    const start = new Date(row.start_at);
    const end = new Date(row.end_at);
    for (const o of expandOccurrences({ start, end, recurrence: row.recurrence, allDay: row.all_day }, window.from, window.to)) {
      const s = shown(o.start.toISOString(), row.all_day);
      const e = row.all_day ? new Date(shown(o.end.toISOString(), true).getTime() + 86_399_000) : o.end;
      out.push({
        id: `${row.id}@${o.start.toISOString()}`,
        event_id: row.id,
        title: row.title,
        start_at: s.toISOString(),
        end_at: e.toISOString(),
        all_day: row.all_day,
        location: row.location,
        organizer_id: row.organizer_id,
        privacy: row.privacy,
        recurring: !!parseRule(row.recurrence),
        res_model: row.res_model,
        res_id: row.res_id,
        attendee_count: (row.calendar_attendees ?? []).length,
        owner_id: row.organizer_id,
        busy: false,
      });
    }
  }
  if (scope === "team") {
    const seen = new Set(out.map((r) => r.id));
    busy.forEach((b, i) => {
      if (b.user_id === userId) return;
      for (const o of expandOccurrences({ start: new Date(b.start_at), end: new Date(b.end_at), recurrence: b.recurrence, allDay: b.all_day }, window.from, window.to)) {
        const id = `busy-${i}-${b.user_id}@${o.start.toISOString()}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const s = shown(o.start.toISOString(), b.all_day);
        out.push({
          id,
          event_id: "",
          title: "",
          start_at: s.toISOString(),
          end_at: (b.all_day ? new Date(s.getTime() + 86_399_000) : o.end).toISOString(),
          all_day: b.all_day,
          location: null,
          organizer_id: b.user_id,
          privacy: "private",
          recurring: !!parseRule(b.recurrence),
          res_model: null,
          res_id: null,
          attendee_count: 0,
          owner_id: b.user_id,
          busy: true,
        });
      }
    });
  }
  return out.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/** Colours for people, distinguishable in light and dark themes. */
export const USER_COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#ea580c"] as const;

/** A stable colour per user (the same person always gets the same colour). */
export function userColor(userId: string | null | undefined): string {
  if (!userId) return "var(--ds-text-subtle)";
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

// ── Reminders ────────────────────────────────────────────────────────────────

export interface DueReminder {
  reminder_id: string;
  event_id: string;
  title: string;
  occurrence_start: string;
  minutes_before: number;
}

/**
 * In-app reminders of the user that are due now: the reminder time has passed, the occurrence
 * has not started more than `graceMinutes` ago, and it was not shown yet. Recurring events
 * remind for each occurrence.
 */
export function dueReminders(
  rows: readonly CalendarEventRow[],
  delivered: ReadonlySet<string>,
  userId: string,
  now: Date,
  graceMinutes = 60
): DueReminder[] {
  const out: DueReminder[] = [];
  const maxBefore = 40320;
  for (const row of rows) {
    const reminders = (row.calendar_reminders ?? []).filter((r) => r.user_id === userId && r.channel === "in_app");
    if (!reminders.length) continue;
    const occurrences = expandOccurrences(
      { start: new Date(row.start_at), end: new Date(row.start_at), recurrence: row.recurrence, allDay: row.all_day },
      new Date(now.getTime() - graceMinutes * 60_000),
      new Date(now.getTime() + maxBefore * 60_000 + 1)
    );
    for (const o of occurrences) {
      for (const r of reminders) {
        const at = o.start.getTime() - r.minutes_before * 60_000;
        if (at > now.getTime()) continue;
        if (o.start.getTime() < now.getTime() - graceMinutes * 60_000) continue;
        const key = deliveryKey(r.id, o.start.toISOString());
        if (delivered.has(key)) continue;
        out.push({ reminder_id: r.id, event_id: row.id, title: row.title, occurrence_start: o.start.toISOString(), minutes_before: r.minutes_before });
      }
    }
  }
  return out.sort((a, b) => a.occurrence_start.localeCompare(b.occurrence_start));
}

/** Key of a delivery: reminder and occurrence (same instant, any ISO spelling). */
export function deliveryKey(reminderId: string, occurrenceStart: string): string {
  return `${reminderId}|${new Date(occurrenceStart).toISOString()}`;
}

// ── Event form ───────────────────────────────────────────────────────────────

export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440] as const;

export interface EventInput {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  description: string;
  privacy: "public" | "private";
  recurrence: string;
}

export interface EventValue {
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  privacy: "public" | "private";
  recurrence: string | null;
}

/** The form as a row to save, or an error key (same limits as the table). */
export function checkEvent(input: EventInput): { ok: true; value: EventValue } | { ok: false; error: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "calendar.errors.title" };
  if (title.length > 200) return { ok: false, error: "calendar.errors.tooLong" };
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  if (!date) return { ok: false, error: "calendar.errors.date" };
  const [y, m, d] = [Number(date[1]), Number(date[2]) - 1, Number(date[3])];
  let start: Date;
  let end: Date;
  if (input.allDay) {
    start = new Date(Date.UTC(y, m, d));
    end = start;
  } else {
    const st = /^(\d{2}):(\d{2})$/.exec(input.startTime);
    const et = /^(\d{2}):(\d{2})$/.exec(input.endTime);
    if (!st || !et) return { ok: false, error: "calendar.errors.time" };
    start = new Date(y, m, d, Number(st[1]), Number(st[2]));
    end = new Date(y, m, d, Number(et[1]), Number(et[2]));
    if (end.getTime() <= start.getTime()) return { ok: false, error: "calendar.errors.endBeforeStart" };
  }
  if (Number.isNaN(start.getTime()) || (input.allDay ? start.getUTCDate() !== d : start.getDate() !== d)) return { ok: false, error: "calendar.errors.date" };
  const recurrence = input.recurrence.trim();
  if (recurrence && !parseRule(recurrence)) return { ok: false, error: "calendar.errors.recurrence" };
  const location = input.location.trim();
  const description = input.description.trim();
  if (location.length > 200 || description.length > 5000) return { ok: false, error: "calendar.errors.tooLong" };
  return {
    ok: true,
    value: {
      title,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      all_day: input.allDay,
      location: location || null,
      description: description || null,
      privacy: input.privacy,
      recurrence: recurrence || null,
    },
  };
}

/** A saved event as form input (local date and times; all-day dates in UTC). */
export function eventToInput(row: Pick<CalendarEventRow, "title" | "start_at" | "end_at" | "all_day" | "location" | "description" | "privacy" | "recurrence">): EventInput {
  const s = new Date(row.start_at);
  const e = new Date(row.end_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = row.all_day ? `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}` : `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
  return {
    title: row.title,
    date,
    startTime: row.all_day ? "09:00" : `${pad(s.getHours())}:${pad(s.getMinutes())}`,
    endTime: row.all_day ? "10:00" : `${pad(e.getHours())}:${pad(e.getMinutes())}`,
    allDay: row.all_day,
    location: row.location ?? "",
    description: row.description ?? "",
    privacy: row.privacy,
    recurrence: row.recurrence ?? "",
  };
}

// ── ICS export ───────────────────────────────────────────────────────────────

/** Escapes a text value for iCalendar (RFC 5545 §3.3.11). */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets (RFC 5545 §3.1). */
export function icsFold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const max = out.length ? 74 : 75;
    if (size + n > max) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsDate(iso: string, plusDays = 0): string {
  const d = new Date(new Date(iso).getTime() + plusDays * 86_400_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** An iCalendar file of the events (recurring ones keep their RRULE), CRLF line ends. */
export function buildIcs(rows: readonly Pick<CalendarEventRow, "id" | "title" | "start_at" | "end_at" | "all_day" | "location" | "description" | "recurrence">[], productName: string, now: Date): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${icsText(productName)}//Calendar//EN`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const row of rows) {
    lines.push("BEGIN:VEVENT", `UID:${row.id}@calendar`, `DTSTAMP:${icsUtc(now.toISOString())}`);
    if (row.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(row.start_at)}`, `DTEND;VALUE=DATE:${icsDate(row.end_at, 1)}`);
    } else {
      lines.push(`DTSTART:${icsUtc(row.start_at)}`, `DTEND:${icsUtc(row.end_at)}`);
    }
    lines.push(`SUMMARY:${icsText(row.title)}`);
    if (row.location) lines.push(`LOCATION:${icsText(row.location)}`);
    if (row.description) lines.push(`DESCRIPTION:${icsText(row.description)}`);
    if (row.recurrence && parseRule(row.recurrence)) lines.push(`RRULE:${row.recurrence}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
