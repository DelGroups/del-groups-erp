"use client";

import React, { useMemo } from "react";
import { AlertTriangle, Copy, Pencil, Printer, Trash2 } from "lucide-react";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import PolywoodStockCell from "@/components/polywood/PolywoodStockCell";
import type { PolywoodInventorySummary } from "@/lib/polywood/types";
import type { Product, ProductColumnKey, Warehouse } from "@/types/database.types";
import { POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import ProductImageField from "@/components/products/ProductImageField";
import { useI18n } from "@/i18n/I18nProvider";
import { isCriticalStock, productMinStock } from "@/lib/inventory/safetyStock";
import { displayExtraInfoNotes } from "@/lib/products/productPriceRows";
import Card from "@/components/ui/card";
import StatusBadge from "@/components/ui/status-badge";
import {
  ActionsTd,
  ActionsTh,
  SelectTd,
  SelectTh,
  Table,
  TableSkeletonRows,
  TableWrap,
  THead,
  Th,
  Td,
  Tr,
} from "@/components/ui/table";
import { ListGrid } from "@/components/lists/ListGrid";
import { useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { useUiStandard } from "@/design-system/components";
import { formatMoney } from "@/lib/dates/localeDate";

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
  onClone?: (product: Product) => void;
  onDelete?: (product: Product) => void;
  onPrintLabel?: (product: Product) => void;
  emptyMessage?: string;
  bulkSelection?: {
    isSelected: (product: Product) => boolean;
    toggle: (product: Product) => void;
    toggleAll: () => void;
    allSelected: boolean;
    someSelected: boolean;
  };
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
        <div className="flex min-w-0 items-center gap-2.5">
          <ProductImageField
            value={product.image_url || null}
            alt={product.name}
            size="xs"
            editable={false}
          />
          <span className="min-w-0 font-medium text-app">
            {product.name}
            {product.is_composite ? (
              <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                {t("products.bom.compositeBadge")}
              </span>
            ) : null}
          </span>
        </div>
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
    case "brand":
      return product.brand || "-";
    case "country":
      return product.country_of_origin || "-";
    case "extra_info": {
      const notes = displayExtraInfoNotes(product.extra_info);
      return (
        <span className="line-clamp-2 max-w-[200px] text-app-muted">
          {notes || "-"}
        </span>
      );
    }
    default:
      return "-";
  }
}

function warehouseNameForProduct(product: Product, warehouses: Warehouse[]): string {
  if (!product.warehouse_id) return "—";
  return warehouses.find((w) => w.id === product.warehouse_id)?.name ?? "—";
}

export default function ProductTable({
  products,
  warehouses,
  polywoodSummaries,
  visibleColumns,
  loading,
  canEdit,
  onEdit,
  onClone,
  onDelete,
  onPrintLabel,
  emptyMessage,
  bulkSelection,
}: ProductTableProps) {
  const { t } = useI18n();
  const standard = useUiStandard();
  const columns = (Object.keys(visibleColumns) as ProductColumnKey[]).filter(
    (key) => visibleColumns[key]
  );

  const rowActions = (product: Product) => {
    return (
      <>
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
            ...(canEdit && onClone
              ? [
                  {
                    key: "clone",
                    label: t("products.duplicateLabel"),
                    icon: <Copy className="h-4 w-4" />,
                    onClick: () => onClone(product),
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
      </>
    );
  };

  // UI_STANDARD (UI-2): the list through DataGrid, which also shows the loading and empty states.
  if (standard) {
    return (
      <ProductGrid
        products={products}
        warehouses={warehouses}
        polywoodSummaries={polywoodSummaries}
        columns={columns}
        loading={loading}
        emptyMessage={emptyMessage || t("products.empty")}
        bulkSelection={bulkSelection}
        rowActions={canEdit || onPrintLabel ? rowActions : undefined}
      />
    );
  }

  const skeletonDataColumns = columns.length + 4 + (bulkSelection ? 1 : 0);

  if (products.length === 0) {
    return (
      <Card className="text-center text-sm text-app-muted">
        <div className="py-7">{emptyMessage || t("products.empty")}</div>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card padding={false}>
        <TableWrap>
          <Table>
            <THead>
              <tr>
                {bulkSelection ? <SelectTh checked={false} onChange={() => {}} /> : null}
                {columns.map((key) => (
                  <Th key={key} numeric={isNumericColumn(key)}>
                    {t(`products.columnLabels.${key}`)}
                  </Th>
                ))}
                <Th numeric>{t("products.stock")}</Th>
                <Th numeric>{t("products.minStockLevel")}</Th>
                <Th>{t("common.warehouse")}</Th>
                <Th>{t("common.status")}</Th>
                {canEdit || onPrintLabel ? <ActionsTh>{t("common.actions")}</ActionsTh> : null}
              </tr>
            </THead>
            <tbody>
              <TableSkeletonRows
                columns={skeletonDataColumns}
                rows={10}
                withActions={Boolean(canEdit || onPrintLabel)}
              />
            </tbody>
          </Table>
        </TableWrap>
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
                {bulkSelection ? (
                  <SelectTh
                    checked={bulkSelection.allSelected}
                    indeterminate={bulkSelection.someSelected}
                    onChange={bulkSelection.toggleAll}
                  />
                ) : null}
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
                  <Tr key={product.id}>
                    {bulkSelection ? (
                      <SelectTd
                        checked={bulkSelection.isSelected(product)}
                        onChange={() => bulkSelection.toggle(product)}
                      />
                    ) : null}
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
                    <Td className="text-app-muted">{warehouseNameForProduct(product, warehouses)}</Td>
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
                      <ActionsTd>{rowActions(product)}</ActionsTd>
                    ) : null}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </TableWrap>
    </Card>
  );
}

/** One product cell in the grid: amounts through the formatting module, one line each. */
function renderGridCell(key: ProductColumnKey, product: Product, t: (key: string) => string, locale: string): React.ReactNode {
  switch (key) {
    case "buy_price":
      return formatMoney(Number(product.buy_price || 0), locale);
    case "sell_price":
      return formatMoney(Number(product.sell_price || 0), locale);
    case "barcode":
      return <span className="font-mono">{product.barcode || "-"}</span>;
    case "extra_info":
      return <span className="ds-muted">{displayExtraInfoNotes(product.extra_info) || "-"}</span>;
    default:
      return renderCell(key, product, t);
  }
}

/**
 * The products list through DataGrid (UI-2): one line per product. The page keeps its own column
 * choice (visibleColumns), so the grid shows no second picker; widths and density are the user's.
 * The barcode is its digits (no drawn bars) and notes are one line, as every list row.
 */
function ProductGrid({
  products,
  warehouses,
  polywoodSummaries,
  columns,
  loading,
  emptyMessage,
  bulkSelection,
  rowActions,
}: {
  products: Product[];
  warehouses: Warehouse[];
  polywoodSummaries?: Map<string, PolywoodInventorySummary>;
  columns: ProductColumnKey[];
  loading?: boolean;
  emptyMessage: string;
  bulkSelection?: ProductTableProps["bulkSelection"];
  rowActions?: (product: Product) => React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const defs = useMemo<TableColumn<Product>[]>(() => {
    return [
      ...columns.map(
        (key): TableColumn<Product> => ({
          key,
          labelKey: `products.columnLabels.${key}`,
          defaultVisible: true,
          numeric: isNumericColumn(key),
          gridType: key === "code" ? "code" : key === "category" ? "status" : undefined,
          cell: (product: Product) => renderGridCell(key, product, t, locale),
        })
      ),
      {
        key: "stock",
        labelKey: "products.stock",
        defaultVisible: true,
        numeric: true,
        exportType: "number",
        cell: (product) => {
          const summary = isMeterStockProduct(product) ? polywoodSummaries?.get(product.id) : null;
          return (
            <span className="font-semibold">
              {summary ? `${summary.total_length_m.toFixed(2)} m` : `${product.stock} ${product.unit ?? ""}`}
            </span>
          );
        },
      },
      { key: "min_stock", labelKey: "products.minStockLevel", defaultVisible: true, numeric: true, exportType: "number", cell: (product) => `${productMinStock(product)} ${product.unit ?? ""}` },
      { key: "warehouse", labelKey: "common.warehouse", defaultVisible: true, cell: (product) => warehouseNameForProduct(product, warehouses) },
      {
        key: "stock_status",
        labelKey: "common.status",
        defaultVisible: true,
        gridType: "status",
        gridSamples: [t("products.lowStockBadge"), t("products.sufficientStock")],
        cell: (product) =>
          isCriticalStock(product) ? (
            <StatusBadge tone="low-stock">{t("products.lowStockBadge")}</StatusBadge>
          ) : (
            <StatusBadge tone="posted">{t("products.sufficientStock")}</StatusBadge>
          ),
      },
    ];
  }, [columns, locale, t, polywoodSummaries, warehouses]);
  const api = useTableColumns("products.grid", defs);

  return (
    <ListGrid
      columns={{ ...api, pickerPanel: null }}
      rows={products}
      rowKey={(product) => product.id}
      label={t("products.title")}
      loading={loading}
      empty={<p className="text-sm ds-muted">{emptyMessage}</p>}
      selection={bulkSelection}
      rowActions={rowActions}
    />
  );
}
