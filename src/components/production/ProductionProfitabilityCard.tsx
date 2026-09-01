"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  calcProductionCosting,
  normalizeProductionStatus,
  PRODUCTION_STATUSES,
  normalizeStatus,
  type ProductionHealth,
  type ProductionCosting,
  type ProductionOrder,
  type ProductionStatus,
} from "@/lib/production/types";

const HEALTH_CLASS: Record<ProductionHealth, string> = {
  healthy: "bg-emerald-500/15 text-emerald-400",
  tight: "bg-rose-500/15 text-rose-400",
  loss: "bg-rose-500/15 text-rose-400",
  pending: "bg-app-card-hover text-app-muted",
};

const STATUS_CLASS: Record<ProductionStatus, string> = {
  Draft: "bg-slate-500/15 text-slate-300",
  "In-Progress": "bg-sky-500/15 text-sky-300",
  Ready: "bg-indigo-500/15 text-indigo-300",
  Delivered: "bg-emerald-500/15 text-emerald-300",
};

export function money(value: number, currency: string) {
  return `${value.toFixed(2)} ${currency}`;
}

export function ProductionStatusChip({ status }: { status: ProductionStatus | string }) {
  const { t } = useI18n();
  const normalized = normalizeProductionStatus(status);
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[normalized]}`}>
      {t(`production.status.${normalized}`)}
    </span>
  );
}

export function ProductionStatusSelect({
  value,
  onChange,
  disabled,
  allowed,
  className = "mt-1 w-full rounded-lg border border-app bg-app px-3 py-2",
}: {
  value: ProductionStatus | string;
  onChange: (status: ProductionStatus) => void;
  disabled?: boolean;
  allowed?: readonly ProductionStatus[];
  className?: string;
}) {
  const { t } = useI18n();
  const normalized = normalizeProductionStatus(value);
  return (
    <select
      className={className}
      value={normalized}
      disabled={disabled}
      onChange={(e) => onChange(normalizeStatus(e.target.value) as ProductionStatus)}
    >
      {PRODUCTION_STATUSES.map((status) => (
        <option key={status} value={status} disabled={allowed ? !allowed.includes(status) : false}>
          {t(`production.status.${status}`)}
        </option>
      ))}
    </select>
  );
}

export function ProductionHealthChip({ health }: { health: ProductionHealth }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${HEALTH_CLASS[health]}`}>
      {t(`production.health.${health}`)}
    </span>
  );
}

function ProductionProfitabilityCard({
  order,
  compact,
  costing: providedCosting,
}: {
  order: ProductionOrder;
  compact?: boolean;
  costing?: ProductionCosting;
}) {
  const { t } = useI18n();
  const costing = React.useMemo(
    () => providedCosting || calcProductionCosting(order),
    [order, providedCosting]
  );
  const currency = t("common.currency");

  if (compact) {
    return (
      <div className="mt-2 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <ProductionStatusChip status={order.status} />
          <ProductionHealthChip health={costing.health} />
        </div>
        <p className="text-xs font-semibold text-app">
          {t("production.revenue")}: {money(costing.revenue, currency)}
        </p>
        <p className={`text-xs font-semibold ${costing.health === "healthy" ? "text-emerald-400" : "text-rose-400"}`}>
          {t("production.profit")}: {money(costing.profit, currency)} · {costing.marginPercent.toFixed(1)}%
        </p>
      </div>
    );
  }

  const rows: { label: string; value: number; muted?: boolean }[] = [
    { label: t("production.projectRevenue"), value: costing.projectPrice },
    { label: t("production.installationFee"), value: costing.installationFee },
    { label: t("production.materialCost"), value: costing.materialCost },
    { label: t("production.outsourcingCost"), value: costing.outsourcingCost },
    { label: t("production.sideExpenseCost"), value: costing.sideExpenseCost },
    { label: t("production.contractorFee"), value: costing.contractorFee },
  ];

  return (
    <section className="app-card p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-app">{t("production.profitability")}</h3>
          <p className="text-xs text-app-muted">{t("production.profitabilityHint")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ProductionStatusChip status={order.status} />
          <ProductionHealthChip health={costing.health} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label={t("production.revenue")}
          value={money(costing.revenue, currency)}
          sublabel={t("production.invoiceToClient")}
        />
        <SummaryTile
          label={t("production.totalCost")}
          value={money(costing.totalCost, currency)}
          sublabel={t("production.costBreakdown")}
        />
        <SummaryTile
          label={t("production.profit")}
          value={money(costing.profit, currency)}
          emphasize={costing.profit >= 0 ? "good" : "bad"}
        />
        <SummaryTile
          label={t("production.margin")}
          value={`${costing.marginPercent.toFixed(1)}%`}
          emphasize={costing.health === "healthy" ? "good" : costing.health === "pending" ? "warn" : "bad"}
        />
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between rounded-lg bg-app-card-hover/60 px-3 py-2 text-sm">
            <dt className="text-app-muted">{row.label}</dt>
            <dd className="font-mono font-semibold text-app">{money(row.value, currency)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default React.memo(ProductionProfitabilityCard);

function SummaryTile({
  label,
  value,
  sublabel,
  emphasize,
}: {
  label: string;
  value: string;
  sublabel?: string;
  emphasize?: "good" | "bad" | "warn";
}) {
  const color =
    emphasize === "good"
      ? "text-emerald-400"
      : emphasize === "bad"
        ? "text-rose-400"
        : emphasize === "warn"
          ? "text-amber-400"
          : "text-app";
  return (
    <div className="rounded-xl border border-app bg-app-surface p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-app-muted">{label}</p>
      <p className={`mt-1 font-mono text-xl font-bold ${color}`}>{value}</p>
      {sublabel && <p className="mt-1 text-[11px] text-app-muted">{sublabel}</p>}
    </div>
  );
}
