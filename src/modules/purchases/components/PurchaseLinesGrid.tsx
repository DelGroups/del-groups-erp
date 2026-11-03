"use client";

import { useMemo } from "react";
import { Ruler } from "lucide-react";
import { LineGrid, LineNumberCell, LineProductCell, LineSelectCell, LineText, sumLines, type LineColumn } from "@/components/line-grid";
import type { LookupRecord } from "@/components/lookups";
import { useI18n } from "@/i18n/I18nProvider";
import { lineGridLabels } from "@/i18n/uiStandardLabels";
import { formatMoney, formatQuantity } from "@/lib/dates/localeDate";
import MetricLinePriceHint from "@/components/polywood/MetricLinePriceHint";
import MetricStockIntakeFields, { type MetricIntakeValue } from "@/components/polywood/MetricStockIntakeFields";
import { isMetricProduct, resolveStandardBarLengthM } from "@/lib/polywood/metricReceive";
import type { InvoiceCurrency, Product, PurchaseLineItem } from "@/types/database.types";

const CURRENCIES: readonly InvoiceCurrency[] = ["AZN", "USD", "EUR"];

/**
 * The received products of a purchase (UI-3, behind UI_STANDARD): the standard LineGrid. One
 * line per row; the product is searched in its cell ("+ New product" creates one there), the
 * rate of a foreign-currency line is an optional column, and the bar lengths of a metric
 * product live in the line's details drawer. Prices, totals and metric rules stay in the form.
 */
export function PurchaseLinesGrid({
  items,
  productList,
  locked,
  isOfficial,
  saving,
  onUpdate,
  onProduct,
  onMetricChange,
  onAdd,
  onRemove,
  onDuplicate,
  onReorder,
  onBarcodeMiss,
}: {
  items: readonly PurchaseLineItem[];
  productList: readonly Product[];
  locked: boolean;
  isOfficial: boolean;
  saving: boolean;
  onUpdate: (id: string, patch: Partial<PurchaseLineItem>) => void;
  /** A product picked or created in a line's cell. */
  onProduct: (rowId: string, record: LookupRecord | null) => void;
  onMetricChange: (rowId: string, product: Product, value: MetricIntakeValue) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onBarcodeMiss: (code: string) => void;
}) {
  const { t, locale } = useI18n();
  const products = useMemo(() => new Map(productList.map((p) => [p.id, p])), [productList]);
  const metricOf = (row: PurchaseLineItem) => {
    const product = products.get(row.product_id);
    return product && isMetricProduct(product) ? product : null;
  };
  const singleCurrency = new Set(items.map((r) => r.currency || "AZN")).size <= 1;
  const currency = items[0]?.currency || "AZN";

  const columns: LineColumn<PurchaseLineItem>[] = [
    {
      key: "product",
      header: t("dashboard.product"),
      type: "text",
      width: 280,
      cell: (row, ctx) => (
        <LineProductCell
          value={row.product_id || null}
          selectedLabel={row.product_name || undefined}
          placeholder={t("uiStandard.combobox.placeholder")}
          ctx={ctx}
          onBarcodeMiss={onBarcodeMiss}
          onChange={(_id, record) => onProduct(row.id, record)}
        />
      ),
    },
    {
      key: "quantity",
      header: t("forms.quantity"),
      type: "number",
      width: 120,
      cell: (row, ctx) => {
        const metric = metricOf(row);
        if (metric && !ctx.inDrawer) {
          // The quantity of a metric product is the sum of its bar lengths, set in the details.
          return (
            <button type="button" className="ds-line-input ds-line-text" onClick={ctx.openDetails} aria-label={ctx.label} disabled={!ctx.openDetails}>
              <Ruler className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-end tabular-nums">{formatQuantity(row.quantity, locale)}</span>
              <span className="ds-line-suffix">m</span>
            </button>
          );
        }
        return <LineNumberCell ctx={ctx} value={row.quantity} suffix={row.unit} disabled={locked} onChange={(v) => onUpdate(row.id, { quantity: v ?? 0 })} />;
      },
    },
    {
      key: "unit_price",
      header: t("forms.buyPrice"),
      type: "money",
      width: 120,
      cell: (row, ctx) => <LineNumberCell ctx={ctx} value={row.unit_price} disabled={locked} onChange={(v) => onUpdate(row.id, { unit_price: v ?? 0 })} />,
    },
    {
      key: "currency",
      header: t("invoice.lineCurrency"),
      type: "code",
      width: 88,
      cell: (row, ctx) => (
        <LineSelectCell
          ctx={ctx}
          value={row.currency || "AZN"}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          disabled={locked || isOfficial || !row.product_id}
          onChange={(next) => {
            const nextCurrency = next as InvoiceCurrency;
            onUpdate(row.id, { currency: nextCurrency, exchange_rate: nextCurrency === "AZN" ? 1 : row.exchange_rate || 1 });
          }}
        />
      ),
    },
    {
      key: "exchange_rate",
      header: t("invoice.exchangeRate"),
      type: "number",
      width: 104,
      optional: true,
      cell: (row, ctx) =>
        row.currency && row.currency !== "AZN" ? (
          <LineNumberCell ctx={ctx} value={row.exchange_rate || 1} disabled={locked} onChange={(v) => onUpdate(row.id, { exchange_rate: v || 1 })} />
        ) : (
          <LineText muted>—</LineText>
        ),
    },
    {
      key: "total",
      header: t("forms.lineTotal"),
      type: "money",
      width: 128,
      cell: (row) => <LineText className="font-semibold">{formatMoney(row.total, locale, { currency: row.currency || "AZN" })}</LineText>,
      total: singleCurrency ? <LineText>{formatMoney(sumLines(items, (r) => r.total), locale, { currency })}</LineText> : undefined,
    },
  ];

  return (
    <LineGrid
      id="purchase-lines"
      label={t("forms.receivedProducts")}
      lines={items}
      lineKey={(row) => row.id}
      lineLabel={(row, index) => row.product_name || `#${index + 1}`}
      columns={columns}
      labels={lineGridLabels(t)}
      editable={!locked && !saving}
      onAddLine={onAdd}
      onRemove={(index) => onRemove(items[index].id)}
      onDuplicate={(index) => onDuplicate(items[index].id)}
      onReorder={onReorder}
      details={(row) => {
        const metric = metricOf(row);
        if (!metric) return null;
        const barLengthM = resolveStandardBarLengthM(metric);
        return (
          <div className="flex flex-col gap-2">
            <MetricStockIntakeFields
              value={{ mode: row.metric_receive_mode || "full_bars", fullBarCount: row.metric_full_bar_count || 0, customLengths: row.metric_custom_lengths || "" }}
              standardLengthM={barLengthM}
              disabled={saving || locked}
              onChange={(value) => onMetricChange(row.id, metric, value)}
            />
            {row.unit_price ? <MetricLinePriceHint unitPrice={row.unit_price} barLengthM={barLengthM} mode="linear_m" /> : null}
          </div>
        );
      }}
    />
  );
}
