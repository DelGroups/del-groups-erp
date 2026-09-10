"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ReportFiltersPanel from "@/components/reports/ReportFiltersPanel";
import PartnerReconciliationDocument from "@/components/reports/PartnerReconciliationDocument";
import { fetchPartnerReconciliationAction } from "@/lib/actions/accountingReports";
import { fetchGlReportFilterOptionsAction } from "@/lib/actions/glFinancialReports";
import { DEFAULT_REPORT_FILTERS } from "@/lib/reports/dateRange";
import type { PartnerReconciliationReport } from "@/lib/reports/partnerReconciliation";
import { fetchReportFilterOptions } from "@/lib/reports/fetchFilterOptions";
import type { Category, EmployeeOption, ReportFilters, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, FileCheck2, Printer, RefreshCw } from "lucide-react";

const emptyReport: PartnerReconciliationReport = {
  partnerId: "",
  partnerName: "",
  startDate: "",
  endDate: "",
  initialBalance: 0,
  closingBalance: 0,
  lines: [],
};

export default function PartnerReconciliationPageClient() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [partners, setPartners] = useState<Array<{ id: string; name: string }>>([]);
  const [partnerId, setPartnerId] = useState(searchParams.get("partnerId") || "");
  const [data, setData] = useState<PartnerReconciliationReport>(emptyReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchReportFilterOptions(), fetchGlReportFilterOptionsAction()]).then(
      ([baseOpts, glOpts]) => {
        setWarehouses(baseOpts.warehouses);
        setCategories(baseOpts.categories);
        setEmployees(baseOpts.employees);
        if (glOpts.success) setPartners(glOpts.partners);
      }
    );
  }, []);

  const loadReport = useCallback(async () => {
    if (!partnerId) {
      setData(emptyReport);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await fetchPartnerReconciliationAction(
      partnerId,
      filters.startDate,
      filters.endDate
    );
    if (!result.success) {
      setError(result.error);
      setData(emptyReport);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [partnerId, filters.startDate, filters.endDate]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <PageLayout>
      <header className="app-glass border-b border-app px-6 py-4 print:hidden">
        <Link href="/reports" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("reports.backToReports")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-app">
              <FileCheck2 className="h-6 w-6 text-app-accent" />
              {t("reconciliation.pageTitle")}
            </h2>
            <p className="text-sm text-app-muted">{t("reconciliation.pageDescription")}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.print()} className="btn-secondary" disabled={!partnerId}>
              <Printer className="h-4 w-4" />
              {t("reconciliation.print")}
            </button>
            <button type="button" onClick={() => void loadReport()} className="btn-secondary" disabled={!partnerId}>
              <RefreshCw className="h-4 w-4" />
              {t("common.refresh")}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-4 overflow-y-auto p-6 print:bg-white print:p-0">
        <div className="print:hidden">
          <ReportFiltersPanel
            filters={filters}
            warehouses={warehouses}
            categories={categories}
            employees={employees}
            loading={loading}
            onChange={setFilters}
            onApply={() => void loadReport()}
            showWarehouse={false}
            showCategory={false}
            showEmployee={false}
          />
          <label className="mt-3 block max-w-md text-xs font-semibold text-app">
            {t("reconciliation.selectPartner")}
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="app-input mt-1 w-full"
            >
              <option value="">{t("reconciliation.choosePartner")}</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>{partner.name}</option>
              ))}
            </select>
          </label>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 print:hidden">
            {error}
          </div>
        ) : null}

        {!partnerId ? (
          <div className="app-card p-8 text-center text-sm text-app-muted print:hidden">
            {t("reconciliation.choosePartner")}
          </div>
        ) : (
          <PartnerReconciliationDocument data={data} loading={loading} />
        )}
      </main>
    </PageLayout>
  );
}
