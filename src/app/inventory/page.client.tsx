"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import { ERPPage } from "@/components/layout/ERPLayout";
import Panel from "@/components/ui/panel";
import Button from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { useProductsCatalog } from "@/hooks/useProductsCatalog";
import { useI18n } from "@/i18n/I18nProvider";
import type { Product } from "@/types/database.types";

type StockStatusTone = "success" | "warning" | "danger";

interface StockRow {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  status: string;
  statusTone: StockStatusTone;
}

function StockStatusBadge({ label, tone }: { label: string; tone: StockStatusTone }) {
  const variant = { success: "success", warning: "warning", danger: "danger" }[tone] as
    | "success"
    | "warning"
    | "danger";
  return <Badge variant={variant} className="normal-case">{label}</Badge>;
}

function resolveStockStatus(
  product: Product,
  t: (key: string) => string
): { label: string; tone: StockStatusTone } {
  const stock = Number(product.stock) || 0;
  const minStock = Number(product.min_stock) || 0;

  if (stock <= 0) {
    return { label: t("inventory.statusOutOfStock"), tone: "danger" };
  }
  if (minStock > 0 && stock <= minStock) {
    return { label: t("inventory.statusLowStock"), tone: "warning" };
  }
  return { label: t("inventory.statusInStock"), tone: "success" };
}

export default function InventoryPageClient() {
  const { t } = useI18n();
  const { data: catalog, isLoading } = useProductsCatalog();
  const products = catalog?.products ?? [];

  const stockData = useMemo<StockRow[]>(
    () =>
      products.map((product) => {
        const status = resolveStockStatus(product, t);
        return {
          id: product.id,
          sku: product.code || "—",
          name: product.name,
          quantity: Number(product.stock) || 0,
          status: status.label,
          statusTone: status.tone,
        };
      }),
    [products, t]
  );

  const columns = useMemo<DataTableColumn<StockRow>[]>(
    () => [
      { header: t("inventory.columns.id"), accessor: "id", className: "font-mono text-xs" },
      { header: t("inventory.columns.sku"), accessor: "sku" },
      { header: t("inventory.columns.name"), accessor: "name" },
      { header: t("inventory.columns.quantity"), accessor: "quantity", align: "right" },
      {
        header: t("inventory.columns.status"),
        accessor: (item) => <StockStatusBadge label={item.status} tone={item.statusTone} />,
      },
    ],
    [t]
  );

  return (
    <PageLayout>
      <ERPPage pageTitle={t("inventory.pageTitle")}>
        <Panel
          title={t("inventory.stockPanelTitle")}
          subtitle={t("inventory.stockPanelSubtitle")}
          actions={
            <Button variant="success" size="sm" href="/products/new">
              {t("inventory.addItem")}
            </Button>
          }
        >
          {isLoading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <DataTable
              data={stockData}
              columns={columns}
              emptyMessage={t("inventory.emptyStock")}
              getRowKey={(row) => row.id}
            />
          )}
        </Panel>

        <p className="text-sm text-[color:var(--gt-text-primary)]">
          <Link href="/products" className="font-medium text-[color:var(--gt-navy)] hover:underline">
            {t("inventory.openFullCatalog")}
          </Link>
        </p>
      </ERPPage>
    </PageLayout>
  );
}
