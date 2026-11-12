"use client";

import { useMemo } from "react";
import { Scissors } from "lucide-react";
import { LineGrid, LineNumberCell, LineProductCell, LineSelectCell, LineText, LineTextCell, sumLines, type LineColumn, type LineMenuItem } from "@/components/line-grid";
import type { LookupRecord, LookupWhere } from "@/components/lookups";
import { useI18n } from "@/i18n/I18nProvider";
import { lineGridLabels } from "@/i18n/uiStandardLabels";
import { formatMoney, formatQuantity } from "@/lib/dates/localeDate";
import MetricLinePriceHint from "@/components/polywood/MetricLinePriceHint";
import type { DiscountType, InvoiceCurrency, PriceTier, SaleItem } from "@/types/database.types";

const CURRENCIES: readonly InvoiceCurrency[] = ["AZN", "USD", "EUR"];
const PRICE_TIERS: readonly PriceTier[] = ["retail", "wholesale", "distributor"];
const FORCE_WAREHOUSE: readonly string[] = ["warehouse"];
const NONE: readonly string[] = [];
const TIER_KEY:Record<PriceTier, string> = { retail: "invoice.priceTierRetail", wholesale: "invoice.priceTierWholesale", distributor: "invoice.priceTierDistributor" };

export interface SalesLinesGridProps {
  items: readonly SaleItem[];
  warehouses: readonly { id: string; name: string }[];
  locked: boolean;
  saving: boolean;
  isOfficial: boolean;
  /** The line's stock message (out of stock / short): an amber note on the quantity, as before. */
  stockWarning: (row: SaleItem) => string | null;
  /** Search filter of a line's product cell (a Polywood warehouse row: Polywood products only). */
  productWhere: (row: SaleItem) => LookupWhere | undefined;
  /** Units the line may be sold in (getProductSaleUnitOptions of its product). */
  unitOptions: (row: SaleItem) => readonly string[];
  /** A dimensional product with a warehouse: "Select a cut" in the row menu. */
  canCut: (row: SaleItem) => boolean;
  /** A metre line's price per bar hint for the details drawer, or null. */
  metricHint: (row: SaleItem) => { unitPrice: number; barLengthM: number; mode: "linear_m" | "full_sheet" } | null;
  onUpdate: (id: string, patch: Partial<SaleItem>) => void;
  onProduct: (rowId: string, record: LookupRecord | null) => void;
  /** A barcode scanned into this line's product cell found one product. */
  onBarcodeHit: (rowId: string, record: LookupRecord) => void;
  onBarcodeMiss: (code: string) => void;
  onQuantity: (row: SaleItem, quantity: number) => void;
  onQuantityCommit: (row: SaleItem) => void;
  onPriceTier: (row: SaleItem, tier: PriceTier) => void;
  onCurrency: (row: SaleItem, currency: InvoiceCurrency) => void;
  onWarehouse: (rowId: string, warehouseId: string) => void;
  onUnit: (rowId: string, unit: string) => void;
  onCut: (row: SaleItem) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

/**
 * The lines of a sales invoice (GRID-2, behind UI_STANDARD): the standard LineGrid, like
 * PurchaseLinesGrid. Product, quantity with its unit, price, discount, VAT and total by default;
 * warehouse, price type, currency, rate, code, unit, discount type and note are optional columns
 * (also in the details drawer). The grid only shows and edits: prices by price type, stock per
 * warehouse, metre units, VAT, discounts, rates and totals stay in InvoiceForm (rule 7).
 */
export function SalesLinesGrid(props: SalesLinesGridProps) {
  const { items, warehouses, locked, saving, isOfficial, stockWarning, unitOptions, canCut, metricHint, onUpdate } = props;
  const { t, locale } = useI18n();
  const k = (key: string) => t(`invoice.salesLines.${key}`);
  const warehouseOptions = useMemo(() => warehouses.map((w) => ({ value: w.id, label: w.name })), [warehouses]);
  const singleCurrency = new Set(items.map((r) => r.currency || "AZN")).size <= 1;
  const currency = items[0]?.currency || "AZN";
  const noProduct = (row: SaleItem) => !row.product_id;

  const columns: LineColumn<SaleItem>[] = [
    {
      key: "product",
      header: k("product"),
      type: "text",
      width: 264,
      cell: (row, ctx) => (
        <LineProductCell
          value={row.product_id || null}
          selectedLabel={row.product_name || undefined}
          placeholder={t("uiStandard.combobox.placeholder")}
          ctx={ctx}
          where={props.productWhere(row)}
          onBarcodeHit={(record) => props.onBarcodeHit(row.id, record)}
          onBarcodeMiss={props.onBarcodeMiss}
          onChange={(_id, record) => props.onProduct(row.id, record)}
        />
      ),
    },
    {
      key: "quantity",
      header: k("quantity"),
      type: "number",
      width: 124,
      warning: (row) => stockWarning(row),
      cell: (row, ctx) => (
        <LineNumberCell
          ctx={ctx}
          value={row.quantity}
          suffix={row.product_id ? row.unit : null}
          disabled={locked}
          onChange={(v) => v !== null && props.onQuantity(row, v)}
          onCommit={() => props.onQuantityCommit(row)}
        />
      ),
    },
    {
      key: "unit_price",
      header: k("price"),
      type: "money",
      width: 112,
      cell: (row, ctx) => <LineNumberCell ctx={ctx} value={row.unit_price} disabled={locked} onChange={(v) => v !== null && onUpdate(row.id, { unit_price: v })} />,
    },
    {
      key: "discount",
      header: k("discount"),
      type: "number",
      width: 100,
      cell: (row, ctx) => (
        <LineNumberCell
          ctx={ctx}
          value={row.discount_percent}
          suffix={row.discount_type === "fixed" ? row.currency || "AZN" : "%"}
          disabled={locked}
          onChange={(v) => v !== null && onUpdate(row.id, { discount_percent: v })}
        />
      ),
    },
    {
      key: "vat_rate",
      header: k("vat"),
      type: "number",
      width: 72,
      // Set from the product and the invoice's VAT mode (resolveLineVatRate in the form).
      cell: (row) => <LineText muted={!row.vat_rate}>{row.product_id ? formatQuantity(row.vat_rate || 0, locale) : "—"}</LineText>,
    },
    {
      key: "total",
      header: k("total"),
      type: "money",
      width: 120,
      cell: (row) => <LineText className="font-semibold">{formatMoney(row.total, locale, { currency: row.currency || "AZN" })}</LineText>,
      total: singleCurrency ? <LineText>{formatMoney(sumLines(items, (r) => r.total), locale, { currency })}</LineText> : undefined,
    },
    // ── Optional columns (Columns button; always in the details drawer) ──
    {
      key: "warehouse",
      header: k("warehouse"),
      type: "text",
      width: 140,
      optional: true,
      error: (row) => (row.product_id && !row.warehouse_id ? k("noWarehouse") : null),
      cell: (row, ctx) => <LineSelectCell ctx={ctx} value={row.warehouse_id || null} options={warehouseOptions} disabled={locked} onChange={(id) => props.onWarehouse(row.id, id)} />,
    },
    {
      key: "price_tier",
      header: k("priceTier"),
      type: "text",
      width: 128,
      optional: true,
      cell: (row, ctx) => (
        <LineSelectCell
          ctx={ctx}
          value={row.price_tier || "retail"}
          options={PRICE_TIERS.map((tier) => ({ value: tier, label: t(TIER_KEY[tier]) }))}
          disabled={locked || isOfficial || noProduct(row)}
          onChange={(next) => props.onPriceTier(row, next as PriceTier)}
        />
      ),
    },
    {
      key: "currency",
      header: k("currency"),
      type: "code",
      width: 88,
      optional: true,
      cell: (row, ctx) => (
        <LineSelectCell
          ctx={ctx}
          value={row.currency || "AZN"}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          disabled={locked || isOfficial || noProduct(row)}
          onChange={(next) => props.onCurrency(row, next as InvoiceCurrency)}
        />
      ),
    },
    {
      key: "exchange_rate",
      header: k("rate"),
      type: "number",
      width: 96,
      optional: true,
      cell: (row, ctx) =>
        row.currency && row.currency !== "AZN" ? (
          <LineNumberCell ctx={ctx} value={row.exchange_rate || 1} disabled={locked} onChange={(v) => onUpdate(row.id, { exchange_rate: v || 1 })} />
        ) : (
          <LineText muted>—</LineText>
        ),
    },
    {
      key: "product_code",
      header: k("code"),
      type: "code",
      width: 112,
      optional: true,
      cell: (row) => <LineText muted={!row.product_code}>{row.product_code || "—"}</LineText>,
    },
    {
      key: "unit",
      header: k("unit"),
      type: "text",
      width: 96,
      optional: true,
      cell: (row, ctx) => (
        <LineSelectCell
          ctx={ctx}
          value={row.unit || null}
          options={unitOptions(row).map((u) => ({ value: u, label: u }))}
          disabled={locked || noProduct(row)}
          onChange={(unit) => props.onUnit(row.id, unit)}
        />
      ),
    },
    {
      key: "discount_type",
      header: k("discountType"),
      type: "text",
      width: 104,
      optional: true,
      cell: (row, ctx) => (
        <LineSelectCell
          ctx={ctx}
          value={row.discount_type || "percentage"}
          options={[
            { value: "percentage", label: t("invoice.discountPercentOption") },
            { value: "fixed", label: t("invoice.discountFixedOption") },
          ]}
          disabled={locked}
          onChange={(next) => onUpdate(row.id, { discount_type: next as DiscountType })}
        />
      ),
    },
    {
      key: "extra_info",
      header: k("note"),
      type: "text",
      width: 160,
      optional: true,
      cell: (row, ctx) => <LineTextCell ctx={ctx} value={row.extra_info || null} maxLength={500} disabled={locked} placeholder={t("invoice.notePlaceholder")} onChange={(v) => onUpdate(row.id, { extra_info: v ?? "" })} />,
    },
  ];

  const rowMenuItems = (row: SaleItem): LineMenuItem[] =>
    canCut(row) ? [{ key: "cut", label: t("invoice.selectCut"), icon: <Scissors className="h-4 w-4" aria-hidden />, onSelect: () => props.onCut(row), disabled: locked }] : [];

  return (
    <LineGrid
      id="sales-lines"
      label={t("invoice.invoiceItems")}
      lines={items}
      lineKey={(row) => row.id}
      lineLabel={(row, index) => row.product_name || `#${index + 1}`}
      columns={columns}
      labels={lineGridLabels(t)}
      editable={!locked && !saving}
      onAddLine={props.onAdd}
      onRemove={(index) => props.onRemove(items[index].id)}
      onDuplicate={(index) => props.onDuplicate(items[index].id)}
      onReorder={props.onReorder}
      rowMenuItems={rowMenuItems}
      // A line without a warehouse shows the (optional) warehouse column, so its error is seen.
      forceShown={items.some((row) => row.product_id && !row.warehouse_id) ? FORCE_WAREHOUSE : NONE}
      details={(row) => {
        const hint = metricHint(row);
        const stock = row.product_id ? t("invoice.salesLines.stock", { count: formatQuantity(Number(row.available_stock) || 0, locale), unit: row.unit || "" }) : null;
        if (!hint && !stock) return null;
        return (
          <div className="flex flex-col gap-2 text-[length:var(--ds-text-sm)]">
            {stock ? <p className="ds-muted">{stock}</p> : null}
            {hint ? <MetricLinePriceHint unitPrice={hint.unitPrice} barLengthM={hint.barLengthM} mode={hint.mode} /> : null}
          </div>
        );
      }}
    />
  );
}
