"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import ReportFiltersPanel from "@/components/reports/ReportFiltersPanel";
import GlFinancialReportsDashboard from "@/components/reports/GlFinancialReportsDashboard";
import { DEFAULT_REPORT_FILTERS } from "@/lib/reports/dateRange";
import type { GlFinancialReportsData } from "@/lib/reports/glFinancialReports";
import {
  fetchGlFinancialReportsAction,
  fetchGlReportFilterOptionsAction,
} from "@/lib/actions/glFinancialReports";
import { fetchReportFilterOptions } from "@/lib/reports/fetchFilterOptions";
import type { Category, EmployeeOption, ReportFilters, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

const emptyData: GlFinancialReportsData = {
  profitAndLoss: {
    totalRevenue: 0,
    totalCogs: 0,
    totalExpenses: 0,
    grossProfit: 0,
    netProfit: 0,
  },
  balanceSheet: {
    asOfDate: "",
    assets: [],
    liabilities: [],
    equityAccounts: [],
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquityAccounts: 0,
    netIncomeYtd: 0,
    totalEquity: 0,
  },
  generalLedger: { rows: [], total: 0, limit: 50, offset: 0 },
};

const LEDGER_PAGE_SIZE = 50;

export default function GlFinancialReportsPageClient() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [partners, setPartners] = useState<Array<{ id: string; name: string }>>([]);
  const [accountId, setAccountId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [data, setData] = useState<GlFinancialReportsData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchReportFilterOptions(), fetchGlReportFilterOptionsAction()]).then(
      ([baseOpts, glOpts]) => {
        setWarehouses(baseOpts.warehouses);
        setCategories(baseOpts.categories);
        setEmployees(baseOpts.employees);
        if (glOpts.success) {
          setAccounts(glOpts.accounts);
          setPartners(glOpts.partners);
        }
      }
    );
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchGlFinancialReportsAction({
      startDate: filters.startDate,
      endDate: filters.endDate,
      accountId: accountId || null,
      partnerId: partnerId || null,
      ledgerLimit: LEDGER_PAGE_SIZE,
      ledgerOffset,
    });
    if (!result.success) {
      setError(result.error);
      setData(emptyData);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [filters.startDate, filters.endDate, accountId, partnerId, ledgerOffset]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const ledgerPage = Math.floor(ledgerOffset / LEDGER_PAGE_SIZE);
  const ledgerPageCount = Math.max(1, Math.ceil(data.generalLedger.total / LEDGER_PAGE_SIZE));

  return (
    <PageLayout>
      <header className="app-glass border-b border-app px-6 py-4">
        <Link
          href="/reports"
          className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("reports.backToReports")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-app">
              <BarChart3 className="h-6 w-6 text-app-accent" />
              {t("glReports.pageTitle")}
            </h2>
            <p className="text-sm text-app-muted">{t("glReports.pageDescription")}</p>
          </div>
          <button type="button" onClick={() => void loadReport()} className="btn-secondary">
            <RefreshCw className="h-4 w-4" />
            {t("common.refresh")}
          </button>
        </div>
      </header>

      <main className="app-page-content flex-1 space-y-3 overflow-y-auto md:space-y-4">
        <ReportFiltersPanel
          filters={filters}
          warehouses={warehouses}
          categories={categories}
          employees={employees}
          loading={loading}
          onChange={(next) => {
            setFilters(next);
            setLedgerOffset(0);
          }}
          onApply={() => {
            setLedgerOffset(0);
            void loadReport();
          }}
          showWarehouse={false}
          showCategory={false}
          showEmployee={false}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs font-semibold text-app">
            {t("glReports.filterAccount")}
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setLedgerOffset(0);
              }}
              className="app-input mt-1 w-full"
            >
              <option value="">{t("glReports.allAccounts")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-app">
            {t("glReports.filterPartner")}
            <select
              value={partnerId}
              onChange={(e) => {
                setPartnerId(e.target.value);
                setLedgerOffset(0);
              }}
              className="app-input mt-1 w-full"
            >
              <option value="">{t("glReports.allPartners")}</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <GlFinancialReportsDashboard data={data} loading={loading} />

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={loading || ledgerOffset <= 0}
            onClick={() => setLedgerOffset((prev) => Math.max(0, prev - LEDGER_PAGE_SIZE))}
          >
            <ChevronLeft className="h-4 w-4" />
            {t("common.previous")}
          </button>
          <span className="text-xs text-app-muted">
            {ledgerPage + 1} / {ledgerPageCount}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={loading || ledgerOffset + LEDGER_PAGE_SIZE >= data.generalLedger.total}
            onClick={() => setLedgerOffset((prev) => prev + LEDGER_PAGE_SIZE)}
          >
            {t("common.next")}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </main>
    </PageLayout>
  );
}
