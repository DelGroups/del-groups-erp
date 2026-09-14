"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import { ERPPage } from "@/components/layout/ERPLayout";
import Panel from "@/components/ui/panel";
import Button from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Select from "@/components/ui/select";
import KpiCard from "@/components/dashboard/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, THead, Th, Td } from "@/components/ui/table";
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
  const { data, isLoading } = useWarehouseStockDashboard();

  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.filter((row) => {
      if (warehouseFilter !== "all" && row.warehouseId !== warehouseFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      return true;
    });
  }, [data?.rows, warehouseFilter, statusFilter, categoryFilter]);

  const kpis = useMemo(() => computeWarehouseStockKpis(filteredRows), [filteredRows]);

  const statusLabel = (status: WarehouseStockStatus) => {
    if (status === "out") return t("inventory.statusOutOfStock");
    if (status === "low") return t("inventory.statusLowStock");
    return t("inventory.statusInStock");
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
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
            </div>

            {isLoading ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <TableWrap className="rounded-[var(--erp-radius-md)]">
                <Table className="min-w-[1100px]">
                  <THead>
                    <tr>
                      <Th>{t("inventory.columns.productSku")}</Th>
                      <Th>{t("inventory.columns.warehouse")}</Th>
                      <Th numeric>{t("inventory.columns.totalPhysical")}</Th>
                      <Th numeric>{t("inventory.columns.reserved")}</Th>
                      <Th numeric>{t("inventory.columns.available")}</Th>
                      <Th numeric>{t("inventory.columns.minLimit")}</Th>
                      <Th>{t("inventory.columns.statusAlert")}</Th>
                      <Th className="text-right">{t("inventory.columns.actions")}</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <Td colSpan={8} className="py-10 text-center text-[color:var(--erp-text-muted)]">
                          {t("inventory.emptyStock")}
                        </Td>
                      </tr>
                    ) : (
                      filteredRows.map((row: WarehouseStockRow) => (
                        <tr
                          key={row.id}
                          className="border-b border-[color:var(--erp-border-default)] transition-colors hover:bg-[color:var(--erp-bg-table-row-alt)]"
                        >
                          <Td>
                            <div className="min-w-[200px]">
                              <p className="font-medium text-[color:var(--erp-text-main)]">
                                {row.name}
                              </p>
                              <p className="mt-0.5 font-mono text-xs text-[color:var(--erp-text-muted)]">
                                {row.sku}
                              </p>
                            </div>
                          </Td>
                          <Td>
                            <div className="flex min-w-[140px] items-center gap-2">
                              <Boxes className="h-4 w-4 shrink-0 text-[color:var(--erp-text-muted)]" />
                              <span>{row.warehouseName}</span>
                            </div>
                          </Td>
                          <Td numeric className="font-mono tabular-nums">
                            {formatQty(row.totalPhysical, row.unit)}
                          </Td>
                          <Td numeric className="font-mono tabular-nums text-amber-700">
                            {formatQty(row.reserved, row.unit)}
                          </Td>
                          <Td numeric className="font-mono font-semibold tabular-nums text-[color:var(--erp-color-success)]">
                            {formatQty(row.available, row.unit)}
                          </Td>
                          <Td numeric className="font-mono tabular-nums">
                            {formatQty(row.minLimit, row.unit)}
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
                                href={`/dashboard/warehouse/slips?productId=${row.productId}`}
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
                </Table>
              </TableWrap>
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
