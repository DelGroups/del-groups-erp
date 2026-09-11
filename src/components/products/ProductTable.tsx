"use client";

import React from "react";
import { AlertTriangle, Pencil, Printer, Trash2 } from "lucide-react";
import type { Product, ProductColumnKey, Warehouse } from "@/types/database.types";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import { useI18n } from "@/i18n/I18nProvider";
import { isCriticalStock, productMinStock } from "@/lib/inventory/safetyStock";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import StatusBadge from "@/components/ui/status-badge";
import { Table, TableWrap, THead, Th, Td } from "@/components/ui/table";

interface ProductTableProps {
  products: Product[];
  warehouses: Warehouse[];
  visibleColumns: Record<ProductColumnKey, boolean>;
  loading?: boolean;
  canEdit?: boolean;
  onEdit?: (product: Product) => void;
  onDelete?: (product: Product) => void;
  onPrintLabel?: (product: Product) => void;
  emptyMessage?: string;
}

function isNumericColumn(key: ProductColumnKey) {
  return key === "buy_price" || key === "sell_price" || key === "weight";
}

function renderCell(
  key: ProductColumnKey,
  product: Product,
  t: (key: string) => string
) {
  switch (key) {
    case "name":
      return (
        <span className="font-medium text-app">
          {product.name}
          {product.is_composite ? (
            <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
              {t("products.bom.compositeBadge")}
            </span>
          ) : null}
        </span>
      );
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
      return `${Number(product.sell_price || 0).toFixed(2)} AZN`;
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
  onDelete,
  onPrintLabel,
  emptyMessage,
}: ProductTableProps) {
  const { t } = useI18n();
  const columns = (Object.keys(visibleColumns) as ProductColumnKey[]).filter(
    (key) => visibleColumns[key]
  );

  if (loading) {
    return (
      <Card className="text-center text-sm text-app-muted">
        <div className="py-7">{t("products.loading")}</div>
      </Card>
    );
  }

  if (products.length === 0) {
    return (
      <Card className="text-center text-sm text-app-muted">
        <div className="py-7">{emptyMessage || t("products.empty")}</div>
      </Card>
    );
  }

  return (
    <Card padding={false}>
      <TableWrap>
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <tr>
                {columns.map((key) => (
                  <Th key={key} numeric={isNumericColumn(key)}>
                    {t(`products.columnLabels.${key}`)}
                  </Th>
                ))}
                <Th numeric>{t("products.stock")}</Th>
                <Th numeric>{t("products.minStockLevel")}</Th>
                <Th>{t("common.warehouse")}</Th>
                <Th>{t("common.status")}</Th>
                {canEdit || onPrintLabel ? (
                  <Th>{t("common.actions")}</Th>
                ) : null}
              </tr>
            </THead>
            <tbody className="divide-y divide-slate-100">
              {products.map((product) => {
                const critical = isCriticalStock(product);
                return (
                  <tr key={product.id} className="transition-colors hover:bg-app-card-hover">
                    {columns.map((key) => (
                      <Td key={key} numeric={isNumericColumn(key)}>
                        {renderCell(key, product, t)}
                      </Td>
                    ))}
                    <Td numeric className="font-bold">
                      {product.stock} {product.unit}
                    </Td>
                    <Td numeric className="text-app-muted">
                      {productMinStock(product)} {product.unit}
                    </Td>
                    <Td className="text-app-muted">—</Td>
                    <Td>
                      {critical ? (
                        <StatusBadge tone="low-stock">
                          <AlertTriangle className="h-3 w-3" />
                          {t("products.lowStockBadge")}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="posted">{t("products.sufficientStock")}</StatusBadge>
                      )}
                    </Td>
                    {canEdit || onPrintLabel ? (
                      <Td>
                        <div className="flex items-center gap-1.5">
                          {onPrintLabel ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onPrintLabel(product)}
                            >
                              <Printer className="h-3.5 w-3.5" />
                              {t("inventory.printLabel")}
                            </Button>
                          ) : null}
                          {canEdit ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => onEdit?.(product)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              {t("common.edit")}
                            </Button>
                          ) : null}
                          {canEdit && onDelete ? (
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={() => onDelete(product)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t("common.delete")}
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </TableWrap>
    </Card>
  );
}
