"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import ListPageChrome from "@/components/layout/ListPageChrome";
import ProductFiltersPanel from "@/components/products/ProductFiltersPanel";
import ColumnVisibilityPanel from "@/components/products/ColumnVisibilityPanel";
import ProductTable from "@/components/products/ProductTable";
import PrintableLabelArea from "@/components/products/PrintableLabelArea";
import ThermalLabelPrintTemplate, {
  productToThermalLabel,
  type ThermalLabelItem,
} from "@/components/products/ThermalLabelPrintTemplate";
import CategoryManagerModal from "@/components/products/CategoryManagerModal";
import ProductFormDrawer from "@/components/products/ProductFormDrawer";
import BulkImportModal from "@/components/products/BulkImportModal";
import QuickScanModal from "@/components/products/QuickScanModal";
import { BulkActionBar } from "@/components/ui/table";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import { usePolywoodSummaries, usePolywoodWarehouseId, useProductsCatalog } from "@/hooks/useProductsCatalog";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { PolywoodInventorySummary } from "@/lib/polywood/types";
import { filterProducts, getUniqueBrands } from "@/lib/products/filters";
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
  FileSpreadsheet,
  FolderPlus,
  Package,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
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
import { SplitButton } from "@/components/ui/split-button";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import PageHeader from "@/components/ui/page-header";
import Select from "@/components/ui/select";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { deleteProductAction } from "@/lib/actions/entityDelete";
import { isBarcodeModuleEnabled } from "@/lib/features/barcodeModule";

export default function ProductsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const { can } = useAuth();
  const canManageProducts = can("can_manage_products");
  const barcodeModuleEnabled = isBarcodeModuleEnabled();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [deleteQueue, setDeleteQueue] = useState<Product[]>([]);
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
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
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

  const brandOptions = useMemo(() => getUniqueBrands(products), [products]);

  const filteredProducts = useMemo(
    () => filterProducts(products, filters, warehouses),
    [products, filters, warehouses]
  );

  const bulk = useBulkSelection(filteredProducts, (product) => product.id);

  const handleClone = useCallback(
    (product: Product) => {
      router.push(`/products/new?cloneId=${product.id}`);
    },
    [router]
  );

  const handleDeleteProducts = async () => {
    if (deleteQueue.length === 0) return;
    setDeleting(true);
    let deleted = 0;
    let failed = 0;
    let lastError = "";

    for (const product of deleteQueue) {
      const result = await deleteProductAction(product.id);
      if (result.success) {
        deleted += 1;
      } else {
        failed += 1;
        lastError = result.error || t("common.error");
      }
    }

    const queuedCount = deleteQueue.length;
    setDeleting(false);
    setDeleteQueue([]);
    bulk.clear();
    void queryClient.invalidateQueries({ queryKey: queryKeys.products.catalog });

    if (deleted > 0) {
      showSuccess(
        queuedCount === 1
          ? t("products.deleteSuccess")
          : failed > 0
            ? t("products.bulkDeleteSuccess", { deleted, failed })
            : t("products.bulkDeleteAllSuccess", { deleted })
      );
    }
    if (failed > 0 && deleted === 0) {
      showError(lastError);
    } else if (failed > 0) {
      showError(t("products.bulkDeletePartial", { failed, error: lastError }));
    }
  };

  return (
    <PageLayout>
      <ListPageChrome
        header={
          <PageHeader
            variant="chrome"
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

              {barcodeModuleEnabled ? (
                <>
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
                </>
              ) : null}

              <Button href="/products/damaged-goods" variant="danger">
                <Trash2 className="h-4 w-4" />
                {t("products.damagedGoodsLink")}
              </Button>

              {canManageProducts ? (
                <SplitButton
                  href="/products/new"
                  icon={<Plus className="h-4 w-4" />}
                  label={t("products.createLabel")}
                  menuAriaLabel={t("products.entryMenuAria")}
                  menuItems={[
                    {
                      key: "bulk-import",
                      label: t("products.bulkImportLabel"),
                      icon: <FileSpreadsheet className="h-4 w-4 text-emerald-600" />,
                      onSelect: () => setIsBulkModalOpen(true),
                    },
                    {
                      key: "quick-scan",
                      label: t("products.quickScanLabel"),
                      icon: <ScanLine className="h-4 w-4 text-app-accent" />,
                      onSelect: () => setIsScanModalOpen(true),
                    },
                  ]}
                />
              ) : null}
            </>
            }
          />
        }
        filters={
          <ProductFiltersPanel
            filters={filters}
            categories={categories}
            brands={brandOptions}
            warehouses={warehouses}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_PRODUCT_FILTERS)}
          />
        }
      >
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

          <BulkActionBar count={bulk.count} onClear={bulk.clear}>
            {barcodeModuleEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setPrintJob({
                    items: toLabelItems(bulk.selectedItems),
                    config: printConfig,
                  })
                }
                disabled={bulk.count === 0}
              >
                <Printer className="h-3.5 w-3.5" />
                {t("table.printSelected")}
              </Button>
            ) : null}
            {canManageProducts ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setDeleteQueue(bulk.selectedItems)}
                disabled={bulk.count === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("common.delete")}
              </Button>
            ) : null}
          </BulkActionBar>

          <ProductTable
            products={filteredProducts}
            warehouses={warehouses}
            polywoodSummaries={polywoodSummaries}
            visibleColumns={columnVisibility}
            loading={loading}
            canEdit={canManageProducts}
            onEdit={setEditingProduct}
            onClone={canManageProducts ? handleClone : undefined}
            onDelete={canManageProducts ? (product) => setDeleteQueue([product]) : undefined}
            onPrintLabel={
              barcodeModuleEnabled
                ? (product) =>
                    setPrintJob({ items: toLabelItems([product]), config: printConfig })
                : undefined
            }
            bulkSelection={{
              isSelected: bulk.isSelected,
              toggle: bulk.toggle,
              toggleAll: bulk.toggleAll,
              allSelected: bulk.allSelected,
              someSelected: bulk.someSelected,
            }}
            emptyMessage={
              products.length === 0 ? t("products.empty") : t("products.noFilterMatch")
            }
          />
      </ListPageChrome>

      <BulkImportModal
        open={isBulkModalOpen}
        onClose={() => setIsBulkModalOpen(false)}
        onImported={() => void loadData()}
      />

      <QuickScanModal
        open={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        categories={categories}
        onCreated={() => void loadData()}
        onExistingProduct={(product) => {
          setIsScanModalOpen(false);
          setEditingProduct(product);
        }}
      />

      <CategoryManagerModal
        isOpen={categoryModalOpen}
        categories={categories}
        onClose={() => setCategoryModalOpen(false)}
        onUpdated={() => void loadData()}
      />

      <ProductFormDrawer
        open={Boolean(editingProduct)}
        product={editingProduct}
        categories={categories}
        warehouses={warehouses}
        allProducts={products}
        onClose={() => setEditingProduct(null)}
        onSuccess={() => {
          setEditingProduct(null);
          void loadData();
        }}
      />

      {barcodeModuleEnabled && printJob ? (
        <PrintableLabelArea>
          <ThermalLabelPrintTemplate
            items={printJob.items}
            config={printJob.config}
            branding={branding}
          />
        </PrintableLabelArea>
      ) : null}

      <ConfirmDeleteModal
        open={deleteQueue.length > 0}
        itemName={deleteQueue.length === 1 ? deleteQueue[0]?.name : undefined}
        message={
          deleteQueue.length > 1
            ? t("products.bulkDeleteConfirm", { count: deleteQueue.length })
            : undefined
        }
        loading={deleting}
        onConfirm={() => void handleDeleteProducts()}
        onCancel={() => setDeleteQueue([])}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
