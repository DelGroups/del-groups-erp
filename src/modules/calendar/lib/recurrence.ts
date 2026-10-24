/**
 * Recurring events (phase 20): the RRULE subset the calendar stores
 * (FREQ=DAILY|WEEKLY|MONTHLY|YEARLY; INTERVAL; COUNT; UNTIL; BYDAY for weekly rules) and its
 * expansion into the occurrences of a period. Pure, so `node --test` covers it; the same rule
 * text is checked by the calendar_events.recurrence constraint.
 *
 * Occurrences keep the wall-clock time of the first one (a 10:00 weekly meeting stays at 10:00
 * across a daylight-saving change). All-day events are dated in UTC ("YYYY-MM-DD" of start_at).
 */

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  count?: number;
  /** Last moment an occurrence may start. */
  until?: Date;
  /** Weekly rules only: the weekdays, Monday first. */
  byDay?: Weekday[];
}

/** Hard stop for a single expansion, whatever the rule says. */
export const MAX_OCCURRENCES = 1000;

/** The rule as data, or null when the text is not in the supported subset. */
export function parseRule(text: string | null | undefined): RecurrenceRule | null {
  if (!text) return null;
  const parts = text.trim().toUpperCase().split(";").filter(Boolean);
  const map = new Map<string, string>();
  for (const part of parts) {
    const [key, value, extra] = part.split("=");
    if (!key || value === undefined || extra !== undefined || map.has(key)) return null;
    map.set(key, value);
  }
  const freq = map.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const rule: RecurrenceRule = { freq, interval: 1 };
  for (const [key, value] of map) {
    if (key === "FREQ") continue;
    if (key === "INTERVAL" || key === "COUNT") {
      if (!/^[1-9][0-9]{0,2}$/.test(value)) return null;
      if (key === "INTERVAL") rule.interval = Number(value);
      else rule.count = Number(value);
    } else if (key === "UNTIL") {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(value);
      if (!m) return null;
      const [, y, mo, d, h = "23", mi = "59", s = "59"] = m;
      rule.until = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
      if (Number.isNaN(rule.until.getTime())) return null;
    } else if (key === "BYDAY") {
      const days = value.split(",");
      if (!days.length || days.some((d) => !(WEEKDAYS as readonly string[]).includes(d)) || new Set(days).size !== days.length) return null;
      rule.byDay = [...(days as Weekday[])].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    } else {
      return null;
    }
  }
  if (rule.byDay && rule.freq !== "WEEKLY") return null;
  return rule;
}

/** The rule as RRULE text (fields in a fixed order), the inverse of parseRule. */
export function formatRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) {
    const u = rule.until;
    const pad = (n: number) => String(n).padStart(2, "0");
    parts.push(`UNTIL=${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}${pad(u.getUTCSeconds())}Z`);
  }
  return parts.join(";");
}

export interface Occurrence {
  start: Date;
  end: Date;
  /** 0 for the first occurrence of the series. */
  index: number;
}

interface Clock {
  /** Calendar fields of a moment: local time, or UTC for all-day events. */
  parts: (d: Date) => { y: number; m: number; d: number; h: number; mi: number; s: number; ms: number; dow: number };
  make: (y: number, m: number, d: number, h: number, mi: number, s: number, ms: number) => Date;
}

const LOCAL: Clock = {
  parts: (x) => ({ y: x.getFullYear(), m: x.getMonth(), d: x.getDate(), h: x.getHours(), mi: x.getMinutes(), s: x.getSeconds(), ms: x.getMilliseconds(), dow: (x.getDay() + 6) % 7 }),
  make: (y, m, d, h, mi, s, ms) => new Date(y, m, d, h, mi, s, ms),
};
const UTC: Clock = {
  parts: (x) => ({ y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes(), s: x.getUTCSeconds(), ms: x.getUTCMilliseconds(), dow: (x.getUTCDay() + 6) % 7 }),
  make: (y, m, d, h, mi, s, ms) => new Date(Date.UTC(y, m, d, h, mi, s, ms)),
};

function daysInMonth(clock: Clock, y: number, m: number): number {
  return clock.parts(clock.make(y, m + 1, 0, 12, 0, 0, 0)).d;
}

/**
 * Occurrences of an event that overlap [from, to). A non-recurring event gives itself when it
 * overlaps. COUNT counts from the first occurrence (also those before `from`). Monthly and
 * yearly rules skip months without the start's day (31st, 29 February), as RFC 5545 does.
 */
export function expandOccurrences(
  event: { start: Date; end: Date; recurrence?: string | null; allDay?: boolean },
  from: Date,
  to: Date,
  max = MAX_OCCURRENCES
): Occurrence[] {
  const duration = Math.max(0, event.end.getTime() - event.start.getTime());
  const overlaps = (start: Date) => start.getTime() < to.getTime() && start.getTime() + Math.max(duration, 1) > from.getTime();
  const rule = parseRule(event.recurrence);
  if (!rule) return overlaps(event.start) ? [{ start: event.start, end: event.end, index: 0 }] : [];

  const clock = event.allDay ? UTC : LOCAL;
  const p = clock.parts(event.start);
  const at = (y: number, m: number, d: number) => clock.make(y, m, d, p.h, p.mi, p.s, p.ms);
  const out: Occurrence[] = [];
  let index = 0;
  const limit = Math.min(rule.count ?? Infinity, max * 50);

  // Candidate starts in order; stops at COUNT, UNTIL, the end of the period or the hard limit.
  const take = (start: Date): boolean => {
    if (start.getTime() < event.start.getTime()) return true;
    if (rule.until && start.getTime() > rule.until.getTime()) return false;
    if (index >= limit) return false;
    if (start.getTime() >= to.getTime()) return false;
    if (overlaps(start)) out.push({ start, end: new Date(start.getTime() + duration), index });
    index += 1;
    return out.length < max;
  };

  if (rule.freq === "DAILY") {
    for (let i = 0; ; i += rule.interval) if (!take(at(p.y, p.m, p.d + i))) break;
  } else if (rule.freq === "WEEKLY") {
    const days = rule.byDay?.length ? rule.byDay.map((d) => WEEKDAYS.indexOf(d)) : [p.dow];
    const weekStart = p.d - p.dow;
    outer: for (let w = 0; ; w += rule.interval) {
      for (const dow of days) if (!take(at(p.y, p.m, weekStart + w * 7 + dow))) break outer;
    }
  } else if (rule.freq === "MONTHLY") {
    for (let i = 0; ; i += rule.interval) {
      const y = p.y + Math.floor((p.m + i) / 12);
      const m = (p.m + i) % 12;
      if (p.d > daysInMonth(clock, y, m)) {
        if (at(y, m, 1).getTime() >= to.getTime() || (rule.until && at(y, m, 1).getTime() > rule.until.getTime())) break;
        continue;
      }
      if (!take(at(y, m, p.d))) break;
    }
  } else {
    for (let i = 0; ; i += rule.interval) {
      const y = p.y + i;
      if (p.d > daysInMonth(clock, y, p.m)) {
        if (at(y, 0, 1).getTime() >= to.getTime() || (rule.until && at(y, 0, 1).getTime() > rule.until.getTime())) break;
        continue;
      }
      if (!take(at(y, p.m, p.d))) break;
    }
  }
  return out;
}
