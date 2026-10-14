"use client";

import React, { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { CountUp } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_REPORT_FILTERS } from "@/lib/reports/dateRange";
import { fetchReportFilterOptions } from "@/lib/reports/fetchFilterOptions";
import type { ReportDatePreset, ReportFilters } from "@/types/database.types";
import { useFilterContext, useFormatter, useViewAccess, ViewEngine, ViewScope, type ViewData } from "@/views";
import { fetchSalesReport } from "../lib/fetchSalesReport";
import { reportRecords, salesReportDefinition, type ReportProductRecord } from "../views/sales";

const DEFINITION = salesReportDefinition();
const PRESETS: readonly ReportDatePreset[] = ["today", "week", "month", "custom"];

/**
 * Sales report on the view engine (new UI): the same figures as the classic report
 * (fetchSalesReport, same filters), as KPI cards and a top-products list with pivot and graph
 * by category and Excel export.
 */
export default function SalesReportScreen() {
  return (
    <ViewScope>
      <ReportBody />
    </ViewScope>
  );
}

function ReportBody() {
  const { t } = useI18n();
  const fmt = useFormatter();
  const ctx = useFilterContext();
  const access = useViewAccess(DEFINITION);
  const allowed = access.ready && access.read;
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const options = useQuery({ queryKey: ["reports", "filter-options"], queryFn: fetchReportFilterOptions, enabled: allowed });
  const report = useQuery({ queryKey: ["views", DEFINITION.model.key, "rows", filters], queryFn: () => fetchSalesReport(filters), enabled: allowed });
  const records = useMemo(() => reportRecords(report.data?.topProducts ?? []), [report.data]);
  const data: ViewData<ReportProductRecord> = {
    status: !access.ready ? "loading" : !access.read ? "forbidden" : report.isError ? "error" : report.data ? "ready" : "loading",
    definition: DEFINITION,
    records,
    capped: false,
    canWrite: false,
    error: report.error ? report.error.message : null,
    refetch: () => void report.refetch(),
  };
  const s = report.data?.summary;
  const set = (patch: Partial<ReportFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales" className="inline-flex items-center gap-1 self-start text-[length:var(--ds-text-xs)] font-semibold" style={{ color: "var(--ds-brand)" }}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t("sales.title")}
      </Link>

      <form className="ds-card ds-card-pad flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()} aria-label={t("sales.engine.report.filters")}>
        <fieldset className="flex flex-col gap-1">
          <legend className="ds-label">{t("sales.engine.report.period")}</legend>
          <div role="radiogroup" aria-label={t("sales.engine.report.period")} className="flex rounded-[var(--ds-radius-md)] border p-0.5" style={{ borderColor: "var(--ds-border)", background: "var(--ds-surface-sunken)" }}>
            {PRESETS.map((p, i) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={filters.datePreset === p}
                tabIndex={filters.datePreset === p ? 0 : -1}
                data-preset={p}
                onClick={() => set({ datePreset: p })}
                onKeyDown={(e) => {
                  const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!dir) return;
                  e.preventDefault();
                  const next = PRESETS[(i + dir + PRESETS.length) % PRESETS.length];
                  set({ datePreset: next });
                  (e.currentTarget.parentElement?.querySelector(`[data-preset="${next}"]`) as HTMLElement | null)?.focus();
                }}
                className="h-7 rounded-[var(--ds-radius-sm)] px-3 text-[length:var(--ds-text-xs)] font-semibold"
                style={filters.datePreset === p ? { background: "var(--ds-surface)", boxShadow: "var(--ds-elevation-1)" } : undefined}
              >
                {t(`sales.engine.report.presets.${p}`)}
              </button>
            ))}
          </div>
        </fieldset>
        {filters.datePreset === "custom" ? (
          <>
            <Field label={t("sales.engine.report.from")}>{(id) => <input id={id} type="date" className="ds-input" value={filters.startDate} onChange={(e) => set({ startDate: e.target.value })} />}</Field>
            <Field label={t("sales.engine.report.to")}>{(id) => <input id={id} type="date" className="ds-input" value={filters.endDate} onChange={(e) => set({ endDate: e.target.value })} />}</Field>
          </>
        ) : null}
        <Field label={t("sales.warehouse")}>
          {(id) => (
            <select id={id} className="ds-input" value={filters.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
              <option value="">{t("sales.engine.report.all")}</option>
              {(options.data?.warehouses ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("sales.engine.report.category")}>
          {(id) => (
            <select id={id} className="ds-input" value={filters.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">{t("sales.engine.report.all")}</option>
              {(options.data?.categories ?? []).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("sales.engine.report.employee")}>
          {(id) => (
            <select id={id} className="ds-input" value={filters.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
              <option value="">{t("sales.engine.report.all")}</option>
              {(options.data?.employees ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </form>

      {s ? (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-live="polite">
          {[
            { label: t("sales.engine.report.invoices"), value: s.invoiceCount, decimals: 0 },
            { label: t("sales.engine.report.volume"), value: s.totalVolume, decimals: 0 },
            { label: t("sales.profitability.revenue"), value: s.totalRevenue, decimals: 2, money: true },
            { label: t("sales.engine.report.cost"), value: s.totalCost, decimals: 2, money: true },
            { label: t("sales.profitability.grossProfit"), value: s.totalProfit, decimals: 2, money: true },
            { label: t("sales.engine.report.averageMargin"), value: s.averageMargin, decimals: 1, suffix: "%" },
          ].map((k) => (
            <div key={k.label} className="ds-card ds-card-pad flex flex-col gap-1">
              <dt className="ds-muted text-[length:var(--ds-text-xs)]">{k.label}</dt>
              <dd className="ds-mono text-[length:var(--ds-text-xl)] font-semibold">
                <CountUp value={k.value} decimals={k.decimals} locale={fmt.locale} />
                {k.money ? <span className="ml-1 text-[length:var(--ds-text-xs)] ds-muted">{t("common.currency")}</span> : null}
                {k.suffix ?? null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <ViewEngine data={data} title={t("reports.salesReportTitle")} fmt={fmt} ctx={ctx} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="ds-label">
        {label}
      </label>
      {children(id)}
    </span>
  );
}
