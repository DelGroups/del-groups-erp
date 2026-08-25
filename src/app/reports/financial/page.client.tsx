"use client";

import React, { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import ReportFiltersPanel from "@/components/reports/ReportFiltersPanel";
import FinancialReportView from "@/components/reports/FinancialReportView";
import { DEFAULT_REPORT_FILTERS } from "@/lib/reports/dateRange";
import { fetchReportFilterOptions } from "@/lib/reports/fetchFilterOptions";
import { fetchFinancialReport } from "@/lib/reports/fetchFinancialReport";
import type {
  Category,
  FinancialReportData,
  ReportFilters,
  Warehouse,
  EmployeeOption,
} from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { PieChart } from "lucide-react";

const emptyReport: FinancialReportData = {
  ledger: [],
  summary: { totalIncome: 0, totalExpense: 0, netFlow: 0, byCategory: [] },
};

export default function FinancialReportPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [report, setReport] = useState<FinancialReportData>(emptyReport);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchReportFilterOptions().then((opts) => {
      setWarehouses(opts.warehouses);
      setCategories(opts.categories);
      setEmployees(opts.employees);
    });
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setReport(await fetchFinancialReport(filters));
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <PageLayout>
        <DocumentPageHeader
          icon={<PieChart className="h-6 w-6 text-app-accent" />}
          title={t("reports.financialReportTitle")}
          description={t("reports.financialReportDescription")}
          createLabel={t("common.refresh")}
          onCreate={() => void loadReport()}
          backLink={{ href: "/reports", label: t("reports.backToReports") }}
        />

        <main className="flex-1 space-y-4 overflow-y-auto p-6">
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

          <FinancialReportView data={report} loading={loading} />
        </main>
      </PageLayout>
  );
}
