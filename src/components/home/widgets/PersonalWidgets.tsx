"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  FileText,
  ListTodo,

  Receipt,
  ShoppingCart,
  Sun,
  ThumbsUp,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { CountUp } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { HOME_TIME_ZONE, isoDay, monthGrid, shiftMonth } from "@/lib/home/dates";
import type { WeatherCondition, WeatherReport } from "@/lib/home/weather";
import { DEFAULT_CITY } from "@/lib/home/weather";
import { WidgetFrame, WidgetState } from "../WidgetFrame";
import { useWidgetData } from "../useWidgetData";
import { useFigures } from "./format";
import { frameProps, type WidgetProps } from "./types";

/** The current time, ticking once a second (or a minute when only minutes are shown). */
function useNow(stepMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

function hourIn(date: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date));
}

// ── Greeting ────────────────────────────────────────────────────────────

export function GreetingWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const { profile } = useAuth();
  const company = useCompanyProfile().displayName;
  const now = useNow(60_000);
  const hour = hourIn(now, HOME_TIME_ZONE);
  const part = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = (profile?.full_name ?? "").trim().split(/\s+/)[0];
  return (
    <WidgetFrame {...frameProps(props)}>
      <p className="text-[length:var(--ds-text-2xl)] font-semibold leading-tight tracking-tight">
        {first ? t(`home.greeting.${part}Named`, { name: first }) : t(`home.greeting.${part}`)}
      </p>
      <p className="mt-1 ds-muted">
        {new Intl.DateTimeFormat(locale, { timeZone: HOME_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}
        {company ? <span className="ds-subtle"> · {company}</span> : null}
      </p>
    </WidgetFrame>
  );
}

// ── Clock ───────────────────────────────────────────────────────────────

export function ClockWidget(props: WidgetProps) {
  const { locale } = useFigures();
  const timeZone = props.placement.settings?.timeZone || HOME_TIME_ZONE;
  const analogue = props.placement.settings?.face === "analogue";
  const now = useNow(1000);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const h = get("hour");
  const m = get("minute");
  const s = get("second");
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(now);
  const date = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(now);
  const big = props.placement.size === "M";
  return (
    <WidgetFrame {...frameProps(props)}>
      <div className={`flex items-center gap-4 ${analogue && big ? "" : "flex-col items-start gap-1"}`}>
        {analogue ? <AnalogueFace h={h} m={m} s={s} size={big ? 96 : 72} label={time} /> : null}
        <div>
          <time
            dateTime={now.toISOString()}
            className="block font-semibold tracking-tight ds-mono"
            style={{ fontSize: big ? "var(--ds-text-3xl, 2.25rem)" : "var(--ds-text-2xl)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}
          >
            {time}
            <span className="ms-1 align-top text-[length:var(--ds-text-sm)] ds-subtle" aria-hidden>
              {String(s).padStart(2, "0")}
            </span>
          </time>
          <p className="mt-1 ds-muted">{date}</p>
          <p className="text-[length:var(--ds-text-xs)] ds-subtle">{timeZone.replace("_", " ")}</p>
        </div>
      </div>
    </WidgetFrame>
  );
}

function AnalogueFace({ h, m, s, size, label }: { h: number; m: number; s: number; size: number; label: string }) {
  const reduced = useReducedMotion();
  const hand = (deg: number, len: number, width: number, color: string) => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} stroke={color} strokeWidth={width} strokeLinecap="round" />
  );
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label}>
      <circle cx="50" cy="50" r="47" fill="var(--ds-surface-sunken)" stroke="var(--ds-border)" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        return <line key={i} x1={50 + 40 * Math.sin(a)} y1={50 - 40 * Math.cos(a)} x2={50 + 44 * Math.sin(a)} y2={50 - 44 * Math.cos(a)} stroke="var(--ds-text-subtle, currentColor)" strokeWidth={i % 3 ? 1.5 : 3} strokeLinecap="round" />;
      })}
      {hand(((h % 12) + m / 60) * 30, 24, 4, "var(--ds-text)")}
      {hand((m + s / 60) * 6, 34, 3, "var(--ds-text)")}
      {reduced ? null : hand(s * 6, 38, 1.5, "var(--ds-brand)")}
      <circle cx="50" cy="50" r="3" fill="var(--ds-brand)" />
    </svg>
  );
}

// ── Weather ─────────────────────────────────────────────────────────────

const WEATHER_ICONS: Record<WeatherCondition, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

export function WeatherWidget(props: WidgetProps) {
  const { t, locale, staleNote } = useFigures();
  const city = props.placement.settings?.city || DEFAULT_CITY;
  const q = useWidgetData<WeatherReport>("weather", { city }, !props.preview);
  const w = q.data?.data;
  const Icon = w ? WEATHER_ICONS[w.condition] : Sun;
  return (
    <WidgetFrame {...frameProps(props)} title={w ? `${t(props.def.titleKey)} · ${w.city}` : undefined}>
      <WidgetState status={props.preview ? "success" : q.status} emptyIcon={Cloud} emptyTitle={t("home.empty.weather")} onRetry={() => void q.refetch()} stale={staleNote(w?.fetchedAt, w?.stale)} empty={!props.preview && !w}>
        <div className="flex items-center gap-3">
          <Icon className="h-10 w-10 shrink-0" style={{ color: "var(--ds-brand)" }} aria-hidden />
          <div>
            <p className="text-[length:var(--ds-text-2xl)] font-semibold leading-none ds-mono">{w ? `${w.temperature}°` : "21°"}</p>
            <p className="ds-muted">{t(`home.weather.${w?.condition ?? "clear"}`)}</p>
          </div>
        </div>
        {props.placement.size === "M" && w?.days.length ? (
          <ul className="mt-3 grid grid-cols-3 gap-2" aria-label={t("home.weather.next")}>
            {w.days.map((d) => {
              const DayIcon = WEATHER_ICONS[d.condition];
              return (
                <li key={d.date} className="flex flex-col items-center gap-1 rounded-[var(--ds-radius-md)] py-2" style={{ background: "var(--ds-surface-sunken)" }}>
                  <span className="text-[length:var(--ds-text-xs)] ds-muted">{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(`${d.date}T12:00:00`))}</span>
                  <DayIcon className="h-5 w-5" aria-label={t(`home.weather.${d.condition}`)} />
                  <span className="text-[length:var(--ds-text-xs)] ds-mono">
                    {d.max}° <span className="ds-subtle">{d.min}°</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Calendar (month grid) ──────────────────────────────────────────────

interface CalendarData {
  month: string;
  days: Record<string, { events: number; activities: number }>;
  calendarModule: boolean;
}

export function CalendarWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const today = isoDay(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const q = useWidgetData<CalendarData>("calendar", { month }, !props.preview);
  const weeks = monthGrid(month);
  const dows = useMemo(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(Date.UTC(2024, 0, 1 + i)))), [locale]);
  const days = q.data?.data.days ?? {};
  const linkDays = q.data?.data.calendarModule ?? false;
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(`${month}-15T12:00:00`));
  return (
    <WidgetFrame
      {...props}
      size={props.placement.size}
      action={
        <div className="flex items-center gap-0.5">
          <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("home.calendar.previous")}>
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
          <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => setMonth(today.slice(0, 7))}>{t("home.calendar.today")}</button>
          <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("home.calendar.next")}>
            <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
        </div>
      }
    >
      <p className="mb-2 font-medium capitalize" aria-live="polite">{title}</p>
      <table className="w-full table-fixed border-collapse text-center text-[length:var(--ds-text-xs)]">
        <thead>
          <tr>{dows.map((d, i) => <th key={i} scope="col" className="pb-1 font-normal ds-subtle">{d}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => {
                if (!day) return <td key={di} />;
                const info = days[day];
                const isToday = day === today;
                const dots = info ? (info.events ? 1 : 0) + (info.activities ? 1 : 0) : 0;
                const label = `${new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00`))}${info ? `: ${t("home.calendar.dayInfo", { events: info.events, activities: info.activities })}` : ""}`;
                const inner = (
                  <span className="relative mx-auto grid h-7 w-7 place-items-center rounded-full ds-mono" style={isToday ? { background: "var(--ds-brand)", color: "var(--ds-on-brand, #fff)", fontWeight: 600 } : undefined}>
                    {Number(day.slice(8))}
                    {dots ? (
                      <span className="absolute -bottom-0.5 flex gap-0.5" aria-hidden>
                        {info?.events ? <span className="h-1 w-1 rounded-full" style={{ background: isToday ? "currentColor" : "var(--ds-brand)" }} /> : null}
                        {info?.activities ? <span className="h-1 w-1 rounded-full" style={{ background: isToday ? "currentColor" : "var(--ds-warning)" }} /> : null}
                      </span>
                    ) : null}
                  </span>
                );
                return (
                  <td key={di} className="py-0.5">
                    {linkDays ? (
                      <Link href={`/calendar?date=${day}`} aria-label={label} className="block rounded-full focus-visible:outline-2">{inner}</Link>
                    ) : (
                      <span aria-label={label}>{inner}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 flex gap-3 text-[length:var(--ds-text-xs)] ds-muted">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ds-brand)" }} aria-hidden />{t("home.calendar.events")}</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--ds-warning)" }} aria-hidden />{t("home.calendar.activities")}</span>
      </p>
    </WidgetFrame>
  );
}

// ── Quick actions ───────────────────────────────────────────────────────

const ACTIONS: { id: string; href: string; icon: LucideIcon; module?: string; permission?: Parameters<ReturnType<typeof useAuth>["can"]>[0] }[] = [
  { id: "sale", href: "/sales/new", icon: ShoppingCart, module: "sales", permission: "can_create_invoice" },
  { id: "purchase", href: "/purchases/new", icon: Receipt, module: "purchases", permission: "can_create_purchase" },
  { id: "customer", href: "/customers", icon: UserPlus, permission: "can_manage_customers" },
  { id: "task", href: "/todo?capture=1", icon: ListTodo, module: "todo" },
  { id: "expense", href: "/expenses", icon: Wallet, module: "expenses", permission: "can_manage_expenses" },
];

export function QuickActionsWidget(props: WidgetProps) {
  const { t } = useFigures();
  const { can } = useAuth();
  const { isEnabled } = useEnabledModules();
  const shown = ACTIONS.filter((a) => (!a.module || isEnabled(a.module as Parameters<typeof isEnabled>[0])) && (!a.permission || can(a.permission)));
  return (
    <WidgetFrame {...frameProps(props)}>
      {shown.length ? (
        <ul className={`grid gap-2 ${props.placement.size === "L" ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2"}`}>
          {shown.map((a) => (
            <li key={a.id}>
              <Link href={a.href} className="ds-btn w-full justify-start gap-2" style={{ minHeight: "2.75rem" }}>
                <span className="grid h-7 w-7 place-items-center rounded-[var(--ds-radius-sm)]" style={{ background: "var(--ds-brand-soft)", color: "var(--ds-brand)" }} aria-hidden>
                  <a.icon className="h-4 w-4" />
                </span>
                <span className="truncate">{t(`home.quick.${a.id}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ds-muted">{t("home.empty.quick")}</p>
      )}
    </WidgetFrame>
  );
}

// ── My activities ───────────────────────────────────────────────────────

interface ActivitiesData {
  counts: { overdue: number; today: number; planned: number };
  items: { id: string; summary: string; due_date: string; state: "overdue" | "today" | "planned"; href: string | null }[];
}

const STATE_COLOR = { overdue: "var(--ds-danger)", today: "var(--ds-warning)", planned: "var(--ds-success)" } as const;

export function MyActivitiesWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const q = useWidgetData<ActivitiesData>("my_activities", {}, !props.preview);
  const d = q.data?.data;
  const total = d ? d.counts.overdue + d.counts.today + d.counts.planned : 0;
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && total === 0} emptyIcon={CalendarCheck2} emptyTitle={t("home.empty.activities")}>
        <dl className="grid grid-cols-3 gap-2">
          {(["overdue", "today", "planned"] as const).map((k) => (
            <div key={k} className="rounded-[var(--ds-radius-md)] px-2 py-1.5" style={{ background: "var(--ds-surface-sunken)", borderInlineStart: `3px solid ${STATE_COLOR[k]}` }}>
              <dt className="text-[length:var(--ds-text-xs)] ds-muted">{t(`home.activities.${k}`)}</dt>
              <dd className="text-[length:var(--ds-text-lg)] font-semibold">
                <CountUp value={d?.counts[k] ?? 0} locale={locale} />
              </dd>
            </div>
          ))}
        </dl>
        {props.placement.size !== "S" && d?.items.length ? (
          <ul className="mt-3 flex flex-col">
            {d.items.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: "1px solid var(--ds-border)" }}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATE_COLOR[a.state] }} aria-hidden />
                {a.href ? <Link href={a.href} className="min-w-0 flex-1 truncate hover:underline">{a.summary}</Link> : <span className="min-w-0 flex-1 truncate">{a.summary}</span>}
                <span className="shrink-0 text-[length:var(--ds-text-xs)] ds-subtle">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${a.due_date}T12:00:00`))}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Today's agenda ──────────────────────────────────────────────────────

interface AgendaData {
  day: string;
  items: { id: string; title: string; location: string | null; allDay: boolean; start: string; end: string; href: string }[];
}

export function AgendaWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const q = useWidgetData<AgendaData>("agenda", {}, !props.preview);
  const items = q.data?.data.items ?? [];
  const now = useNow(60_000).getTime();
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: HOME_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/calendar" className="ds-btn ds-btn-ghost ds-btn-sm">{t("home.agenda.open")}</Link>}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && !items.length} emptyIcon={CalendarDays} emptyTitle={t("home.empty.agenda")}>
        <ol className="relative flex flex-col gap-1 ps-3" style={{ borderInlineStart: "2px solid var(--ds-border)" }}>
          {items.map((e) => {
            const live = new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now;
            return (
              <li key={`${e.id}@${e.start}`} className="relative py-1">
                <span className="absolute -start-[1.05rem] top-2.5 h-2.5 w-2.5 rounded-full" style={{ background: live ? "var(--ds-brand)" : "var(--ds-surface)", border: "2px solid var(--ds-brand)" }} aria-hidden />
                <p className="text-[length:var(--ds-text-xs)] ds-mono ds-muted">{e.allDay ? t("home.agenda.allDay") : `${time(e.start)}–${time(e.end)}`}</p>
                <p className="font-medium">{e.title}{live ? <span className="ms-2 ds-chip">{t("home.agenda.now")}</span> : null}</p>
                {e.location ? <p className="text-[length:var(--ds-text-xs)] ds-subtle">{e.location}</p> : null}
              </li>
            );
          })}
        </ol>
      </WidgetState>
    </WidgetFrame>
  );
}

// ── My to-dos ───────────────────────────────────────────────────────────

interface TodosData {
  items: { id: string; title: string; due_date: string | null; priority: number; overdue: boolean }[];
}

export function MyTodosWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const client = useQueryClient();
  const reduced = useReducedMotion();
  const q = useWidgetData<TodosData>("my_todos", {}, !props.preview);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const items = (q.data?.data.items ?? []).filter((i) => !done.has(i.id));
  const finish = async (id: string) => {
    setDone((s) => new Set(s).add(id));
    setError(false);
    const res = await fetch("/api/home/widgets/my_todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: id }) });
    if (!res.ok) {
      setDone((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      setError(true);
    }
    void client.invalidateQueries({ queryKey: ["home-widget", "my_todos"] });
  };
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/todo" className="ds-btn ds-btn-ghost ds-btn-sm">{t("home.todos.open")}</Link>}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && !items.length} emptyIcon={ListTodo} emptyTitle={t("home.empty.todos")}>
        <ul className="flex flex-col">
          {items.map((i) => (
            <motion.li key={i.id} layout={!reduced} className="flex items-center gap-2 py-1.5" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <button
                type="button"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
                style={{ border: "1.5px solid var(--ds-border-strong)" }}
                onClick={() => void finish(i.id)}
                aria-label={t("home.todos.finish", { title: i.title })}
              >
                <Check className="h-3 w-3 opacity-0 hover:opacity-60" aria-hidden />
              </button>
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              {i.due_date ? (
                <span className="shrink-0 text-[length:var(--ds-text-xs)]" style={{ color: i.overdue ? "var(--ds-danger-strong)" : undefined }}>
                  {i.overdue ? t("home.todos.overdue") : t("home.todos.today")} · {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${i.due_date}T12:00:00`))}
                </span>
              ) : null}
            </motion.li>
          ))}
        </ul>
        {error ? <p role="alert" className="mt-2 text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>{t("home.todos.failed")}</p> : null}
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Pending approvals ───────────────────────────────────────────────────

interface ApprovalsData {
  count: number;
  items: { id: string; title: string; category: string | null; submittedToday: boolean; amount?: number; href: string }[];
}

export function ApprovalsWidget(props: WidgetProps) {
  const { t, money, locale } = useFigures();
  const q = useWidgetData<ApprovalsData>("approvals", {}, !props.preview);
  const d = q.data?.data;
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/expenses" className="ds-btn ds-btn-ghost ds-btn-sm">{t("home.approvals.open")}</Link>}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && !d?.count} emptyIcon={ThumbsUp} emptyTitle={t("home.empty.approvals")}>
        <p className="mb-2 flex items-baseline gap-2">
          <span className="text-[length:var(--ds-text-xl)] font-semibold"><CountUp value={d?.count ?? 0} locale={locale} /></span>
          <span className="ds-muted">{t("home.approvals.waiting")}</span>
        </p>
        <ul className="flex flex-col">
          {(d?.items ?? []).slice(0, props.placement.size === "L" ? 10 : 5).map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <Link href={e.href} className="min-w-0 flex-1 truncate hover:underline">{e.title}</Link>
              {e.submittedToday ? <span className="ds-chip">{t("home.approvals.new")}</span> : null}
              {e.amount !== undefined ? <span className="shrink-0 ds-mono">{money(e.amount)}</span> : null}
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Saved views and recent documents ────────────────────────────────────

export function SavedViewsWidget(props: WidgetProps) {
  const { t } = useFigures();
  const q = useWidgetData<{ items: { id: string; name: string; viewKey: string; href: string }[] }>("saved_views", {}, !props.preview);
  const items = q.data?.data.items ?? [];
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && !items.length} emptyIcon={Bookmark} emptyTitle={t("home.empty.savedViews")} emptyHint={t("home.empty.savedViewsHint")}>
        <ul className="flex flex-wrap gap-1.5">
          {items.map((f) => (
            <li key={f.id}>
              <Link href={f.href} className="ds-chip flex items-center gap-1 hover:underline">
                <Bookmark className="h-3 w-3" aria-hidden />
                {f.name}
              </Link>
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}

export function RecentDocumentsWidget(props: WidgetProps) {
  const { t, locale } = useFigures();
  const q = useWidgetData<{ items: { id: string; name: string; mime_type: string | null; created_at: string; href: string }[] }>("recent_documents", {}, !props.preview);
  const items = q.data?.data.items ?? [];
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/documents" className="ds-btn ds-btn-ghost ds-btn-sm">{t("home.documents.open")}</Link>}>
      <WidgetState status={props.preview ? "success" : q.status} onRetry={() => void q.refetch()} empty={!props.preview && !items.length} emptyIcon={FileText} emptyTitle={t("home.empty.documents")}>
        <ul className="flex flex-col">
          {items.map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <FileText className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
              <Link href={d.href} className="min-w-0 flex-1 truncate hover:underline">{d.name}</Link>
              <span className="shrink-0 text-[length:var(--ds-text-xs)] ds-subtle">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(d.created_at))}</span>
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}

