"use client";

import React from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import type { Product, ProductColumnKey, Warehouse } from "@/types/database.types";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import { useI18n } from "@/i18n/I18nProvider";

interface ProductTableProps {
  products: Product[];
  warehouses: Warehouse[];
  visibleColumns: Record<ProductColumnKey, boolean>;
  loading?: boolean;
  canEdit?: boolean;
  onEdit?: (product: Product) => void;
}

function renderCell(key: ProductColumnKey, product: Product) {
  switch (key) {
    case "name":
      return <span className="font-medium text-app">{product.name}</span>;
    case "code":
      return (
        <span className="font-mono text-xs font-semibold text-app">{product.code}</span>
      );
    case "category":
      return (
        <span className="rounded-full bg-app-card-hover px-2.5 py-1 text-xs font-semibold text-app">
          {product.category || "-"}
        </span>
      );
    case "subcategory":
      return product.subcategory || "-";
    case "buy_price":
      return `${Number(product.buy_price || 0).toFixed(2)} AZN`;
    case "sell_price":
      return (
        <span className="font-semibold text-app">
          {Number(product.sell_price || 0).toFixed(2)} AZN
        </span>
      );
    case "barcode":
      return (
        <BarcodeDisplay
          value={product.barcode}
          width={1.1}
          height={28}
          fontSize={9}
        />
      );
    case "unit":
      return product.unit || "-";
    case "color":
      return product.color || "-";
    case "weight":
      return product.weight ? `${product.weight} kq` : "-";
    case "extra_info":
      return (
        <span className="line-clamp-2 max-w-[200px] text-app-muted">
          {product.extra_info || "-"}
        </span>
      );
    default:
      return "-";
  }
}

export default function ProductTable({
  products,
  visibleColumns,
  loading,
  canEdit,
  onEdit,
}: ProductTableProps) {
  const { t } = useI18n();
  const columns = (Object.keys(visibleColumns) as ProductColumnKey[]).filter(
    (key) => visibleColumns[key]
  );

  if (loading) {
    return (
      <div className="app-card p-12 text-center text-sm text-app-muted">
        {t("products.loading")}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="app-card p-12 text-center text-sm text-app-muted">
        {t("products.noFilterMatch")}
      </div>
    );
  }

  return (
    <div className="app-table-wrap">
      <div className="overflow-x-auto">
        <table className="app-table">
          <thead className="border-b border-app bg-app-card-hover text-xs uppercase text-app-muted">
            <tr>
              {columns.map((key) => (
                <th key={key} className="px-4 py-3 font-bold">
                  {t(`products.columnLabels.${key}`)}
                </th>
              ))}
              <th className="px-4 py-3 font-bold">{t("products.stock")}</th>
              <th className="px-4 py-3 font-bold">{t("common.warehouse")}</th>
              <th className="px-4 py-3 font-bold">{t("common.status")}</th>
              {canEdit ? <th className="px-4 py-3 font-bold">{t("common.actions")}</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((product) => {
              const isLowStock =
                Number(product.stock) <= Number(product.min_stock ?? 0);
              return (
                <tr key={product.id} className="transition-colors hover:bg-app-card-hover">
                  {columns.map((key) => (
                    <td key={key} className="px-4 py-3">
                      {renderCell(key, product)}
                    </td>
                  ))}
                  <td className="px-4 py-3 font-bold">
                    {product.stock} {product.unit}
                  </td>
                  <td className="px-4 py-3 text-app-muted">—</td>
                  <td className="px-4 py-3">
                    {isLowStock ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {t("products.lowStockBadge")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                        {t("products.sufficientStock")}
                      </span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onEdit?.(product)}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("common.edit")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
