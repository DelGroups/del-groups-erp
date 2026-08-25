"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import ProductFiltersPanel from "@/components/products/ProductFiltersPanel";
import ColumnVisibilityPanel from "@/components/products/ColumnVisibilityPanel";
import ProductTable from "@/components/products/ProductTable";
import ProductBarcodePrintTemplate from "@/components/products/ProductBarcodePrintTemplate";
import CategoryManagerModal from "@/components/products/CategoryManagerModal";
import { fetchProductsCatalog } from "@/lib/products/api";
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
import { useI18n } from "@/i18n/I18nProvider";

export default function ProductsPage() {
  const { t } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ProductFilters>(DEFAULT_PRODUCT_FILTERS);
  const [columnVisibility, setColumnVisibility] = useState<Record<ProductColumnKey, boolean>>(
    loadColumnVisibility
  );
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const { printData: printBarcodes, setPrintData: setPrintBarcodes } =
    useDocumentPrint<Product[]>();

  const loadData = useCallback(async () => {
    setLoading(true);
    const data = await fetchProductsCatalog();
    setProducts(data.products);
    setCategories(data.categories);
    setWarehouses(data.warehouses);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    saveColumnVisibility(columnVisibility);
  }, [columnVisibility]);

  const filteredProducts = useMemo(
    () => filterProducts(products, filters, warehouses),
    [products, filters, warehouses]
  );

  return (
    <PageLayout>
        <header className="flex flex-col justify-between gap-4 border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md md:flex-row md:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-app">
              <Package className="h-6 w-6 text-app-accent" />
              {t("products.titleWarehouse")}
            </h2>
            <p className="text-sm text-app-muted">{t("products.listSubtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCategoryModalOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
            >
              <FolderPlus className="h-4 w-4" />
              {t("products.categories")}
            </button>

            <button
              type="button"
              onClick={() => setPrintBarcodes(filteredProducts)}
              disabled={loading || filteredProducts.length === 0}
              className="flex items-center gap-2 rounded-lg app-card px-4 py-2 text-sm font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              {t("products.barcodeLabels")}
            </button>

            <Link
              href="/products/damaged-goods"
              className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
            >
              <Trash2 className="h-4 w-4" />
              {t("products.damagedGoodsLink")}
            </Link>

            <Link
              href="/products/new"
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              {t("products.createLabel")}
            </Link>
          </div>
        </header>

        <main className="flex-1 space-y-4 overflow-y-auto p-6">
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
              <button
                type="button"
                onClick={() => void loadData()}
                className="rounded-lg border border-app p-2 text-app-muted hover:bg-app-card-hover"
                title={t("common.refresh")}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <ProductTable
            products={filteredProducts}
            warehouses={warehouses}
            visibleColumns={columnVisibility}
            loading={loading}
          />
        </main>

      <CategoryManagerModal
        isOpen={categoryModalOpen}
        categories={categories}
        onClose={() => setCategoryModalOpen(false)}
        onUpdated={() => void loadData()}
      />

      {printBarcodes && (
        <div className="print-area">
          <ProductBarcodePrintTemplate products={printBarcodes} />
        </div>
      )}
    </PageLayout>
  );
}
