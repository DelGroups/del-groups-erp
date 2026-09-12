"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import ProductFiltersPanel from "@/components/products/ProductFiltersPanel";
import ColumnVisibilityPanel from "@/components/products/ColumnVisibilityPanel";
import ProductTable from "@/components/products/ProductTable";
import ThermalLabelPrintTemplate, {
  productToThermalLabel,
  type ThermalLabelItem,
} from "@/components/products/ThermalLabelPrintTemplate";
import CategoryManagerModal from "@/components/products/CategoryManagerModal";
import ProductForm from "@/components/products/ProductForm";
import { usePolywoodSummaries, usePolywoodWarehouseId, useProductsCatalog } from "@/hooks/useProductsCatalog";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { PolywoodInventorySummary } from "@/lib/polywood/types";
import { filterProducts } from "@/lib/products/filters";
import {
  loadColumnVisibility,
  saveColumnVisibility,
  type ProductColumnKey,
} from "@/lib/products/columns";
import {
  DEFAULT_PRODUCT_FILTERS,
  type Category,
  type Product,
  type ProductFilters,
  type Warehouse,
} from "@/types/database.types";
import {
  FolderPlus,
  Package,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useBarcodeLabelConfig } from "@/hooks/useBarcodeLabelConfig";
import {
  BARCODE_PAPER_SIZES,
  overridePaperSize,
  type BarcodeLabelConfig,
  type BarcodePaperSize,
} from "@/lib/barcode/labelConfig";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import Button from "@/components/ui/button";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import PageHeader from "@/components/ui/page-header";
import Select from "@/components/ui/select";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { deleteProductAction } from "@/lib/actions/entityDelete";

export default function ProductsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManageProducts = can("can_manage_products");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();
  const { data: catalog, isLoading, isFetching, refetch } = useProductsCatalog();
  const products = catalog?.products ?? [];
  const categories = catalog?.categories ?? [];
  const warehouses = catalog?.warehouses ?? [];
  const polywoodWarehouseId = usePolywoodWarehouseId(warehouses);
  const { data: polywoodSummaries = new Map<string, PolywoodInventorySummary>() } =
    usePolywoodSummaries(polywoodWarehouseId);
  const loading = isLoading || isFetching;
  const [filters, setFilters] = useState<ProductFilters>(DEFAULT_PRODUCT_FILTERS);
  const [columnVisibility, setColumnVisibility] = useState<Record<ProductColumnKey, boolean>>(
    loadColumnVisibility
  );
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const branding = useCompanyBranding();
  const { config: labelConfig } = useBarcodeLabelConfig();
  const [paperSize, setPaperSize] = useState<BarcodePaperSize>(labelConfig.paper_size);
  const { printData: printJob, setPrintData: setPrintJob } =
    useDocumentPrint<{ items: ThermalLabelItem[]; config: BarcodeLabelConfig }>(450);

  useEffect(() => {
    setPaperSize(labelConfig.paper_size);
  }, [labelConfig.paper_size]);

  const printConfig = overridePaperSize(labelConfig, paperSize);

  const defaultWarehouseName =
    warehouses.find((row) => row.is_default)?.name || warehouses[0]?.name || null;

  const toLabelItems = (rows: Product[]): ThermalLabelItem[] =>
    rows.map((product) =>
      productToThermalLabel(product, { warehouseName: defaultWarehouseName })
    );

  const loadData = useCallback(async () => {
    await refetch();
    if (polywoodWarehouseId) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.products.polywoodSummaries(polywoodWarehouseId),
      });
    }
  }, [polywoodWarehouseId, queryClient, refetch]);

  useEffect(() => {
    saveColumnVisibility(columnVisibility);
  }, [columnVisibility]);

  const filteredProducts = useMemo(
    () => filterProducts(products, filters, warehouses),
    [products, filters, warehouses]
  );

  const handleDeleteProduct = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteProductAction(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      showError(result.error || t("common.error"));
      return;
    }
    setDeleteTarget(null);
    showSuccess(t("products.deleteSuccess"));
    void queryClient.invalidateQueries({ queryKey: queryKeys.products.catalog });
  };

  return (
    <PageLayout>
        <PageHeader
          icon={<Package className="h-6 w-6 text-app-accent" />}
          title={t("products.titleWarehouse")}
          subtitle={t("products.listSubtitle")}
          actions={
            <>
              {canManageProducts ? (
                <Button type="button" variant="secondary" onClick={() => setCategoryModalOpen(true)}>
                  <FolderPlus className="h-4 w-4" />
                  {t("products.categories")}
                </Button>
              ) : null}

              <Select
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as BarcodePaperSize)}
                title={t("inventory.labelSize")}
                className="w-auto min-w-[9rem]"
              >
                {BARCODE_PAPER_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {t(`barcodeSettings.paperSizes.${size}`)}
                  </option>
                ))}
              </Select>

              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setPrintJob({ items: toLabelItems(filteredProducts), config: printConfig })
                }
                disabled={loading || filteredProducts.length === 0}
              >
                <Printer className="h-4 w-4" />
                {t("inventory.printLabel")}
              </Button>

              <Button href="/products/damaged-goods" variant="danger">
                <Trash2 className="h-4 w-4" />
                {t("products.damagedGoodsLink")}
              </Button>

              {canManageProducts ? (
                <Button href="/products/new">
                  <Plus className="h-4 w-4" />
                  {t("products.createLabel")}
                </Button>
              ) : null}
            </>
          }
        />

        <main className="app-page-content flex-1 space-y-3 overflow-y-auto md:space-y-4">
          <ProductFiltersPanel
            filters={filters}
            categories={categories}
            warehouses={warehouses}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_PRODUCT_FILTERS)}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-app-muted">
              {loading
                ? t("common.loading")
                : t("products.showingCount", {
                    filtered: filteredProducts.length,
                    total: products.length,
                  })}
            </p>

            <div className="flex items-center gap-2">
              <ColumnVisibilityPanel
                visibility={columnVisibility}
                onChange={setColumnVisibility}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadData()}
                loading={loading}
                title={t("common.refresh")}
              >
                {loading ? null : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <ProductTable
            products={filteredProducts}
            warehouses={warehouses}
            polywoodSummaries={polywoodSummaries}
            visibleColumns={columnVisibility}
            loading={loading}
            canEdit={canManageProducts}
            onEdit={setEditingProduct}
            onDelete={canManageProducts ? setDeleteTarget : undefined}
            onPrintLabel={(product) =>
              setPrintJob({ items: toLabelItems([product]), config: printConfig })
            }
            emptyMessage={
              products.length === 0 ? t("products.empty") : t("products.noFilterMatch")
            }
          />
        </main>

      <CategoryManagerModal
        isOpen={categoryModalOpen}
        categories={categories}
        onClose={() => setCategoryModalOpen(false)}
        onUpdated={() => void loadData()}
      />

      {editingProduct ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto app-scrim p-4">
          <div className="my-6 w-full max-w-5xl">
            <div className="mb-3 flex items-center justify-between rounded-xl border border-app bg-app-card px-4 py-3">
              <h3 className="text-sm font-bold text-app">
                {t("common.edit")}: {editingProduct.name}
              </h3>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingProduct(null)}>
                {t("common.close")}
              </Button>
            </div>
            <ProductForm
              categories={categories}
              warehouses={warehouses}
              allProducts={products}
              initialProduct={editingProduct}
              onCancel={() => setEditingProduct(null)}
              onSuccess={() => {
                setEditingProduct(null);
                void loadData();
              }}
            />
          </div>
        </div>
      ) : null}

      {printJob ? (
        <div className="print-area">
          <ThermalLabelPrintTemplate
            items={printJob.items}
            config={printJob.config}
            branding={branding}
          />
        </div>
      ) : null}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemName={deleteTarget?.name}
        loading={deleting}
        onConfirm={() => void handleDeleteProduct()}
        onCancel={() => setDeleteTarget(null)}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
