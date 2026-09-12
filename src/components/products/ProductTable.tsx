"use client";

import React from "react";
import { AlertTriangle, Pencil, Printer, Trash2 } from "lucide-react";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import PolywoodStockCell from "@/components/polywood/PolywoodStockCell";
import type { PolywoodInventorySummary } from "@/lib/polywood/types";
import type { Product, ProductColumnKey, Warehouse } from "@/types/database.types";
import { POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import { useI18n } from "@/i18n/I18nProvider";
import { isCriticalStock, productMinStock } from "@/lib/inventory/safetyStock";
import Card from "@/components/ui/card";
import StatusBadge from "@/components/ui/status-badge";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Th, Td } from "@/components/ui/table";

function isMeterStockProduct(product: Product): boolean {
  const unit = (product.unit || "").trim().toLowerCase();
  return (
    product.inventory_mode === POLYWOOD_INVENTORY_MODE ||
    product.is_dimensional === true ||
    unit === "m" ||
    unit === "metr"
  );
}

interface ProductTableProps {
  products: Product[];
  warehouses: Warehouse[];
  polywoodSummaries?: Map<string, PolywoodInventorySummary>;
  visibleColumns: Record<ProductColumnKey, boolean>;
  loading?: boolean;
  canEdit?: boolean;
  onEdit?: (product: Product) => void;
  onDelete?: (product: Product) => void;
  onPrintLabel?: (product: Product) => void;
  emptyMessage?: string;
}

function isNumericColumn(key: ProductColumnKey) {
  return key === "buy_price" || key === "sell_price";
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
  polywoodSummaries,
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
                  <ActionsTh>{t("common.actions")}</ActionsTh>
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
                      {isMeterStockProduct(product) ? (
                        <PolywoodStockCell
                          stock={product.stock}
                          unit={product.unit || "Metr"}
                          summary={polywoodSummaries?.get(product.id) ?? null}
                        />
                      ) : (
                        <span className="font-mono tabular-nums">
                          {product.stock} {product.unit}
                        </span>
                      )}
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
                      <ActionsTd>
                        <TableRowActionsMenu
                          items={[
                            ...(onPrintLabel
                              ? [
                                  {
                                    key: "print",
                                    label: t("inventory.printLabel"),
                                    icon: <Printer className="h-4 w-4" />,
                                    onClick: () => onPrintLabel(product),
                                  },
                                ]
                              : []),
                            ...(canEdit && onEdit
                              ? [
                                  {
                                    key: "edit",
                                    label: t("common.edit"),
                                    icon: <Pencil className="h-4 w-4" />,
                                    onClick: () => onEdit(product),
                                  },
                                ]
                              : []),
                            ...(canEdit && onDelete
                              ? [
                                  {
                                    key: "delete",
                                    label: t("common.delete"),
                                    icon: <Trash2 className="h-4 w-4" />,
                                    onClick: () => onDelete(product),
                                    variant: "destructive" as const,
                                  },
                                ]
                              : []),
                          ]}
                        />
                      </ActionsTd>
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
