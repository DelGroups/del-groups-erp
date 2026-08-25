"use client";

import React from "react";
import { Filter, RotateCcw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { Category, ProductFilters, Warehouse } from "@/types/database.types";

interface ProductFiltersPanelProps {
  filters: ProductFilters;
  categories: Category[];
  warehouses: Warehouse[];
  onChange: (filters: ProductFilters) => void;
  onReset: () => void;
}

export default function ProductFiltersPanel({
  filters,
  categories,
  warehouses,
  onChange,
  onReset,
}: ProductFiltersPanelProps) {
  const { t } = useI18n();
  const set = (patch: Partial<ProductFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="app-card app-card-elevated p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase text-app">
          <Filter className="h-4 w-4 text-app-accent" />
          {t("products.advancedFilter")}
        </h3>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 text-[11px] font-semibold text-app-muted hover:text-app"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("products.resetFilter")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="block text-[11px] font-semibold text-app-muted">
          {t("products.columnLabels.name")}
          <input
            type="text"
            value={filters.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={t("products.namePlaceholder")}
            className="mt-1 w-full rounded-lg border border-app px-2.5 py-1.5 text-xs"
          />
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("products.columnLabels.code")}
          <input
            type="text"
            value={filters.code}
            onChange={(e) => set({ code: e.target.value })}
            placeholder={t("products.codePlaceholder")}
            className="mt-1 w-full rounded-lg border border-app px-2.5 py-1.5 text-xs"
          />
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("common.category")}
          <select
            value={filters.category}
            onChange={(e) => set({ category: e.target.value })}
            className="app-input mt-1 text-xs"
          >
            <option value="">{t("common.all")}</option>
            {[...new Set(categories.map((c) => c.name))].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("forms.subcategory")}
          <input
            type="text"
            value={filters.subcategory}
            onChange={(e) => set({ subcategory: e.target.value })}
            placeholder={t("products.subcategoryPlaceholder")}
            className="mt-1 w-full rounded-lg border border-app px-2.5 py-1.5 text-xs"
          />
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("common.warehouse")}
          <select
            value={filters.warehouseId}
            onChange={(e) => set({ warehouseId: e.target.value })}
            className="app-input mt-1 text-xs"
          >
            <option value="">{t("common.all")}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("products.columnLabels.barcode")}
          <input
            type="text"
            value={filters.barcode}
            onChange={(e) => set({ barcode: e.target.value })}
            placeholder={t("products.barcodePlaceholder")}
            className="mt-1 w-full rounded-lg border border-app px-2.5 py-1.5 text-xs"
          />
        </label>
      </div>
    </div>
  );
}
