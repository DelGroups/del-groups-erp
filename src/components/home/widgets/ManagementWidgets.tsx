"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, BadgeCheck, Banknote, Boxes, ChartColumn, Minus, Scale, Target, Trophy, Wallet } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { CountUp, DeltaChip, FunnelSteps, GoalProgress } from "@/design-system/components";
import { transitions } from "@/design-system/motion";
import { deltaPercent, type TrendRange } from "@/lib/home/dates";
import { useAuth } from "@/components/auth/AuthProvider";
import { reconcileCustomerArBalancesAction } from "@/lib/actions/customerAr";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { WidgetFrame, WidgetState } from "../WidgetFrame";
import { useWidgetData } from "../useWidgetData";
import { useFigures } from "./format";
import { frameProps, type WidgetProps } from "./types";
import { dateFormat } from "@/lib/dates/localeDate";

/** A big figure with its delta against the previous period. */
function Headline({ value, previous, money, label }: { value: number; previous?: number | null; money: (n: number) => string; label?: string }) {
  const delta = previous === undefined || previous === null ? null : deltaPercent(value, previous);
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono">{money(value)}</span>
      {delta !== null ? <DeltaChip delta={delta} label={label} /> : null}
    </div>
  );
}

/** Small bars (sparkline), the last one in brand colour. */
function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const reduced = useReducedMotion();
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <div className="mt-3 flex h-10 items-end gap-1" role="img" aria-label={label}>
      {values.map((v, i) => (
        <motion.span
          key={i}
          className="flex-1 rounded-sm"
          style={{ background: i === values.length - 1 ? "var(--ds-brand)" : "var(--ds-brand-soft)" }}
          initial={reduced ? false : { height: 0 }}
          animate={{ height: `${Math.max(6, (Math.abs(v) / max) * 100)}%` }}
          transition={transitions.base}
        />
      ))}
    </div>
  );
}

const status = (p: WidgetProps, q: { status: "pending" | "error" | "success" }) => (p.preview ? "success" : q.status);

// ── Sales this month ────────────────────────────────────────────────────

interface SalesMonthData {
  total: number;
  count: number;
  previousTotal: number;
  previousCount: number;
  series: number[];
}

export function SalesMonthWidget(props: WidgetProps) {
  const { t, money, locale } = useFigures();
  const q = useWidgetData<SalesMonthData>("sales_month", {}, !props.preview);
  const d = q.data?.data ?? { total: 0, count: 0, previousTotal: 0, previousCount: 0, series: [3, 5, 4, 6, 5, 7, 6, 8] };
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} emptyIcon={ChartColumn} emptyTitle={t("home.empty.figures")}>
        <Headline value={d.total} previous={d.previousTotal} money={money} label={t("home.vsLastMonth")} />
        <p className="ds-muted">
          <CountUp value={d.count} locale={locale} /> {t("home.sales.documents")} · <span className="ds-subtle">{t("home.vsLastMonthToDate")}</span>
        </p>
        {props.placement.size !== "S" ? <Sparkline values={d.series} label={t("home.sales.weeks")} /> : null}
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Revenue vs expenses ─────────────────────────────────────────────────

interface TrendData {
  range: TrendRange;
  bucket: "day" | "week" | "month";
  points: { bucket: string; sales: number; expenses: number }[];
}

const RANGES: TrendRange[] = ["30d", "90d", "12m"];

export function RevenueTrendWidget(props: WidgetProps) {
  const { t, money, locale } = useFigures();
  const reduced = useReducedMotion();
  const [range, setRange] = useState<TrendRange>((props.placement.settings?.range as TrendRange) || "30d");
  const q = useWidgetData<TrendData>("revenue_trend", { range }, !props.preview);
  const points = q.data?.data.points ?? [];
  const max = Math.max(1, ...points.flatMap((p) => [p.sales, p.expenses]));
  const totals = points.reduce((s, p) => ({ sales: s.sales + p.sales, expenses: s.expenses + p.expenses }), { sales: 0, expenses: 0 });
  const label = (iso: string) =>
    dateFormat(locale, q.data?.data.bucket === "month" ? { month: "short" } : { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00`));
  const choose = (r: TrendRange) => {
    setRange(r);
    props.setSettings({ ...(props.placement.settings ?? {}), range: r });
  };
  return (
    <WidgetFrame
      {...frameProps(props)}
      action={
        <div role="radiogroup" aria-label={t("home.trend.range")} className="inline-flex gap-0.5 p-0.5" style={{ background: "var(--ds-surface-sunken)", borderRadius: "var(--ds-radius-md)" }}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={r === range}
              onClick={() => choose(r)}
              className="ds-btn ds-btn-sm"
              style={r === range ? { background: "var(--ds-surface)", boxShadow: "var(--ds-elevation-1)" } : { background: "transparent", borderColor: "transparent" }}
            >
              {t(`home.trend.${r}`)}
            </button>
          ))}
        </div>
      }
    >
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty={!props.preview && !points.some((p) => p.sales || p.expenses)} emptyIcon={ChartColumn} emptyTitle={t("home.empty.figures")}>
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <div>
            <dt className="flex items-center gap-1.5 text-[length:var(--ds-text-xs)] ds-muted"><span className="h-2 w-2 rounded-full" style={{ background: "var(--ds-brand)" }} aria-hidden />{t("home.trend.revenue")}</dt>
            <dd className="font-semibold ds-mono">{money(totals.sales)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[length:var(--ds-text-xs)] ds-muted"><span className="h-2 w-2 rounded-full" style={{ background: "var(--ds-danger)" }} aria-hidden />{t("home.trend.expenses")}</dt>
            <dd className="font-semibold ds-mono">{money(totals.expenses)}</dd>
          </div>
        </dl>
        <div
          className={`mt-3 flex items-end gap-px ${props.placement.size === "L" ? "h-40" : "h-24"}`}
          role="img"
          aria-label={`${t("home.trend.chart")}: ${points.map((p) => `${label(p.bucket)} ${money(p.sales)} / ${money(p.expenses)}`).join(", ")}`}
        >
          {points.map((p) => (
            <div key={p.bucket} className="flex h-full flex-1 items-end justify-center gap-px" title={`${label(p.bucket)}: ${money(p.sales)} · ${money(p.expenses)}`}>
              {(["sales", "expenses"] as const).map((k) => (
                <motion.span
                  key={k}
                  className="w-1/2 max-w-3 rounded-t-sm"
                  style={{ background: k === "sales" ? "var(--ds-brand)" : "var(--ds-danger)", opacity: k === "sales" ? 1 : 0.75 }}
                  initial={reduced ? false : { height: 0 }}
                  animate={{ height: `${(p[k] / max) * 100}%` }}
                  transition={transitions.base}
                />
              ))}
            </div>
          ))}
        </div>
        {points.length ? (
          <div className="mt-1 flex justify-between text-[length:var(--ds-text-xs)] ds-subtle" aria-hidden>
            <span>{label(points[0].bucket)}</span>
            <span>{label(points[points.length - 1].bucket)}</span>
          </div>
        ) : null}
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Single figures: net profit, purchases, inventory value ─────────────

export function NetProfitWidget(props: WidgetProps) {
  const { t, money } = useFigures();
  const q = useWidgetData<{ value: number; previous: number; sales: number; expenses: number }>("net_profit", {}, !props.preview);
  const d = q.data?.data ?? { value: 0, previous: 0, sales: 0, expenses: 0 };
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} emptyIcon={Scale} emptyTitle={t("home.empty.figures")}>
        <span className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono" style={{ color: d.value < 0 ? "var(--ds-danger-strong)" : undefined }}>{money(d.value)}</span>
        <p className="text-[length:var(--ds-text-xs)] ds-muted">{t("home.profit.formula", { sales: money(d.sales), expenses: money(d.expenses) })}</p>
      </WidgetState>
    </WidgetFrame>
  );
}

export function PurchasesMonthWidget(props: WidgetProps) {
  const { t, money, locale } = useFigures();
  const q = useWidgetData<{ total: number; count: number; previousTotal: number }>("purchases_month", {}, !props.preview);
  const d = q.data?.data ?? { total: 0, count: 0, previousTotal: 0 };
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} emptyIcon={Banknote} emptyTitle={t("home.empty.figures")}>
        <Headline value={d.total} previous={d.previousTotal} money={money} label={t("home.vsLastMonth")} />
        <p className="ds-muted"><CountUp value={d.count} locale={locale} /> {t("home.purchases.documents")}</p>
      </WidgetState>
    </WidgetFrame>
  );
}

export function InventoryValueWidget(props: WidgetProps) {
  const { t, money, locale } = useFigures();
  const q = useWidgetData<{ value: number; products: number }>("inventory_value", {}, !props.preview);
  const d = q.data?.data ?? { value: 0, products: 0 };
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} emptyIcon={Boxes} emptyTitle={t("home.empty.figures")}>
        <span className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono">{money(d.value)}</span>
        <p className="ds-muted"><CountUp value={d.products} locale={locale} /> {t("home.inventory.products")}</p>
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Cash and bank ───────────────────────────────────────────────────────

export function CashBalancesWidget(props: WidgetProps) {
  const { t, money } = useFigures();
  const q = useWidgetData<{ accounts: { id: string; name: string; type: string | null; balance: number }[] }>("cash_balances", {}, !props.preview);
  const accounts = q.data?.data.accounts ?? [];
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  return (
    <WidgetFrame {...frameProps(props)} action={<Link href="/dashboard/payments" className="ds-btn ds-btn-ghost ds-btn-sm">{t("home.cash.open")}</Link>}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty={!props.preview && !accounts.length} emptyIcon={Wallet} emptyTitle={t("home.empty.accounts")}>
        <span className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono">{money(total)}</span>
        <ul className="mt-2 flex flex-col">
          {accounts.slice(0, props.placement.size === "L" ? 12 : 6).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-1.5" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="shrink-0 ds-mono" style={{ color: a.balance < 0 ? "var(--ds-danger-strong)" : undefined }}>{money(a.balance)}</span>
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Receivables (ageing) and payables due ──────────────────────────────

const AGE_COLORS = ["var(--ds-success)", "var(--ds-warning)", "#f97316", "var(--ds-danger)"];

export function ReceivablesWidget(props: WidgetProps) {
  const { t, money } = useFigures();
  const q = useWidgetData<{ total: number; buckets: { bucket: string; amount: number; count: number }[]; top: { customer_id: string | null; name: string; amount: number }[] }>("receivables", {}, !props.preview);
  const d = q.data?.data;
  const total = d?.total ?? 0;
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty={!props.preview && !total} emptyIcon={BadgeCheck} emptyTitle={t("home.empty.receivables")}>
        <span className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono">{money(total)}</span>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full" aria-hidden>
          {(d?.buckets ?? []).map((b, i) => (b.amount ? <span key={b.bucket} style={{ flex: b.amount, background: AGE_COLORS[i] }} /> : null))}
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[length:var(--ds-text-xs)] sm:grid-cols-4">
          {(d?.buckets ?? []).map((b, i) => (
            <div key={b.bucket}>
              <dt className="flex items-center gap-1 ds-muted"><span className="h-2 w-2 rounded-full" style={{ background: AGE_COLORS[i] }} aria-hidden />{t(`home.receivables.${b.bucket}`)}</dt>
              <dd className="ds-mono">{money(b.amount)}</dd>
            </div>
          ))}
        </dl>
        {props.placement.size !== "S" && d?.top.length ? (
          <>
            <h3 className="mt-3 text-[length:var(--ds-text-xs)] ds-muted">{t("home.receivables.top")}</h3>
            <ol className="flex flex-col">
              {d.top.map((c) => (
                <li key={c.customer_id ?? c.name} className="flex items-center justify-between gap-2 py-1" style={{ borderTop: "1px solid var(--ds-border)" }}>
                  {c.customer_id ? <Link href={`/customers?record=${c.customer_id}`} className="min-w-0 truncate hover:underline">{c.name}</Link> : <span className="min-w-0 truncate">{c.name}</span>}
                  <span className="shrink-0 ds-mono">{money(c.amount)}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </WidgetState>
    </WidgetFrame>
  );
}

export function PayablesDueWidget(props: WidgetProps) {
  const { t, money, locale } = useFigures();
  const q = useWidgetData<{ due_total: number; overdue_total: number; items: { id: string; number: string; supplier: string | null; due_date: string; amount: number }[] }>("payables_due", {}, !props.preview);
  const d = q.data?.data;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty={!props.preview && !d?.items.length} emptyIcon={BadgeCheck} emptyTitle={t("home.empty.payables")}>
        <dl className="flex flex-wrap gap-x-6">
          <div><dt className="text-[length:var(--ds-text-xs)] ds-muted">{t("home.payables.next14")}</dt><dd className="text-[length:var(--ds-text-xl)] font-semibold ds-mono">{money(d?.due_total ?? 0)}</dd></div>
          {d?.overdue_total ? <div><dt className="text-[length:var(--ds-text-xs)] ds-muted">{t("home.payables.overdue")}</dt><dd className="text-[length:var(--ds-text-xl)] font-semibold ds-mono" style={{ color: "var(--ds-danger-strong)" }}>{money(d.overdue_total)}</dd></div> : null}
        </dl>
        <ul className="mt-2 flex flex-col">
          {(d?.items ?? []).slice(0, props.placement.size === "L" ? 10 : 5).map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <Link href={`/purchases/${p.id}`} className="min-w-0 flex-1 truncate hover:underline">{p.supplier ?? p.number}</Link>
              <span className="shrink-0 text-[length:var(--ds-text-xs)]" style={{ color: p.due_date < today ? "var(--ds-danger-strong)" : undefined }}>
                {dateFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${p.due_date}T12:00:00`))}
              </span>
              <span className="shrink-0 ds-mono">{money(p.amount)}</span>
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Leaderboards (stats-leaderboard-with-rank-movement) ────────────────

interface Ranked {
  key: string | null;
  name: string;
  amount: number;
  rank: number;
  previous_rank: number | null;
}

function Movement({ rank, previous }: { rank: number; previous: number | null }) {
  const { t } = useFigures();
  if (previous === null) return <span className="ds-chip">{t("home.rank.new")}</span>;
  const diff = previous - rank;
  if (diff === 0) return <Minus className="h-3.5 w-3.5 ds-subtle" aria-label={t("home.rank.same")} />;
  const Icon = diff > 0 ? ArrowUp : ArrowDown;
  return (
    <span className="flex items-center text-[length:var(--ds-text-xs)]" style={{ color: diff > 0 ? "var(--ds-success-strong, var(--ds-success))" : "var(--ds-danger-strong)" }} aria-label={t(diff > 0 ? "home.rank.up" : "home.rank.down", { n: Math.abs(diff) })}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(diff)}
    </span>
  );
}

function Leaderboard({ id, props, hrefFor }: { id: "top_customers" | "top_products"; props: WidgetProps; hrefFor: (key: string | null) => string | null }) {
  const { t, money } = useFigures();
  const q = useWidgetData<{ items: Ranked[] }>(id, {}, !props.preview);
  const items = q.data?.data.items ?? [];
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty={!props.preview && !items.length} emptyIcon={Trophy} emptyTitle={t("home.empty.figures")}>
        <p className="mb-1 text-[length:var(--ds-text-xs)] ds-subtle">{t("home.rank.period")}</p>
        <ol className="flex flex-col gap-1.5">
          {items.map((i) => {
            const href = hrefFor(i.key);
            return (
              <li key={`${i.key}-${i.rank}`} className="grid grid-cols-[1.5rem_1fr_auto_2.5rem] items-center gap-2">
                <span className="text-center font-semibold ds-mono" aria-label={t("home.rank.place", { n: i.rank })}>{i.rank}</span>
                <div className="min-w-0">
                  {href ? <Link href={href} className="block truncate hover:underline">{i.name}</Link> : <span className="block truncate">{i.name}</span>}
                  <span className="mt-0.5 block h-1 rounded-full" style={{ width: `${(i.amount / max) * 100}%`, background: "var(--ds-brand)" }} aria-hidden />
                </div>
                <span className="ds-mono text-[length:var(--ds-text-sm)]">{money(i.amount)}</span>
                <span className="flex justify-end"><Movement rank={i.rank} previous={i.previous_rank} /></span>
              </li>
            );
          })}
        </ol>
      </WidgetState>
    </WidgetFrame>
  );
}

export const TopCustomersWidget = (props: WidgetProps) => <Leaderboard id="top_customers" props={props} hrefFor={(k) => (k ? `/customers?record=${k}` : null)} />;
export const TopProductsWidget = (props: WidgetProps) => <Leaderboard id="top_products" props={props} hrefFor={(k) => (k && /^[0-9a-f-]{36}$/i.test(k) ? `/products/${k}` : null)} />;

// ── Sales by salesperson, expenses by category ──────────────────────────

function BarList({ props, id, emptyIcon }: { props: WidgetProps; id: "sales_by_seller" | "expenses_by_category"; emptyIcon: typeof Wallet }) {
  const { t, money, count } = useFigures();
  const q = useWidgetData<{ items: { name?: string; category?: string; amount: number; count: number }[] }>(id, {}, !props.preview);
  const items = q.data?.data.items ?? [];
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty={!props.preview && !items.length} emptyIcon={emptyIcon} emptyTitle={t("home.empty.figures")}>
        <ul className="flex flex-col gap-2">
          {items.slice(0, props.placement.size === "L" ? 12 : 6).map((i) => (
            <li key={i.name ?? i.category} className="flex flex-col gap-1">
              <div className="flex justify-between gap-2 text-[length:var(--ds-text-sm)]">
                <span className="min-w-0 truncate">{i.name ?? i.category}</span>
                <span className="shrink-0 ds-mono">{money(i.amount)} <span className="ds-subtle">· {count(i.count)}</span></span>
              </div>
              <span className="h-1.5 rounded-full" style={{ width: `${(i.amount / max) * 100}%`, background: id === "expenses_by_category" ? "var(--ds-danger)" : "var(--ds-brand)" }} aria-hidden />
            </li>
          ))}
        </ul>
      </WidgetState>
    </WidgetFrame>
  );
}

export const SalesBySellerWidget = (props: WidgetProps) => <BarList props={props} id="sales_by_seller" emptyIcon={Trophy} />;
export const ExpensesByCategoryWidget = (props: WidgetProps) => <BarList props={props} id="expenses_by_category" emptyIcon={Wallet} />;

// ── Week over week (stats-week-over-week-delta-table) ──────────────────

const WOW_ROWS = [
  { key: "sales_total", money: true },
  { key: "purchases_total", money: true },
  { key: "expenses_total", money: true },
  { key: "new_customers", money: false },
] as const;

export function WeekOverWeekWidget(props: WidgetProps) {
  const { t, money, count } = useFigures();
  const q = useWidgetData<{ current: Record<string, number>; previous: Record<string, number> }>("week_over_week", {}, !props.preview);
  const d = q.data?.data;
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} emptyIcon={ChartColumn} emptyTitle={t("home.empty.figures")}>
        <table className="w-full border-collapse text-[length:var(--ds-text-sm)]">
          <thead>
            <tr>
              <th scope="col" className="py-1 text-start ds-label"><span className="sr-only">{t("home.wow.metric")}</span></th>
              <th scope="col" className="py-1 text-end ds-label">{t("home.wow.thisWeek")}</th>
              <th scope="col" className="py-1 text-end ds-label">{t("home.wow.lastWeek")}</th>
              <th scope="col" className="py-1 text-end ds-label">{t("home.wow.change")}</th>
            </tr>
          </thead>
          <tbody>
            {WOW_ROWS.map((r) => {
              const cur = Number(d?.current[r.key] ?? 0);
              const prev = Number(d?.previous[r.key] ?? 0);
              const delta = deltaPercent(cur, prev);
              const fmt = r.money ? money : count;
              // More expenses is not good news: flip the colour (not the number).
              const good = r.key === "expenses_total" ? (delta ?? 0) <= 0 : (delta ?? 0) >= 0;
              return (
                <tr key={r.key} style={{ borderTop: "1px solid var(--ds-border)" }}>
                  <th scope="row" className="py-1.5 text-start font-normal">{t(`home.wow.${r.key}`)}</th>
                  <td className="py-1.5 text-end ds-mono">{fmt(cur)}</td>
                  <td className="py-1.5 text-end ds-mono ds-subtle">{fmt(prev)}</td>
                  <td className="py-1.5 text-end ds-mono" style={{ color: delta === null ? undefined : good ? "var(--ds-success-strong, var(--ds-success))" : "var(--ds-danger-strong)" }}>
                    {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </WidgetState>
    </WidgetFrame>
  );
}

// ── Customer balance discrepancy (moved from the classic dashboard) ────

export function ArDiscrepancyWidget(props: WidgetProps) {
  const { t, money } = useFigures();
  const { can } = useAuth();
  const q = useWidgetData<{ count: number; items: { customerId: string; name: string; stored: number; ledger: number; delta: number }[] }>("ar_discrepancy", {}, !props.preview);
  const d = q.data?.data;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const canFix = can("can_manage_finance") || can("can_edit_sales") || can("can_manage_settings");
  const fix = async () => {
    setBusy(true);
    setFailed(null);
    const result = await reconcileCustomerArBalancesAction();
    setBusy(false);
    if (!result.success) setFailed(formatRpcError(result.error, t) || t("dashboard.arReconcileFailed"));
    void q.refetch();
  };
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty={!props.preview && !d?.count} emptyIcon={BadgeCheck} emptyTitle={t("home.empty.arOk")}>
        <p className="mb-2" style={{ color: "var(--ds-warning-strong, var(--ds-warning))" }}>{t("dashboard.arDiscrepancySummary", { count: d?.count ?? 0 })}</p>
        <ul className="flex flex-col">
          {(d?.items ?? []).map((r) => (
            <li key={r.customerId} className="flex flex-col py-1.5 text-[length:var(--ds-text-xs)]" style={{ borderTop: "1px solid var(--ds-border)" }}>
              <Link href={`/customers?record=${r.customerId}`} className="font-medium hover:underline">{r.name}</Link>
              <span className="ds-muted">{t("home.ar.row", { stored: money(r.stored, 2), ledger: money(r.ledger, 2), delta: money(r.delta, 2) })}</span>
            </li>
          ))}
        </ul>
        {canFix ? (
          <button type="button" className="ds-btn ds-btn-sm mt-2 self-start" disabled={busy} onClick={() => void fix()}>
            {t("dashboard.arReconcileButton")}
          </button>
        ) : null}
        {failed ? <p role="alert" className="mt-1 text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>{failed}</p> : null}
      </WidgetState>
    </WidgetFrame>
  );
}

// ── CRM: target progress and pipeline value (NEW_CRM) ──────────────────

interface CrmMoney {
  available: boolean;
  stages: { stage_id: string; name: string; color: string; count: number; value: number; weighted: number }[];
  targets: { team_id: string; user_id: string | null; target: number; won: number }[];
}

export function SalesTargetWidget(props: WidgetProps) {
  const { t, money } = useFigures();
  const q = useWidgetData<CrmMoney>("sales_target", {}, !props.preview);
  const targets = q.data?.data.targets ?? [];
  const now = new Date();
  const elapsed = now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (!props.preview && q.status === "success" && targets.length) {
    return (
      <WidgetFrame {...frameProps(props)} bare>
        <GoalProgress
          title={t(props.def.titleKey)}
          goals={targets.map((g, i) => ({ label: g.user_id ? t("home.target.person", { n: i + 1 }) : t("home.target.team"), current: g.won, target: g.target }))}
          periodElapsed={elapsed}
          formatValue={(n) => money(n)}
          statusLabels={{ done: t("crm.pipeline.reports.targetDone"), onTrack: t("crm.pipeline.reports.targetOnTrack"), behind: t("crm.pipeline.reports.targetBehind") }}
        />
      </WidgetFrame>
    );
  }
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty emptyIcon={Target} emptyTitle={t("home.empty.targets")} emptyHint={t("home.empty.targetsHint")} />
    </WidgetFrame>
  );
}

export function PipelineValueWidget(props: WidgetProps) {
  const { t, count, money } = useFigures();
  const q = useWidgetData<CrmMoney>("pipeline_value", {}, !props.preview);
  const stages = q.data?.data.stages ?? [];
  const weighted = stages.reduce((s, x) => s + x.weighted, 0);
  if (!props.preview && q.status === "success" && stages.some((s) => s.count)) {
    return (
      <WidgetFrame {...frameProps(props)} bare>
        <FunnelSteps
          title={t(props.def.titleKey)}
          subtitle={t("home.pipelineValue.weighted", { value: money(weighted) })}
          steps={stages.map((s) => ({ label: `${s.name} · ${money(s.value)}`, count: s.count }))}
          formatCount={count}
          labels={{
            dropped: (c, p) => t("crm.pipeline.reports.dropped", { count: c, percent: p }),
            entered: t("crm.pipeline.reports.entered"),
            completed: t("crm.pipeline.reports.completed"),
            conversion: t("crm.pipeline.reports.conversion"),
          }}
        />
      </WidgetFrame>
    );
  }
  return (
    <WidgetFrame {...frameProps(props)}>
      <WidgetState status={status(props, q)} onRetry={() => void q.refetch()} empty emptyIcon={Target} emptyTitle={t("home.empty.pipelineValue")} />
    </WidgetFrame>
  );
}
