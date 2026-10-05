"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import ReportFiltersPanel from "@/components/reports/ReportFiltersPanel";
import InventoryTurnoverTable from "@/components/reports/InventoryTurnoverTable";
import { fetchInventoryTurnoverAction } from "@/lib/actions/accountingReports";
import { DEFAULT_REPORT_FILTERS } from "@/lib/reports/dateRange";
import type {
  InventoryTurnoverReport,
  InventoryTurnoverRow,
  InventoryTurnoverTotals,
} from "@/lib/reports/inventoryTurnover";
import { fetchReportFilterOptions } from "@/lib/reports/fetchFilterOptions";
import type { Category, EmployeeOption, ReportFilters, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft, Package, RefreshCw, X } from "lucide-react";

const emptyReport: InventoryTurnoverReport = {
  startDate: "",
  endDate: "",
  categoryId: null,
  rows: [],
  totals: {
    initialQty: 0,
    initialValue: 0,
    inboundQty: 0,
    inboundValue: 0,
    outboundQty: 0,
    outboundValue: 0,
    closingQty: 0,
    closingValue: 0,
  },
};

function sumTotals(rows: InventoryTurnoverRow[]): InventoryTurnoverTotals {
  return rows.reduce(
    (acc, row) => ({
      initialQty: acc.initialQty + row.initialQty,
      initialValue: acc.initialValue + row.initialValue,
      inboundQty: acc.inboundQty + row.inboundQty,
      inboundValue: acc.inboundValue + row.inboundValue,
      outboundQty: acc.outboundQty + row.outboundQty,
      outboundValue: acc.outboundValue + row.outboundValue,
      closingQty: acc.closingQty + row.closingQty,
      closingValue: acc.closingValue + row.closingValue,
    }),
    { ...emptyReport.totals }
  );
}

export default function InventoryTurnoverPageClient({
  productId = null,
}: {
  /** `?productId=` from the Kardex link on /inventory: show only that product. */
  productId?: string | null;
}) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<InventoryTurnoverReport>(emptyReport);
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
    const result = await fetchInventoryTurnoverAction(
      filters.startDate,
      filters.endDate,
      categoryId || null
    );
    if (!result.success) {
      setError(result.error);
      setData(emptyReport);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [filters.startDate, filters.endDate, categoryId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const filteredRows = useMemo(() => {
    const rows = productId ? data.rows.filter((row) => row.productId === productId) : data.rows;
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.productCode.toLowerCase().includes(q) ||
        row.productName.toLowerCase().includes(q)
    );
  }, [data.rows, search, productId]);

  // Totals follow the rows on screen, so a filtered view does not show grand totals.
  const displayData = useMemo(
    () => ({
      ...data,
      rows: filteredRows,
      totals: filteredRows === data.rows ? data.totals : sumTotals(filteredRows),
    }),
    [data, filteredRows]
  );

  const selectedProduct = productId
    ? data.rows.find((row) => row.productId === productId) ?? null
    : null;

  return (
    <PageLayout>
      <header className="app-glass border-b border-app px-6 py-4">
        <Link href="/reports" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("reports.backToReports")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-app">
              <Package className="h-6 w-6 text-app-accent" />
              {t("inventoryTurnover.pageTitle")}
            </h2>
            <p className="text-sm text-app-muted">{t("inventoryTurnover.pageDescription")}</p>
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
          onChange={setFilters}
          onApply={() => void loadReport()}
          showWarehouse={false}
          showCategory={false}
          showEmployee={false}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs font-semibold text-app">
            {t("inventoryTurnover.filterCategory")}
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="app-input mt-1 w-full"
            >
              <option value="">{t("inventoryTurnover.allCategories")}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-app">
            {t("inventoryTurnover.searchProduct")}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("inventoryTurnover.searchPlaceholder")}
              className="app-input mt-1 w-full"
            />
          </label>
        </div>

        {productId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-app">
            <span className="inline-flex items-center gap-2 rounded-full border border-app px-3 py-1">
              <span className="text-app-muted">{t("inventoryTurnover.productFilter")}:</span>
              <span className="font-semibold">
                {selectedProduct
                  ? `${selectedProduct.productCode} — ${selectedProduct.productName}`
                  : productId}
              </span>
            </span>
            <Link
              href="/dashboard/reports/inventory-turnover"
              className="inline-flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline"
            >
              <X className="h-3.5 w-3.5" />
              {t("inventoryTurnover.showAllProducts")}
            </Link>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <InventoryTurnoverTable data={displayData} loading={loading} />
      </main>
    </PageLayout>
  );
}
