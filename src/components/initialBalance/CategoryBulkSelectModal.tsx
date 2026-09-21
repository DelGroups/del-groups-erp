"use client";

import React, { useMemo, useState } from "react";
import { Layers, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import Button from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { Product } from "@/types/database.types";

interface CategoryBulkSelectModalProps {
  open: boolean;
  products: Product[];
  /** Product ids already present in the target grid — shown but disabled. */
  existingProductIds: Set<string>;
  onClose: () => void;
  onConfirm: (products: Product[]) => void;
}

function productMatchesQuery(product: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (product.name || "").toLowerCase().includes(q) ||
    (product.code || "").toLowerCase().includes(q) ||
    (product.barcode || "").toLowerCase().includes(q)
  );
}

export default function CategoryBulkSelectModal({
  open,
  products,
  existingProductIds,
  onClose,
  onConfirm,
}: CategoryBulkSelectModalProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const categoryPills = useMemo(() => {
    const set = new Set<string>();
    products.forEach((product) => {
      if (product.category?.trim()) set.add(product.category.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "az"));
  }, [products]);

  const filteredProducts = useMemo(
    () =>
      products
        .filter((product) => productMatchesQuery(product, query))
        .filter((product) => !categoryFilter || product.category === categoryFilter),
    [products, query, categoryFilter]
  );

  const allFilteredSelected =
    filteredProducts.length > 0 &&
    filteredProducts.every((product) => selectedIds.has(product.id) || existingProductIds.has(product.id));

  const toggleProduct = (productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredProducts.forEach((product) => next.delete(product.id));
      } else {
        filteredProducts.forEach((product) => {
          if (!existingProductIds.has(product.id)) next.add(product.id);
        });
      }
      return next;
    });
  };

  const handleClose = () => {
    setQuery("");
    setCategoryFilter("");
    setSelectedIds(new Set());
    onClose();
  };

  const handleConfirm = () => {
    const chosen = products.filter((product) => selectedIds.has(product.id));
    onConfirm(chosen);
    handleClose();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
      title={t("initialBalance.categorySelectTitle")}
      className="top-1/2 w-[min(92vw,64rem)] max-w-none -translate-y-1/2 sm:w-[min(85vw,64rem)]"
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-6"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <p className="text-xs text-app-muted">
            {t("initialBalance.categorySelectedCount", { count: selectedIds.size })}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t("common.close")}
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={selectedIds.size === 0}>
              {t("initialBalance.categorySelectConfirm")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-muted" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("products.searchPlaceholder")}
            className="app-input w-full pl-9 text-sm"
          />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryFilter("")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold",
              !categoryFilter
                ? "border-app-accent bg-app-accent/10 text-app-accent"
                : "border-app text-app-muted hover:bg-app-card-hover"
            )}
          >
            {t("common.all")}
          </button>
          {categoryPills.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setCategoryFilter(category)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                categoryFilter === category
                  ? "border-app-accent bg-app-accent/10 text-app-accent"
                  : "border-app text-app-muted hover:bg-app-card-hover"
              )}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-app">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-app-card-hover text-app-muted">
              <tr>
                <th className="w-10 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    aria-label={t("common.all")}
                  />
                </th>
                <th className="px-3 py-2 text-left">{t("forms.productName")}</th>
                <th className="px-3 py-2 text-left">{t("products.category")}</th>
                <th className="px-3 py-2 text-left">{t("forms.unitMeasure")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const alreadyInGrid = existingProductIds.has(product.id);
                const checked = selectedIds.has(product.id) || alreadyInGrid;
                return (
                  <tr
                    key={product.id}
                    className={cn(
                      "border-t border-app",
                      alreadyInGrid ? "opacity-50" : "cursor-pointer hover:bg-app-card-hover"
                    )}
                    onClick={() => !alreadyInGrid && toggleProduct(product.id)}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={alreadyInGrid}
                        onChange={() => toggleProduct(product.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-app">{product.name}</td>
                    <td className="px-3 py-2 text-app-muted">{product.category || "—"}</td>
                    <td className="px-3 py-2 text-app-muted">{product.unit || "—"}</td>
                  </tr>
                );
              })}
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-app-muted">
                    <Layers className="mx-auto mb-2 h-6 w-6 opacity-40" />
                    {t("products.empty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
