"use client";

import React, { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarDays, calendarEvents, dayKey, displayValue, fieldMap, shiftAnchor, startOfDay, type CalendarEvent, type CalendarMode, type Formatter } from "../logic";
import type { ViewDefinition, ViewRecord } from "../types";

const HOUR_PX = 48;
const MONTH_VISIBLE = 3;

// "Now" for the current-time line, refreshed every minute; null on the server.
let nowSnapshot: number | null = null;
const subscribeNow = (fn: () => void) => {
  nowSnapshot = Date.now();
  const timer = setInterval(() => {
    nowSnapshot = Date.now();
    fn();
  }, 60_000);
  return () => clearInterval(timer);
};

/**
 * Calendar (reference dashboards/dashboards-week-schedule-grid): day, week and month. Week and
 * day show an hour grid with events placed by time (overlaps side by side) and a line at the
 * current time; month shows a day grid with the first events and "+N more". Events open the
 * record.
 */
export function CalendarView<R extends ViewRecord>({ definition: def, records, openHref, fmt }: { definition: ViewDefinition<R>; records: readonly R[]; openHref: (r: R) => string; fmt: Formatter }) {
  const cal = def.calendar!;
  const fields = useMemo(() => fieldMap(def), [def]);
  const [mode, setMode] = useState<CalendarMode>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const now = useSyncExternalStore(subscribeNow, () => nowSnapshot, () => null);
  const days = useMemo(() => calendarDays(mode, anchor), [mode, anchor]);
  const events = useMemo(() => calendarEvents(records, days, cal.dateField, cal.endField, cal.defaultMinutes), [records, days, cal]);
  const today = now ? dayKey(new Date(now)) : null;
  const titleField = fields.get(cal.title)!;
  const colorField = cal.colorField ? fields.get(cal.colorField) : undefined;
  const colorOf = (r: R) => (colorField ? colorField.options?.find((o) => o.value === r[colorField.name])?.color : undefined) ?? cal.colorOf?.(r) ?? "var(--ds-brand)";
  const isAllDay = (e: CalendarEvent<R>) => !!cal.allDayField && e.record[cal.allDayField] === true;
  const heading = new Intl.DateTimeFormat(fmt.locale, mode === "day" ? { dateStyle: "full" } : { month: "long", year: "numeric" }).format(anchor);
  const weekday = (d: Date) => new Intl.DateTimeFormat(fmt.locale, { weekday: "short" }).format(d);
  const time = (d: Date) => new Intl.DateTimeFormat(fmt.locale, { hour: "2-digit", minute: "2-digit" }).format(d);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[length:var(--ds-text-lg)] font-semibold capitalize" aria-live="polite">
          {heading}
        </h2>
        <button type="button" className="ds-icon-btn" aria-label={fmt.t("views.calendar.previous")} onClick={() => setAnchor((a) => shiftAnchor(mode, a, -1))}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => setAnchor(startOfDay(new Date()))}>
          {fmt.t("views.calendar.today")}
        </button>
        <button type="button" className="ds-icon-btn" aria-label={fmt.t("views.calendar.next")} onClick={() => setAnchor((a) => shiftAnchor(mode, a, 1))}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        <div role="radiogroup" aria-label={fmt.t("views.calendar.mode")} className="flex rounded-[var(--ds-radius-md)] border p-0.5" style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface-sunken)" }}>
          {(["day", "week", "month"] as const).map((m, i, all) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              tabIndex={mode === m ? 0 : -1}
              onClick={() => setMode(m)}
              onKeyDown={(e) => {
                const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                const next = all[(i + dir + all.length) % all.length];
                setMode(next);
                (e.currentTarget.parentElement?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
              }}
              data-mode={m}
              className="h-7 rounded-[var(--ds-radius-sm)] px-3 text-[length:var(--ds-text-xs)] font-semibold"
              style={mode === m ? { background: "var(--ds-surface)", boxShadow: "var(--ds-elevation-1)" } : undefined}
            >
              {fmt.t(`views.calendar.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {mode === "month" ? (
        <div className="ds-card overflow-hidden">
          <div className="grid grid-cols-7 text-center ds-label" style={{ background: "var(--ds-surface-sunken)" }}>
            {days.slice(0, 7).map((d) => (
              <div key={dayKey(d)} className="py-2">
                {weekday(d)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = events.get(dayKey(d)) ?? [];
              const outside = d.getMonth() !== anchor.getMonth();
              return (
                <div key={dayKey(d)} className="flex min-h-24 flex-col gap-1 border-t p-1 sm:border-l" style={{ borderColor: "var(--ds-border)", opacity: outside ? 0.55 : 1 }}>
                  <span className={["self-end grid h-6 min-w-6 place-items-center rounded-full px-1 ds-mono text-[length:var(--ds-text-xs)]", dayKey(d) === today ? "font-bold" : ""].join(" ")} style={dayKey(d) === today ? { background: "var(--ds-text)", color: "var(--ds-bg)" } : undefined}>
                    {d.getDate()}
                  </span>
                  {list.slice(0, MONTH_VISIBLE).map((e) => (
                    <EventChip key={e.record.id} event={e} href={openHref(e.record)} title={displayValue(titleField, e.record, fmt)} color={colorOf(e.record)} time={time(e.start)} compact />
                  ))}
                  {list.length > MONTH_VISIBLE ? (
                    <button
                      type="button"
                      className="text-left text-[length:var(--ds-text-xs)] ds-muted hover:underline"
                      onClick={() => {
                        setAnchor(d);
                        setMode("day");
                      }}
                    >
                      {fmt.t("views.calendar.more", { count: list.length - MONTH_VISIBLE })}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : fields.get(cal.dateField)?.type === "date" ? (
        // A date without a time (invoice date): the day's events as a list, no hour grid.
        <div className="ds-card overflow-x-auto">
          <div className="grid min-w-[36rem]" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d) => {
              const list = events.get(dayKey(d)) ?? [];
              return (
                <div key={dayKey(d)} className="flex min-h-40 flex-col gap-1 border-l p-1.5 first:border-l-0" style={{ borderColor: "var(--ds-border)" }}>
                  <div className="mb-1 flex flex-col items-center gap-0.5">
                    <span className="ds-label">{weekday(d)}</span>
                    <span className="grid h-7 min-w-7 place-items-center rounded-full ds-mono font-semibold" style={dayKey(d) === today ? { background: "var(--ds-text)", color: "var(--ds-bg)" } : undefined}>
                      {d.getDate()}
                    </span>
                  </div>
                  {list.map((e) => (
                    <EventChip key={e.record.id} event={e} href={openHref(e.record)} title={displayValue(titleField, e.record, fmt)} color={colorOf(e.record)} time="" compact />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <TimeGrid
          days={days}
          events={events}
          today={today}
          now={now}
          weekday={weekday}
          time={time}
          isAllDay={isAllDay}
          allDayLabel={fmt.t("views.calendar.allDay")}
          render={(e) => <EventChip event={e} href={openHref(e.record)} title={displayValue(titleField, e.record, fmt)} color={colorOf(e.record)} time={isAllDay(e) ? fmt.t("views.calendar.allDay") : `${time(e.start)}–${time(e.end)}`} compact={isAllDay(e)} />}
        />
      )}
    </div>
  );
}

function TimeGrid<R extends ViewRecord>({
  days,
  events,
  today,
  now,
  weekday,
  isAllDay,
  allDayLabel,
  render,
}: {
  days: Date[];
  events: Map<string, CalendarEvent<R>[]>;
  today: string | null;
  now: number | null;
  weekday: (d: Date) => string;
  time: (d: Date) => string;
  isAllDay: (e: CalendarEvent<R>) => boolean;
  allDayLabel: string;
  render: (e: CalendarEvent<R>) => React.ReactNode;
}) {
  // All-day events go in their own row; the hour grid holds the timed ones.
  const timed = new Map<string, CalendarEvent<R>[]>();
  const allDay = new Map<string, CalendarEvent<R>[]>();
  for (const [key, list] of events) {
    timed.set(key, list.filter((e) => !isAllDay(e)));
    allDay.set(key, list.filter(isAllDay));
  }
  const hasAllDay = [...allDay.values()].some((l) => l.length > 0);
  // 08:00–18:00, widened to the earliest and latest event shown.
  const all = days.flatMap((d) => timed.get(dayKey(d)) ?? []);
  const first = Math.min(8, ...all.map((e) => e.start.getHours()));
  const last = Math.max(18, ...all.map((e) => Math.min(24, e.end.getHours() + (e.end.getMinutes() ? 1 : 0))));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const top = (d: Date) => ((d.getHours() - first) * 60 + d.getMinutes()) * (HOUR_PX / 60);
  const nowDate = now ? new Date(now) : null;
  return (
    <div className="ds-card overflow-x-auto">
      <div className="grid min-w-[36rem]" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => (
          <div key={dayKey(d)} className="flex flex-col items-center gap-0.5 border-l py-2" style={{ borderColor: "var(--ds-border)" }}>
            <span className="ds-label">{weekday(d)}</span>
            <span className="grid h-7 min-w-7 place-items-center rounded-full ds-mono font-semibold" style={dayKey(d) === today ? { background: "var(--ds-text)", color: "var(--ds-bg)" } : undefined}>
              {d.getDate()}
            </span>
          </div>
        ))}
        {hasAllDay ? (
          <>
            <span className="self-center pr-2 text-right ds-subtle text-[length:var(--ds-text-xs)]">{allDayLabel}</span>
            {days.map((d) => (
              <div key={dayKey(d)} className="flex flex-col gap-0.5 border-l border-t p-0.5" style={{ borderColor: "var(--ds-border)" }}>
                {(allDay.get(dayKey(d)) ?? []).map((e) => (
                  <div key={e.record.id}>{render(e)}</div>
                ))}
              </div>
            ))}
          </>
        ) : null}
        <div className="relative" style={{ height: hours.length * HOUR_PX }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 ds-mono ds-subtle text-[length:var(--ds-text-xs)]" style={{ top: (h - first) * HOUR_PX }}>
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {days.map((d) => {
          const list = timed.get(dayKey(d)) ?? [];
          const isToday = dayKey(d) === today;
          return (
            <div key={dayKey(d)} className="relative border-l" style={{ height: hours.length * HOUR_PX, borderColor: "var(--ds-border)", backgroundImage: `repeating-linear-gradient(to bottom, var(--ds-border) 0 1px, transparent 1px ${HOUR_PX}px)` }}>
              {list.map((e) => (
                <div key={e.record.id} className="absolute px-0.5" style={{ top: Math.max(0, top(e.start)), height: Math.max(22, (e.end.getTime() - e.start.getTime()) / 60000 * (HOUR_PX / 60)), left: `${(e.col / e.cols) * 100}%`, width: `${100 / e.cols}%` }}>
                  {render(e)}
                </div>
              ))}
              {isToday && nowDate && nowDate.getHours() >= first && nowDate.getHours() < last ? (
                <div className="pointer-events-none absolute inset-x-0 flex items-center" style={{ top: top(nowDate) }} aria-hidden>
                  <span className="-ml-1 h-2 w-2 rounded-full" style={{ background: "var(--ds-danger-solid)" }} />
                  <span className="h-px flex-1" style={{ background: "var(--ds-danger-solid)" }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventChip<R extends ViewRecord>({ event, href, title, color, time, compact }: { event: CalendarEvent<R>; href: string; title: string; color: string; time: string; compact?: boolean }) {
  void event;
  return (
    <Link
      href={href}
      className={["block h-full overflow-hidden rounded-[var(--ds-radius-sm)] border-l-[3px] px-1.5 text-[length:var(--ds-text-xs)] leading-tight hover:brightness-95", compact ? "py-0.5" : "py-1"].join(" ")}
      style={{ background: `color-mix(in srgb, ${color} 16%, var(--ds-surface))`, borderLeftColor: color }}
    >
      <span className="block truncate font-semibold">{title || "—"}</span>
      {compact ? null : <span className="block truncate ds-muted">{time}</span>}
      {compact ? <span className="sr-only">{time}</span> : null}
    </Link>
  );
}
