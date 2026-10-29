/**
 * Data of each home widget (prompt 24b), loaded by /api/home/widgets/[id] with the signed-in
 * user's own Supabase session: row level security decides what each query sees. Financial
 * widgets only call the home_* database functions, which refuse anyone without
 * dashboard.view_financials; the route refuses them even earlier. Server only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
// The pure recurrence helper only: the module's index also exports client components, which a
// server route must not import.
// eslint-disable-next-line no-restricted-imports
import { expandOccurrences } from "@/modules/calendar/lib/recurrence";
import { recordHref } from "@/views/chatter/logic";
import { savedViewHref } from "../views";
import { cleanCity, DEFAULT_CITY, forecastUrl, geocodeUrl, parseForecast, parseGeocode, WEATHER_CACHE_MS, type WeatherReport } from "../weather";
import { HOME_TIME_ZONE, isoDay, monthBounds, rangeFor, type TrendRange } from "../dates";

export interface LoaderContext {
  client: SupabaseClient;
  userId: string;
  financials: boolean;
  /** The user may approve expenses (finance.manage_expenses): amounts follow `financials`. */
  isEnabled: (module: string) => boolean;
  params: URLSearchParams;
  now: Date;
}

export class WidgetDataError extends Error {}

type Loader = (ctx: LoaderContext) => Promise<unknown>;

const today = (ctx: LoaderContext) => isoDay(ctx.now, HOME_TIME_ZONE);

async function rows<T = Record<string, unknown>>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new WidgetDataError(error.message);
  return (data ?? []) as T[];
}

async function rpc<T = unknown>(ctx: LoaderContext, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await ctx.client.rpc(fn, args);
  if (error) throw new WidgetDataError(error.message);
  return data as T;
}

// ── Personal ──────────────────────────────────────────────────────────────

const weatherCache = new Map<string, { at: number; value: WeatherReport }>();

async function weather(ctx: LoaderContext): Promise<WeatherReport> {
  const city = cleanCity(ctx.params.get("city")) ?? DEFAULT_CITY;
  const key = city.toLowerCase();
  const cached = weatherCache.get(key);
  if (cached && ctx.now.getTime() - cached.at < WEATHER_CACHE_MS) return cached.value;
  try {
    const signal = AbortSignal.timeout(6000);
    const geo = parseGeocode(await (await fetch(geocodeUrl(city), { signal, cache: "no-store" })).json());
    if (!geo) throw new WidgetDataError("city_not_found");
    const report = parseForecast(await (await fetch(forecastUrl(geo.lat, geo.lon), { signal, cache: "no-store" })).json(), geo, ctx.now);
    if (!report) throw new WidgetDataError("weather_unavailable");
    weatherCache.set(key, { at: ctx.now.getTime(), value: report });
    if (weatherCache.size > 200) weatherCache.delete(weatherCache.keys().next().value as string);
    return report;
  } catch (err) {
    if (cached) return { ...cached.value, stale: true };
    throw err instanceof WidgetDataError ? err : new WidgetDataError("weather_unavailable");
  }
}

/** Days of a month with the user's events or open activities (dots on the month grid). */
async function calendar(ctx: LoaderContext) {
  const month = /^\d{4}-\d{2}$/.test(ctx.params.get("month") ?? "") ? (ctx.params.get("month") as string) : today(ctx).slice(0, 7);
  const { from, to } = monthBounds(month);
  const days: Record<string, { events: number; activities: number }> = {};
  const bump = (day: string, key: "events" | "activities") => {
    days[day] = days[day] ?? { events: 0, activities: 0 };
    days[day][key] += 1;
  };
  const acts = await rows<{ due_date: string }>(
    ctx.client.from("activities").select("due_date").eq("assigned_to", ctx.userId).is("done_at", null).gte("due_date", from).lte("due_date", to)
  );
  for (const a of acts) bump(a.due_date, "activities");
  if (ctx.isEnabled("calendar")) {
    for (const o of await myOccurrences(ctx, new Date(`${from}T00:00:00Z`), new Date(`${to}T23:59:59Z`))) bump(isoDay(o.start, HOME_TIME_ZONE), "events");
  }
  return { month, days, calendarModule: ctx.isEnabled("calendar") };
}

async function myOccurrences(ctx: LoaderContext, from: Date, to: Date) {
  const events = await rows<{ id: string; title: string; start_at: string; end_at: string; all_day: boolean; recurrence: string | null; location: string | null; organizer_id: string | null; calendar_attendees: { user_id: string | null }[] }>(
    ctx.client
      .from("calendar_events")
      .select("id, title, start_at, end_at, all_day, recurrence, location, organizer_id, calendar_attendees(user_id)")
      .lt("start_at", to.toISOString())
      .or(`recurrence.not.is.null,end_at.gte.${from.toISOString()}`)
      .limit(500)
  );
  const mine = events.filter((e) => e.organizer_id === ctx.userId || (e.calendar_attendees ?? []).some((a) => a.user_id === ctx.userId));
  return mine.flatMap((e) =>
    expandOccurrences({ start: new Date(e.start_at), end: new Date(e.end_at), recurrence: e.recurrence, allDay: e.all_day }, from, to, 60).map((o) => ({
      id: e.id,
      title: e.title,
      location: e.location,
      allDay: e.all_day,
      start: o.start,
      end: o.end,
    }))
  );
}

async function agenda(ctx: LoaderContext) {
  const day = today(ctx);
  const from = new Date(`${day}T00:00:00+04:00`);
  const to = new Date(from.getTime() + 24 * 3600_000);
  const items = (await myOccurrences(ctx, from, to))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, 12)
    .map((o) => ({ id: o.id, title: o.title, location: o.location, allDay: o.allDay, start: o.start.toISOString(), end: o.end.toISOString(), href: `/calendar?date=${day}` }));
  return { day, items };
}

async function myActivities(ctx: LoaderContext) {
  const day = today(ctx);
  const list = await rows<{ id: string; summary: string; due_date: string; res_model: string; res_id: string; activity_type: string }>(
    ctx.client.from("activities").select("id, summary, due_date, res_model, res_id, activity_type").eq("assigned_to", ctx.userId).is("done_at", null).order("due_date").limit(200)
  );
  const counts = { overdue: 0, today: 0, planned: 0 };
  for (const a of list) counts[a.due_date < day ? "overdue" : a.due_date === day ? "today" : "planned"] += 1;
  return {
    counts,
    items: list.slice(0, 8).map((a) => ({ ...a, state: a.due_date < day ? "overdue" : a.due_date === day ? "today" : "planned", href: recordHref(a.res_model, a.res_id) })),
  };
}

async function myTodos(ctx: LoaderContext) {
  const day = today(ctx);
  const members = await rows<{ task_id: string; todo_tasks: { id: string; title: string; due_date: string | null; priority: number; done_at: string | null } | null }>(
    ctx.client.from("todo_task_members").select("task_id, todo_tasks(id, title, due_date, priority, done_at)").eq("user_id", ctx.userId).limit(300)
  );
  const items = members
    .map((m) => m.todo_tasks)
    .filter((t): t is NonNullable<typeof t> => !!t && !t.done_at && !!t.due_date && t.due_date <= day)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || b.priority - a.priority)
    .slice(0, 10)
    .map((t) => ({ id: t.id, title: t.title, due_date: t.due_date, priority: t.priority, overdue: (t.due_date ?? "") < day }));
  return { items };
}

/** Tick a to-do: the user's card goes to their own done stage (the database finishes the task). */
export async function finishTodo(ctx: LoaderContext, taskId: string): Promise<void> {
  const stage = await rows<{ id: string }>(ctx.client.from("todo_stages").select("id").eq("user_id", ctx.userId).eq("is_done", true).order("sequence").limit(1));
  if (!stage[0]) throw new WidgetDataError("no_done_stage");
  const { data, error } = await ctx.client.from("todo_task_members").update({ stage_id: stage[0].id }).eq("task_id", taskId).eq("user_id", ctx.userId).select("task_id");
  if (error) throw new WidgetDataError(error.message);
  if (!data?.length) throw new WidgetDataError("not_found");
}

async function approvals(ctx: LoaderContext) {
  const list = await rows<{ id: string; code: string | null; payee: string | null; description: string | null; category: string | null; amount: number; expense_date: string | null; submitted_at: string | null }>(
    ctx.client
      .from("expenses")
      .select("id, code, payee, description, category, amount, expense_date, submitted_at")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true })
      .limit(10)
  );
  const day = today(ctx);
  return {
    count: list.length,
    items: list.map((e) => ({
      id: e.id,
      title: e.description || e.payee || e.code || "—",
      category: e.category,
      submittedToday: (e.submitted_at ?? "").slice(0, 10) === day,
      // Amounts are financial figures: only for users who may see them.
      ...(ctx.financials ? { amount: Number(e.amount) || 0 } : {}),
      href: `/expenses?record=${e.id}`,
    })),
  };
}

async function savedViews(ctx: LoaderContext) {
  const list = await rows<{ id: string; view_key: string; name: string; is_default: boolean }>(
    ctx.client.from("view_favorites").select("id, view_key, name, is_default").order("updated_at", { ascending: false }).limit(20)
  );
  return { items: list.map((f) => ({ id: f.id, name: f.name, viewKey: f.view_key, isDefault: f.is_default, href: savedViewHref(f.view_key) })).filter((f) => f.href).slice(0, 10) };
}

async function recentDocuments(ctx: LoaderContext) {
  const list = await rows<{ id: string; name: string; mime_type: string | null; created_at: string; folder_id: string }>(
    ctx.client.from("documents").select("id, name, mime_type, created_at, folder_id").order("created_at", { ascending: false }).limit(8)
  );
  return { items: list.map((d) => ({ ...d, href: `/documents?folder=${d.folder_id}&document=${d.id}` })) };
}

// ── Operations (no money) ─────────────────────────────────────────────────

async function lowStock(ctx: LoaderContext) {
  const products = await rows<{ id: string; code: string | null; name: string; stock: number | null; min_stock: number | null; min_stock_level: number | null; unit: string | null; is_service: boolean | null }>(
    ctx.client.from("products").select("id, code, name, stock, min_stock, min_stock_level, unit, is_service").limit(3000)
  );
  const low = products
    .filter((p) => !p.is_service && Number(p.min_stock_level ?? p.min_stock) > 0 && Number(p.stock ?? 0) <= Number(p.min_stock_level ?? p.min_stock))
    .map((p) => ({ id: p.id, code: p.code, name: p.name, stock: Number(p.stock ?? 0), min: Number(p.min_stock_level ?? p.min_stock), unit: p.unit, out: Number(p.stock ?? 0) <= 0 }))
    .sort((a, b) => a.stock / a.min - b.stock / b.min);
  return { count: low.length, items: low.slice(0, 8), reorderHref: ctx.isEnabled("purchases") ? "/purchases/new" : null };
}

const CLOSED_PRODUCTION = new Set(["completed", "done", "finished", "cancelled", "canceled", "closed", "delivered"]);

async function productionStatus(ctx: LoaderContext) {
  const list = await rows<{ status: string | null }>(ctx.client.from("production_orders").select("status").limit(5000));
  const byStatus = new Map<string, number>();
  for (const o of list) {
    const s = String(o.status ?? "").toLowerCase() || "unknown";
    if (CLOSED_PRODUCTION.has(s)) continue;
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  return { total: [...byStatus.values()].reduce((a, b) => a + b, 0), statuses: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count) };
}

async function awayToday(ctx: LoaderContext) {
  const day = today(ctx);
  const list = await rows<{ id: string; leave_type: string; start_date: string; end_date: string; status: string; employees: { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null }>(
    ctx.client.from("employee_leaves").select("id, leave_type, start_date, end_date, status, employees(full_name)").lte("start_date", day).gte("end_date", day).limit(50)
  );
  const items = list
    .filter((l) => !["rejected", "cancelled", "canceled", "pending", "draft"].includes(String(l.status).toLowerCase()))
    .map((l) => ({ id: l.id, name: l.employees?.full_name || "—", type: l.leave_type, until: l.end_date }));
  return { count: items.length, items };
}

async function myPipeline(ctx: LoaderContext) {
  const deals = await rows<{ stage: string | null; stage_id?: string | null; type?: string | null }>(
    ctx.client.from("deals").select("*").eq("assigned_to", ctx.userId).limit(1000)
  );
  let stages: { id: string; name: string; color: string; sequence: number; is_won: boolean; is_lost: boolean; code: string }[] = [];
  const res = await ctx.client.from("crm_stages").select("id, code, name, color, sequence, is_won, is_lost").order("sequence");
  if (!res.error) stages = (res.data ?? []) as typeof stages;
  const open = deals.filter((d) => d.type !== "lead");
  if (stages.length) {
    return {
      stages: stages
        .filter((s) => !s.is_lost)
        .map((s) => ({ key: s.id, name: s.name, color: s.color, won: s.is_won, count: open.filter((d) => d.stage_id === s.id || (!d.stage_id && d.stage === s.code)).length })),
    };
  }
  // Classic pipeline (no crm_stages yet): counts per stage code.
  const counts = new Map<string, number>();
  for (const d of open) counts.set(String(d.stage ?? "LEAD"), (counts.get(String(d.stage ?? "LEAD")) ?? 0) + 1);
  return { stages: [...counts.entries()].map(([key, count]) => ({ key, name: null, code: key, color: null, won: key === "WON", count })) };
}

// ── Management (financial: database functions only) ──────────────────────

async function salesMonth(ctx: LoaderContext) {
  const day = today(ctx);
  const { from, to } = monthBounds(day.slice(0, 7));
  const prev = monthBounds(prevMonth(day.slice(0, 7)));
  // Last month up to the same day, so the delta compares like with like.
  const prevTo = clampDay(prev.from, Number(day.slice(8, 10)), prev.to);
  const [cur, last, series] = await Promise.all([
    rpc<Record<string, number>>(ctx, "home_financial_summary", { p_from: from, p_to: day }),
    rpc<Record<string, number>>(ctx, "home_financial_summary", { p_from: prev.from, p_to: prevTo }),
    rpc<{ bucket: string; sales: number; sales_count: number }[]>(ctx, "home_financial_series", { p_from: shiftDays(day, -55), p_to: day, p_bucket: "week" }),
  ]);
  return { from, to, total: cur.sales_total, count: cur.sales_count, previousTotal: last.sales_total, previousCount: last.sales_count, series: series.map((s) => s.sales) };
}

async function revenueTrend(ctx: LoaderContext) {
  const range = (["30d", "90d", "12m"].includes(ctx.params.get("range") ?? "") ? ctx.params.get("range") : "30d") as TrendRange;
  const { from, to, bucket } = rangeFor(range, today(ctx));
  const series = await rpc<{ bucket: string; sales: number; expenses: number }[]>(ctx, "home_financial_series", { p_from: from, p_to: to, p_bucket: bucket });
  return { range, bucket, points: series };
}

async function summaryOfMonth(ctx: LoaderContext) {
  const day = today(ctx);
  const { from } = monthBounds(day.slice(0, 7));
  const prev = monthBounds(prevMonth(day.slice(0, 7)));
  const prevTo = clampDay(prev.from, Number(day.slice(8, 10)), prev.to);
  const [cur, last] = await Promise.all([
    rpc<Record<string, number>>(ctx, "home_financial_summary", { p_from: from, p_to: day }),
    rpc<Record<string, number>>(ctx, "home_financial_summary", { p_from: prev.from, p_to: prevTo }),
  ]);
  return { cur, last };
}

async function netProfit(ctx: LoaderContext) {
  const { cur, last } = await summaryOfMonth(ctx);
  return { value: cur.net_profit, previous: last.net_profit, sales: cur.sales_total, expenses: cur.expenses_total };
}

async function purchasesMonth(ctx: LoaderContext) {
  const { cur, last } = await summaryOfMonth(ctx);
  return { total: cur.purchases_total, count: cur.purchases_count, previousTotal: last.purchases_total };
}

const cashBalances: Loader = (ctx) => rpc(ctx, "home_account_balances").then((accounts) => ({ accounts }));
const receivables: Loader = (ctx) => rpc(ctx, "home_receivables", { p_today: today(ctx), p_top: 5 });
const payablesDue: Loader = (ctx) => rpc(ctx, "home_payables_due", { p_today: today(ctx), p_days: 14 });

function thisMonthToDate(ctx: LoaderContext) {
  const day = today(ctx);
  return { p_from: `${day.slice(0, 7)}-01`, p_to: day };
}

const topCustomers: Loader = (ctx) => rpc(ctx, "home_top_revenue", { p_kind: "customers", p_from: shiftDays(today(ctx), -29), p_to: today(ctx), p_limit: 5 }).then((items) => ({ items }));
const topProducts: Loader = (ctx) => rpc(ctx, "home_top_revenue", { p_kind: "products", p_from: shiftDays(today(ctx), -29), p_to: today(ctx), p_limit: 5 }).then((items) => ({ items }));
const salesBySeller: Loader = (ctx) => rpc(ctx, "home_sales_by_seller", thisMonthToDate(ctx)).then((items) => ({ items }));
const expensesByCategory: Loader = (ctx) => rpc(ctx, "home_expenses_by_category", thisMonthToDate(ctx)).then((items) => ({ items }));
const inventoryValue: Loader = (ctx) => rpc(ctx, "home_inventory_value");
const weekOverWeek: Loader = (ctx) => rpc(ctx, "home_week_over_week", { p_today: today(ctx) });
const crmMoney: Loader = (ctx) => rpc(ctx, "home_crm_money", { p_month: `${today(ctx).slice(0, 7)}-01` });

async function arDiscrepancy(ctx: LoaderContext) {
  const { data, error } = await ctx.client.rpc("check_customer_ar_discrepancies");
  if (error) throw new WidgetDataError(error.message);
  const payload = (data ?? {}) as { discrepancies?: Record<string, unknown>[] };
  const list = (payload.discrepancies ?? []).map((r) => ({
    customerId: String(r.customer_id ?? ""),
    name: String(r.customer_name ?? "—"),
    stored: Number(r.stored_balance) || 0,
    ledger: Number(r.ledger_balance) || 0,
    delta: Number(r.delta) || 0,
  }));
  return { count: list.length, items: list.slice(0, 5) };
}

// ── Dates ─────────────────────────────────────────────────────────────────

function shiftDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
function clampDay(monthFrom: string, day: number, monthTo: string): string {
  const candidate = `${monthFrom.slice(0, 8)}${String(day).padStart(2, "0")}`;
  return candidate > monthTo ? monthTo : candidate;
}

export const LOADERS: Record<string, Loader> = {
  weather,
  calendar,
  agenda,
  my_activities: myActivities,
  my_todos: myTodos,
  approvals,
  saved_views: savedViews,
  recent_documents: recentDocuments,
  low_stock: lowStock,
  production_status: productionStatus,
  away_today: awayToday,
  my_pipeline: myPipeline,
  sales_month: salesMonth,
  revenue_trend: revenueTrend,
  net_profit: netProfit,
  purchases_month: purchasesMonth,
  cash_balances: cashBalances,
  receivables,
  payables_due: payablesDue,
  top_customers: topCustomers,
  top_products: topProducts,
  sales_by_seller: salesBySeller,
  expenses_by_category: expensesByCategory,
  inventory_value: inventoryValue,
  week_over_week: weekOverWeek,
  ar_discrepancy: arDiscrepancy,
  sales_target: crmMoney,
  pipeline_value: crmMoney,
};
