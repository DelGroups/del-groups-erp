"use client";

import React, { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import ReportFiltersPanel from "@/components/reports/ReportFiltersPanel";
import SalesReportView from "@/components/reports/SalesReportView";
import { DEFAULT_REPORT_FILTERS } from "@/lib/reports/dateRange";
import { fetchReportFilterOptions } from "@/lib/reports/fetchFilterOptions";
import { fetchSalesReport } from "@/lib/reports/fetchSalesReport";
import type {
  Category,
  ReportFilters,
  SalesReportData,
  Warehouse,
  EmployeeOption,
} from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { ShoppingCart } from "lucide-react";

const emptyReport: SalesReportData = {
  topProducts: [],
  summary: {
    totalVolume: 0,
    totalRevenue: 0,
    totalCost: 0,
    totalProfit: 0,
    averageMargin: 0,
    invoiceCount: 0,
  },
};

export default function SalesReportPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [report, setReport] = useState<SalesReportData>(emptyReport);
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
    setReport(await fetchSalesReport(filters));
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <PageLayout>
        <DocumentPageHeader
          icon={<ShoppingCart className="h-6 w-6 text-emerald-600" />}
          title={t("reports.salesReportTitle")}
          description={t("reports.salesReportDescription")}
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
          />

          <SalesReportView data={report} loading={loading} />
        </main>
      </PageLayout>
  );
}
