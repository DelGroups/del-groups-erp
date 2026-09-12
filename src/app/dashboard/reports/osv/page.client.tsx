"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import PageLayout from "@/components/layout/PageLayout";
import ReportFiltersPanel from "@/components/reports/ReportFiltersPanel";
import TrialBalanceTable from "@/components/reports/TrialBalanceTable";
import { fetchTrialBalanceAction } from "@/lib/actions/accountingReports";
import { DEFAULT_REPORT_FILTERS } from "@/lib/reports/dateRange";
import { isZeroTrialBalanceRow, type TrialBalanceReport } from "@/lib/reports/trialBalance";
import { fetchReportFilterOptions } from "@/lib/reports/fetchFilterOptions";
import type { Category, EmployeeOption, ReportFilters, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, Download, Printer, RefreshCw, Table2 } from "lucide-react";

const emptyReport: TrialBalanceReport = {
  startDate: "",
  endDate: "",
  rows: [],
  totals: {
    initialDebit: 0,
    initialCredit: 0,
    periodDebit: 0,
    periodCredit: 0,
    closingDebit: 0,
    closingCredit: 0,
  },
};

export default function TrialBalancePageClient() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [search, setSearch] = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [data, setData] = useState<TrialBalanceReport>(emptyReport);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchReportFilterOptions().then((opts) => {
      setWarehouses(opts.warehouses);
      setCategories(opts.categories);
      setEmployees(opts.employees);
    });
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchTrialBalanceAction(filters.startDate, filters.endDate);
    if (!result.success) {
      setError(result.error);
      setData(emptyReport);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [filters.startDate, filters.endDate]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (hideZero && isZeroTrialBalanceRow(row)) return false;
      if (!q) return true;
      return row.code.toLowerCase().includes(q) || row.name.toLowerCase().includes(q);
    });
  }, [data.rows, hideZero, search]);

  const displayData = useMemo(
    () => ({ ...data, rows: filteredRows }),
    [data, filteredRows]
  );

  const exportExcel = () => {
    const rows = filteredRows.map((row) => ({
      [t("osv.colCode")]: row.code,
      [t("osv.colAccount")]: row.name,
      [t("osv.colInitialDebit")]: row.initialDebit,
      [t("osv.colInitialCredit")]: row.initialCredit,
      [t("osv.colPeriodDebit")]: row.periodDebit,
      [t("osv.colPeriodCredit")]: row.periodCredit,
      [t("osv.colClosingDebit")]: row.closingDebit,
      [t("osv.colClosingCredit")]: row.closingCredit,
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "OSV");
    XLSX.writeFile(wb, `OSV_${filters.startDate}_${filters.endDate}.xlsx`);
  };

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
              <Table2 className="h-6 w-6 text-app-accent" />
              {t("osv.pageTitle")}
            </h2>
            <p className="text-sm text-app-muted">{t("osv.pageDescription")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => window.print()} className="btn-secondary">
              <Printer className="h-4 w-4" />
              {t("osv.print")}
            </button>
            <button type="button" onClick={exportExcel} disabled={loading || filteredRows.length === 0} className="btn-secondary">
              <Download className="h-4 w-4" />
              {t("osv.exportExcel")}
            </button>
            <button type="button" onClick={() => void loadReport()} className="btn-secondary">
              <RefreshCw className="h-4 w-4" />
              {t("common.refresh")}
            </button>
          </div>
        </div>
      </header>

      <main className="app-page-content flex-1 space-y-3 overflow-y-auto md:space-y-4 print:p-0">
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
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("osv.searchPlaceholder")}
              className="app-input max-w-xs"
            />
            <label className="flex items-center gap-2 text-xs font-semibold text-app">
              <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
              {t("osv.hideZero")}
            </label>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 print:hidden">
            {error}
          </div>
        ) : null}

        <div className="hidden print:block print:mb-4 print:text-center">
          <h1 className="text-lg font-bold">{t("osv.pageTitle")}</h1>
          <p className="text-sm">{filters.startDate} — {filters.endDate}</p>
        </div>

        <TrialBalanceTable data={displayData} loading={loading} />
      </main>
    </PageLayout>
  );
}
