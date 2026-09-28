"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import { ERPPage } from "@/components/layout/ERPLayout";
import Panel from "@/components/ui/panel";
import Button from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Select from "@/components/ui/select";
import KpiCard from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import { ResizableTh, Td, TablePagination } from "@/components/ui/table";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import { useTableResize, type TableColumnSpecs } from "@/hooks/useTableResize";
import { useWarehouseStockDashboard } from "@/hooks/useWarehouseStockDashboard";
import {
  computeWarehouseStockKpis,
  type WarehouseStockRow,
  type WarehouseStockStatus,
} from "@/lib/inventory/fetchWarehouseStockDashboard";
import { useI18n } from "@/i18n/I18nProvider";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  History,
  Package,
  PackageX,
  Wallet,
} from "lucide-react";

type StatusFilter = "all" | "low" | "out";

const INVENTORY_GRID_COLUMNS: TableColumnSpecs = {
  code: { width: 150, minWidth: 120, maxWidth: 260 },
  name: { width: 280, minWidth: 220, maxWidth: 1200, grow: 2 },
  warehouse: { width: 150, minWidth: 110, maxWidth: 260 },
  category: { width: 150, minWidth: 110, maxWidth: 260, grow: 1 },
  quantity: { width: 130, minWidth: 100, maxWidth: 220 },
  unit: { width: 90, minWidth: 70, maxWidth: 160 },
  value: { width: 140, minWidth: 110, maxWidth: 240 },
  status: { width: 130, minWidth: 100, maxWidth: 220 },
  actions: { width: 200, minWidth: 160, maxWidth: 320 },
};

function StockStatusBadge({
  status,
  label,
}: {
  status: WarehouseStockStatus;
  label: string;
}) {
  const variant =
    status === "out" ? "danger" : status === "low" ? "warning" : "success";
  return (
    <Badge variant={variant} className="normal-case whitespace-nowrap">
      {label}
    </Badge>
  );
}

function formatQty(value: number, unit: string | null): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}

export default function InventoryPageClient() {
  const { t } = useI18n();
  const { data, isLoading, isFetching, error, refetch } = useWarehouseStockDashboard();

  const [searchTerm, setSearchTerm] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const {
    containerRef: gridContainerRef,
    tableProps: gridTableProps,
    columnProps: gridColumnProps,
  } = useTableResize(INVENTORY_GRID_COLUMNS, {
    storageKey: "inventory-stock-grid-columns-v1",
  });

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      if (warehouseFilter !== "all" && row.warehouseId !== warehouseFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (q) {
        const haystack = `${row.name} ${row.sku} ${row.barcode ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data?.rows, searchTerm, warehouseFilter, statusFilter, categoryFilter]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, warehouseFilter, statusFilter, categoryFilter, pageSize]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize) || 1);
    if (page > totalPages) setPage(totalPages);
  }, [filteredRows.length, page, pageSize]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const kpis = useMemo(() => computeWarehouseStockKpis(filteredRows), [filteredRows]);

  const statusLabel = (status: WarehouseStockStatus) => {
    if (status === "out") return t("inventory.statusOutOfStock");
    if (status === "low") return t("inventory.statusLowStock");
    return t("inventory.statusInStock");
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    setSearchTerm(e.currentTarget.value.trim());
    e.currentTarget.select();
  };

  return (
    <PageLayout>
      <div className="-mx-[calc(var(--erp-content-padding-x)-1.5rem)] w-[calc(100%+2*(var(--erp-content-padding-x)-1.5rem))] max-w-none space-y-6 px-6">
        <ERPPage
          pageTitle={t("inventory.pageTitle")}
          subtitle={t("inventory.pageSubtitle")}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full rounded-xl" />
              ))
            ) : (
              <>
                <KpiCard
                  label={t("inventory.kpi.totalItems")}
                  value={String(kpis.totalDistinctItems)}
                  icon={<Package className="h-5 w-5" />}
                  accent="indigo"
                />
                <KpiCard
                  label={t("inventory.kpi.lowStock")}
                  value={String(kpis.lowStockCount)}
                  icon={<AlertTriangle className="h-5 w-5" />}
                  accent="amber"
                />
                <KpiCard
                  label={t("inventory.kpi.outOfStock")}
                  value={String(kpis.outOfStockCount)}
                  icon={<PackageX className="h-5 w-5" />}
                  accent="rose"
                />
                <KpiCard
                  label={t("inventory.kpi.totalValuation")}
                  value={`${kpis.totalValuation.toFixed(2)} AZN`}
                  icon={<Wallet className="h-5 w-5" />}
                  accent="emerald"
                />
              </>
            )}
          </div>

          <Panel
            title={t("inventory.stockPanelTitle")}
            subtitle={t("inventory.stockPanelSubtitle")}
          >
            {error ? (
              <div className="alert-warning mb-4 text-xs">
                <p className="font-semibold">{t("common.error")}</p>
                <p className="mt-1 text-app-muted">
                  {error instanceof Error ? error.message : String(error)}
                </p>
              </div>
            ) : null}

            {!error && data?.warnings?.length ? (
              <div className="alert-warning mb-4 text-xs">
                <p className="font-semibold">{t("inventory.loadWarningTitle")}</p>
                <p className="mt-1 text-app-muted">{data.warnings.join(" · ")}</p>
              </div>
            ) : null}

            <div className="mb-4 flex flex-wrap items-end gap-3">
              <DocumentListSearchBar
                value={searchTerm}
                onChange={setSearchTerm}
                onKeyDown={handleSearchKeyDown}
                placeholder={t("inventory.searchPlaceholder")}
                onRefresh={() => void refetch()}
                loading={isFetching}
                className="flex min-w-[260px] flex-1 items-center gap-3"
              />

              <label className="block text-xs font-semibold text-[color:var(--erp-text-muted)]">
                {t("inventory.filters.warehouse")}
                <Select
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  className="mt-1.5"
                >
                  <option value="all">{t("inventory.filters.allWarehouses")}</option>
                  {(data?.warehouses ?? []).map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block text-xs font-semibold text-[color:var(--erp-text-muted)]">
                {t("inventory.filters.category")}
                <Select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="mt-1.5"
                >
                  <option value="all">{t("inventory.filters.allCategories")}</option>
                  {(data?.categories ?? []).map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block text-xs font-semibold text-[color:var(--erp-text-muted)]">
                {t("inventory.filters.status")}
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className="mt-1.5"
                >
                  <option value="all">{t("inventory.filters.statusAll")}</option>
                  <option value="low">{t("inventory.filters.statusLow")}</option>
                  <option value="out">{t("inventory.filters.statusOut")}</option>
                </Select>
              </label>
            </div>

            {isLoading ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div
                  ref={gridContainerRef}
                  className="w-full overflow-x-auto overflow-y-visible rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-panel)]"
                >
                  <table {...gridTableProps} className="app-table w-full text-left text-sm">
                    <thead className="border-b-2 border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)]">
                      <tr>
                        <ResizableTh {...gridColumnProps("code")}>
                          {t("inventory.columns.barcodeOrCode")}
                        </ResizableTh>
                        <ResizableTh {...gridColumnProps("name")}>
                          {t("inventory.columns.name")}
                        </ResizableTh>
                        <ResizableTh {...gridColumnProps("warehouse")}>
                          {t("inventory.columns.warehouse")}
                        </ResizableTh>
                        <ResizableTh {...gridColumnProps("category")}>
                          {t("inventory.columns.category")}
                        </ResizableTh>
                        <ResizableTh {...gridColumnProps("quantity")} className="text-right">
                          {t("inventory.columns.qtyOnHand")}
                        </ResizableTh>
                        <ResizableTh {...gridColumnProps("unit")}>
                          {t("inventory.columns.unit")}
                        </ResizableTh>
                        <ResizableTh {...gridColumnProps("value")} className="text-right">
                          {t("inventory.columns.totalValue")}
                        </ResizableTh>
                        <ResizableTh {...gridColumnProps("status")}>
                          {t("inventory.columns.statusAlert")}
                        </ResizableTh>
                        <ResizableTh {...gridColumnProps("actions")} className="text-right">
                          {t("inventory.columns.actions")}
                        </ResizableTh>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedRows.length === 0 ? (
                        <tr>
                          <Td colSpan={9} className="py-10 text-center text-[color:var(--erp-text-muted)]">
                            {t("inventory.emptyStock")}
                          </Td>
                        </tr>
                      ) : (
                        paginatedRows.map((row: WarehouseStockRow) => (
                          <tr
                            key={row.id}
                            className="border-b border-[color:var(--erp-border-default)] transition-colors hover:bg-[color:var(--erp-bg-table-row-alt)]"
                          >
                            <Td className="font-mono text-xs text-[color:var(--erp-text-muted)]">
                              {row.barcode || row.sku}
                            </Td>
                            <Td>
                              <p className="font-medium text-[color:var(--erp-text-main)]">
                                {row.name}
                              </p>
                            </Td>
                            <Td>
                              <div className="flex items-center gap-2">
                                <Boxes className="h-4 w-4 shrink-0 text-[color:var(--erp-text-muted)]" />
                                <span>{row.warehouseName}</span>
                              </div>
                            </Td>
                            <Td>{row.category || "—"}</Td>
                            <Td numeric className="font-mono font-semibold tabular-nums">
                              {formatQty(row.totalPhysical, null)}
                            </Td>
                            <Td>{row.unit || "—"}</Td>
                            <Td numeric className="font-mono tabular-nums">
                              {row.valuation.toFixed(2)} AZN
                            </Td>
                            <Td>
                              <StockStatusBadge
                                status={row.status}
                                label={statusLabel(row.status)}
                              />
                            </Td>
                            <Td className="text-right">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  href={`/inventory/transfers/new?from=${row.warehouseId}&productId=${row.productId}`}
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5" />
                                  {t("inventory.actions.transfer")}
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  href={`/dashboard/reports/inventory-turnover?productId=${row.productId}`}
                                >
                                  <History className="h-3.5 w-3.5" />
                                  {t("inventory.actions.kardex")}
                                </Button>
                              </div>
                            </Td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  page={page}
                  limit={pageSize}
                  total={filteredRows.length}
                  onPageChange={setPage}
                  onLimitChange={setPageSize}
                  className="rounded-b-[var(--erp-radius-md)] border border-t-0 border-[color:var(--erp-border-default)]"
                />
              </>
            )}
          </Panel>

          <p className="text-sm text-[color:var(--erp-text-muted)]">
            <Link
              href="/products"
              className="font-medium text-[color:var(--erp-color-link)] hover:underline"
            >
              {t("inventory.openFullCatalog")}
            </Link>
          </p>
        </ERPPage>
      </div>
    </PageLayout>
  );
}
