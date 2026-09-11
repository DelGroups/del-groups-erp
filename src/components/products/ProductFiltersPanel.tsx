"use client";

import React from "react";
import { Filter, RotateCcw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { Category, ProductFilters, Warehouse } from "@/types/database.types";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import Input from "@/components/ui/input";
import Select from "@/components/ui/select";

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
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase text-app">
          <Filter className="h-4 w-4 text-app-accent" />
          {t("products.advancedFilter")}
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t("products.resetFilter")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="block text-[11px] font-semibold text-app-muted">
          {t("products.columnLabels.name")}
          <Input
            type="text"
            value={filters.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={t("products.namePlaceholder")}
            className="mt-1"
          />
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("products.columnLabels.code")}
          <Input
            type="text"
            value={filters.code}
            onChange={(e) => set({ code: e.target.value })}
            placeholder={t("products.codePlaceholder")}
            className="mt-1"
          />
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("common.category")}
          <Select
            value={filters.category}
            onChange={(e) => set({ category: e.target.value })}
            className="mt-1"
          >
            <option value="">{t("common.all")}</option>
            {[...new Set(categories.map((c) => c.name))].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("forms.subcategory")}
          <Input
            type="text"
            value={filters.subcategory}
            onChange={(e) => set({ subcategory: e.target.value })}
            placeholder={t("products.subcategoryPlaceholder")}
            className="mt-1"
          />
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("common.warehouse")}
          <Select
            value={filters.warehouseId}
            onChange={(e) => set({ warehouseId: e.target.value })}
            className="mt-1"
          >
            <option value="">{t("common.all")}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-[11px] font-semibold text-app-muted">
          {t("products.columnLabels.barcode")}
          <Input
            type="text"
            value={filters.barcode}
            onChange={(e) => set({ barcode: e.target.value })}
            placeholder={t("products.barcodePlaceholder")}
            className="mt-1"
          />
        </label>
      </div>
    </Card>
  );
}
