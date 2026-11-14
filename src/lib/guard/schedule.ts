/**
 * GUARD-4: the automatic scan of the Accounting Guard (pg_cron). Pure helpers for the "Automatic
 * scan" card of the Rules tab: reading the database's answer, the choices a person has, and the
 * check before a change is sent. The database checks the same ranges again (guard_set_schedule).
 */

/** How often the quick scan of changed documents runs, in minutes. */
export const INCREMENTAL_MINUTES = [10, 15, 30, 60] as const;
export type IncrementalMinutes = (typeof INCREMENTAL_MINUTES)[number];

export const NIGHTLY_HOURS = Array.from({ length: 24 }, (_, h) => h);
export const RETENTION_MIN_DAYS = 30;
export const RETENTION_MAX_DAYS = 3650;

/** Baku is UTC+4 all year (no daylight saving). */
export const BAKU_UTC_OFFSET_HOURS = 4;

export interface ScheduleSettings {
  enabled: boolean;
  incrementalMinutes: number;
  /** The hour (UTC, 0 to 23) of the nightly full scan. */
  nightlyHourUtc: number;
  retentionDays: number;
}

export interface GuardScheduleState {
  /** pg_cron is installed in the database (the jobs can exist). */
  pgCron: boolean;
  settings: ScheduleSettings;
  jobs: { name: string; schedule: string; active: boolean }[];
  nextIncremental: string | null;
  nextFull: string | null;
  lastRun: { id: string; startedAt: string; finishedAt: string | null; status: string; newCount: number; openCount: number; resolvedCount: number; since: string | null } | null;
}

export const DEFAULT_SCHEDULE: Readonly<ScheduleSettings> = { enabled: false, incrementalMinutes: 30, nightlyHourUtc: 22, retentionDays: 365 };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The guard_schedule_state() answer; anything missing falls back to the defaults. */
export function scheduleFromJson(raw: unknown): GuardScheduleState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const s = o.settings && typeof o.settings === "object" ? (o.settings as Record<string, unknown>) : {};
  const run = o.last_scheduled_run && typeof o.last_scheduled_run === "object" ? (o.last_scheduled_run as Record<string, unknown>) : null;
  const jobs = Array.isArray(o.jobs) ? (o.jobs as Record<string, unknown>[]) : [];
  return {
    pgCron: o.pg_cron_available === true,
    settings: {
      enabled: s.enabled === true,
      incrementalMinutes: num(s.incremental_minutes) ?? DEFAULT_SCHEDULE.incrementalMinutes,
      nightlyHourUtc: num(s.nightly_hour_utc) ?? DEFAULT_SCHEDULE.nightlyHourUtc,
      retentionDays: num(s.retention_days) ?? DEFAULT_SCHEDULE.retentionDays,
    },
    jobs: jobs.flatMap((j) => (typeof j.name === "string" ? [{ name: j.name, schedule: String(j.schedule ?? ""), active: j.active !== false }] : [])),
    nextIncremental: text(o.next_incremental),
    nextFull: text(o.next_full),
    lastRun:
      run && typeof run.id === "string"
        ? {
            id: run.id,
            startedAt: String(run.started_at ?? ""),
            finishedAt: text(run.finished_at),
            status: String(run.status ?? ""),
            newCount: num(run.new_count) ?? 0,
            openCount: num(run.open_count) ?? 0,
            resolvedCount: num(run.resolved_count) ?? 0,
            since: text(run.since),
          }
        : null,
  };
}

/** The hour in Baku for an hour in UTC. */
export function bakuHour(hourUtc: number): number {
  return (((hourUtc + BAKU_UTC_OFFSET_HOURS) % 24) + 24) % 24;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "22:00" for an hour of the day. */
export function hourText(hour: number): string {
  return `${pad(hour)}:00`;
}

export type ScheduleField = "incrementalMinutes" | "nightlyHourUtc" | "retentionDays";

/** The settings of a form, checked; the first field out of range is named. */
export function validateSchedule(input: { enabled: boolean; incrementalMinutes: number; nightlyHourUtc: number; retentionDays: number }): { ok: true; value: ScheduleSettings } | { ok: false; field: ScheduleField } {
  if (!(INCREMENTAL_MINUTES as readonly number[]).includes(input.incrementalMinutes)) return { ok: false, field: "incrementalMinutes" };
  if (!Number.isInteger(input.nightlyHourUtc) || input.nightlyHourUtc < 0 || input.nightlyHourUtc > 23) return { ok: false, field: "nightlyHourUtc" };
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < RETENTION_MIN_DAYS || input.retentionDays > RETENTION_MAX_DAYS) return { ok: false, field: "retentionDays" };
  return { ok: true, value: { enabled: input.enabled === true, incrementalMinutes: input.incrementalMinutes, nightlyHourUtc: input.nightlyHourUtc, retentionDays: input.retentionDays } };
}

export function scheduleChanged(a: ScheduleSettings, b: ScheduleSettings): boolean {
  return a.enabled !== b.enabled || a.incrementalMinutes !== b.incrementalMinutes || a.nightlyHourUtc !== b.nightlyHourUtc || a.retentionDays !== b.retentionDays;
}
