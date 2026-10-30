"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useFilterContext, useFormatter, useViewAccess, ViewEngine, ViewScope, type ViewData, type ViewDefinition, type ViewRecord } from "@/views";
import { importReportsAction, type ImportReports } from "../actions/reports";
import {
  IMPORT_REPORTS,
  payablesReportDefinition,
  productsReportDefinition,
  shipmentsReportDefinition,
  transitReportDefinition,
  vatReportDefinition,
  type ImportReportKey,
} from "../views/reports";

const DEFINITIONS: Record<ImportReportKey, ViewDefinition<ViewRecord>> = {
  shipments: shipmentsReportDefinition() as unknown as ViewDefinition<ViewRecord>,
  products: productsReportDefinition() as unknown as ViewDefinition<ViewRecord>,
  vat: vatReportDefinition() as unknown as ViewDefinition<ViewRecord>,
  payables: payablesReportDefinition() as unknown as ViewDefinition<ViewRecord>,
  transit: transitReportDefinition() as unknown as ViewDefinition<ViewRecord>,
};

/**
 * Imports reports (IMP-3, NEW_IMPORTS): shipments, landed cost per product over time, the
 * import VAT register, open payables per partner and goods in transit as of a date. Each one is
 * a view-engine list with filters, group by, the column chooser and Excel export.
 */
export default function ImportReportsScreen() {
  return (
    <ViewScope>
      <Reports />
    </ViewScope>
  );
}

function Reports() {
  const { t } = useI18n();
  const fmt = useFormatter();
  const ctx = useFilterContext();
  const [tab, setTab] = useState<ImportReportKey>("shipments");
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const definition = DEFINITIONS[tab];
  const access = useViewAccess(definition);
  const allowed = access.ready && access.read;
  const report = useQuery({
    queryKey: ["views", "imports.reports", asOf],
    queryFn: async () => {
      const r = await importReportsAction(asOf);
      if (!r.success) throw new Error(r.error);
      return r.data;
    },
    enabled: allowed,
  });
  const records = useMemo(() => ((report.data?.[tab] ?? []) as ImportReports[ImportReportKey]) as unknown as ViewRecord[], [report.data, tab]);
  const data: ViewData<ViewRecord> = {
    status: !access.ready ? "loading" : !access.read ? "forbidden" : report.isError ? "error" : report.data ? "ready" : "loading",
    definition,
    records,
    capped: false,
    canWrite: false,
    error: report.error ? t(report.error.message) : null,
    refetch: () => void report.refetch(),
  };

  return (
    <div className="flex flex-col gap-4">
      <Link href="/imports" className="inline-flex items-center gap-1 self-start text-[length:var(--ds-text-xs)] font-semibold" style={{ color: "var(--ds-brand)" }}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t("imports.title")}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label={t("importReports.title")} className="flex flex-wrap gap-1">
          {IMPORT_REPORTS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ds-btn ds-btn-sm ${tab === k ? "ds-btn-primary" : "ds-btn-ghost"}`} onClick={() => setTab(k)}>
              {t(`importReports.${k}.title`)}
            </button>
          ))}
        </div>
        {tab === "transit" ? (
          <label className="flex items-center gap-2">
            <span className="ds-label">{t("importReports.asOf")}</span>
            <input type="date" className="ds-input" value={asOf} onChange={(e) => setAsOf(e.target.value || asOf)} />
          </label>
        ) : null}
      </div>
      <p className="ds-muted text-[length:var(--ds-text-sm)]">{t(`importReports.${tab}.hint`)}</p>
      <ViewEngine key={tab} data={data} title={t(`importReports.${tab}.title`)} fmt={fmt} ctx={ctx} />
    </div>
  );
}
