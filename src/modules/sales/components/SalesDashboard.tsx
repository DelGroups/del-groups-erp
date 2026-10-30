"use client";

import React, { useMemo, useState } from "react";
import { ChartCard, MetricCard, RingGauge } from "@/design-system/components";
import { formatFigure } from "@/design-system/logic";
import type { Formatter } from "@/views";
import { salesDashboard, type SaleListRecord } from "../views/sales";
import { dateFormat } from "@/lib/dates/localeDate";

type Range = "3m" | "6m" | "12m";
const RANGE_MONTHS: Record<Range, number> = { "3m": 3, "6m": 6, "12m": 12 };

/**
 * Sales dashboard above the list (new UI): the month's sales with its trend, receivables,
 * drafts and invoices not yet sent to the warehouse. The cards are buttons that filter the
 * list below. Then the payment state ring, paid vs still due per month, and top customers.
 */
export function SalesDashboard({ records, fmt, onFilter }: { records: readonly SaleListRecord[]; fmt: Formatter; onFilter: (filters: string[]) => void }) {
  const { t, locale } = fmt;
  const [now] = useState(() => new Date());
  const [range, setRange] = useState<Range>("6m");
  const d = useMemo(() => salesDashboard(records, now, 8, RANGE_MONTHS[range]), [records, now, range]);
  const money = (n: number) => `${formatFigure(n, 0, locale)} ${t("common.currency")}`;
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return dateFormat(locale, { month: "short" }).format(new Date(y, m - 1, 1));
  };
  const card = (filters: string[], label: string, node: React.ReactNode) => (
    <button type="button" onClick={() => onFilter(filters)} aria-label={label} className="rounded-[var(--ds-radius-xl)] text-left outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2">
      {node}
    </button>
  );
  const totalDue = d.monthly.reduce((s, m) => s + m.remaining, 0);
  const totalPaid = d.monthly.reduce((s, m) => s + m.paid, 0);

  return (
    <section aria-label={t("sales.engine.dashboard.title")} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {card(
          ["posted", "this_month"],
          t("sales.engine.dashboard.showMonth"),
          <MetricCard label={t("sales.engine.dashboard.month")} value={money(d.month.total)} delta={d.month.delta} deltaLabel={t("sales.engine.dashboard.vsLastMonth")} series={d.month.weekly} seriesLabel={t("sales.engine.dashboard.lastWeeks", { count: d.month.weekly.length })} />
        )}
        {card(
          ["posted", "unpaid", "partial"],
          t("sales.engine.dashboard.showReceivables"),
          <MetricCard label={t("sales.engine.dashboard.receivables", { count: d.receivables.count })} value={money(d.receivables.total)} series={d.month.weeklyCount} seriesLabel={t("sales.engine.dashboard.invoicesPerWeek")} />
        )}
        {card(
          ["overdue"],
          t("sales.engine.dashboard.showOverdue"),
          <KpiTile label={t("sales.engine.filters.overdue")} value={formatFigure(d.receivables.overdue, 0, locale)} hint={t("sales.engine.dashboard.overdueHint")} tone={d.receivables.overdue ? "attention" : undefined} />
        )}
        {card(
          d.drafts ? ["draft"] : ["not_sent"],
          d.drafts ? t("sales.engine.dashboard.showDrafts") : t("sales.engine.dashboard.showNotSent"),
          <KpiTile
            label={d.drafts ? t("sales.engine.dashboard.drafts") : t("sales.engine.filters.notSent")}
            value={formatFigure(d.drafts || d.notSent, 0, locale)}
            hint={d.drafts ? t("sales.engine.dashboard.draftsHint", { notSent: d.notSent }) : t("sales.engine.dashboard.notSentHint")}
          />
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,18rem)]">
        <RingGauge
          title={t("sales.engine.dashboard.paidShare")}
          percent={d.payment.paidPercent}
          caption={t("sales.engine.dashboard.paidOf", { paid: d.payment.paid, count: d.payment.paid + d.payment.partial + d.payment.unpaid })}
          explanation={t("sales.engine.dashboard.paidShareHint", { partial: d.payment.partial, unpaid: d.payment.unpaid })}
          tone={d.payment.paidPercent >= 80 ? "good" : d.payment.paidPercent >= 50 ? "neutral" : "attention"}
        />
        <ChartCard
          title={t("sales.engine.dashboard.paidVsDue")}
          total={money(totalPaid + totalDue)}
          ranges={(["3m", "6m", "12m"] as const).map((id) => ({ id, label: t(`sales.engine.dashboard.range.${id}`) }))}
          range={range}
          onRangeChange={setRange}
          columns={d.monthly.map((m) => ({ label: monthLabel(m.key), values: [m.paid, m.remaining] }))}
          series={[t("sales.paid"), t("sales.remaining")]}
          formatValue={money}
          rangeLabel={t("sales.engine.dashboard.rangeLabel")}
        />
        <div className="ds-card ds-card-pad flex flex-col gap-3">
          <h3 className="font-semibold">{t("sales.engine.dashboard.topCustomers")}</h3>
          {d.topCustomers.length === 0 ? (
            <p className="ds-muted">{t("views.empty")}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {d.topCustomers.map((c, i) => {
                const share = d.topCustomers[0].total > 0 ? (c.total / d.topCustomers[0].total) * 100 : 0;
                return (
                  <li key={`${c.name}-${i}`} className="flex flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate">
                        <span className="ds-mono ds-subtle mr-1.5">{i + 1}</span>
                        {c.name || t("common.anonymousCustomer")}
                      </span>
                      <span className="ds-mono text-[length:var(--ds-text-xs)]">{money(c.total)}</span>
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--ds-track)" }} aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${share}%`, background: "var(--ds-chart-1)" }} />
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="ds-subtle text-[length:var(--ds-text-xs)]">{t("sales.engine.dashboard.last12Months")}</p>
        </div>
      </div>
    </section>
  );
}

function KpiTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "attention" }) {
  return (
    <div className="ds-card ds-card-pad flex h-full flex-col gap-3">
      <span className="ds-muted">{label}</span>
      <span className="text-[length:var(--ds-text-2xl)] font-semibold tracking-tight ds-mono" style={tone ? { color: "var(--ds-warning)" } : undefined}>
        {value}
      </span>
      <span className="mt-auto ds-subtle text-[length:var(--ds-text-xs)]">{hint}</span>
    </div>
  );
}
