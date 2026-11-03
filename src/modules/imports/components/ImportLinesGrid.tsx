"use client";

import { useMemo } from "react";
import { EntityLookup, type LookupRecord } from "@/components/lookups";
import { LineGrid, LineNumberCell, LineProductCell, LineText, LineTextCell, sumLines, type LineColumn } from "@/components/line-grid";
import { useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { lineGridLabels } from "@/i18n/uiStandardLabels";
import { formatMoney, formatQuantity } from "@/lib/dates/localeDate";
import { round2 } from "@/lib/imports/landedCost";
import type { ImportLookups } from "../actions/imports";
import { changeLineProduct, duplicateLine, newLine, setLineQtyPurchase, type ImportProduct, type ShipmentDraft, type ShipmentLineDraft } from "../lib/shipment";

/**
 * The product lines of an import (UI-3, behind UI_STANDARD): the standard LineGrid. A line starts
 * from a product search in the new row ("+ New product" creates one there), rarely used fields
 * (weight, volume, HS code, warehouse per line) are optional columns and live in the details
 * drawer, so the default grid fits a 1280 px window. Business rules stay in lib/shipment.
 */
export function ImportLinesGrid({
  draft,
  setDraft,
  editable,
  products,
  lookups,
  showIssues,
  importProductOf,
  onRemember,
}: {
  draft: ShipmentDraft;
  setDraft: (update: (d: ShipmentDraft) => ShipmentDraft) => void;
  editable: boolean;
  products: ReadonlyMap<string, ImportProduct>;
  lookups: ImportLookups;
  showIssues: boolean;
  importProductOf: (row: LookupRecord) => ImportProduct;
  onRemember: (patch: { product?: LookupRecord; warehouse?: LookupRecord }) => void;
}) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const label = (key: string) => t(`imports.fields.${key}`);
  const issue = (key: string) => (showIssues ? t(`imports.draftIssues.${key}`) : null);

  const setLine = (key: string, update: (l: ShipmentLineDraft) => ShipmentLineDraft) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? update(l) : l)) }));
  const productOf = (row: LookupRecord) => products.get(row.id) ?? importProductOf(row);
  const barcodeMiss = (code: string) => toast(t("uiStandard.lineGrid.barcodeMiss", { code }), undefined, "error");
  const where = { is_service: false, is_composite: false } as const;

  const columns = useMemo<LineColumn<ShipmentLineDraft>[]>(() => {
    const totalFc = sumLines(draft.lines, (l) => l.qtyPurchase * l.unitPriceFc);
    const totalKg = sumLines(draft.lines, (l) => l.weightKg, 3);
    return [
      {
        key: "product",
        header: label("product"),
        type: "text",
        width: 260,
        error: (l) => (l.productId ? null : issue("line_product")),
        cell: (l, ctx) => (
          <LineProductCell
            value={l.productId || null}
            selectedLabel={products.get(l.productId)?.name}
            where={where}
            ctx={ctx}
            onBarcodeMiss={barcodeMiss}
            onChange={(_id, row) => {
              if (!row) return;
              onRemember({ product: row });
              setLine(l.key, (line) => changeLineProduct(line, productOf(row)));
            }}
          />
        ),
      },
      {
        key: "qtyPurchase",
        header: label("qtyPurchase"),
        type: "number",
        width: 112,
        error: (l) => (l.qtyPurchase > 0 ? null : issue("line_quantity")),
        cell: (l, ctx) => (
          <LineNumberCell
            ctx={ctx}
            value={l.qtyPurchase}
            suffix={l.purchaseUnit}
            onChange={(v) => setLine(l.key, (line) => setLineQtyPurchase(line, v ?? 0, products.get(line.productId)))}
          />
        ),
      },
      {
        key: "qtyStock",
        header: label("qtyStock"),
        type: "number",
        width: 104,
        error: (l) => (l.qtyStock > 0 ? null : issue("line_quantity")),
        cell: (l, ctx) => {
          const sheet = products.get(l.productId)?.sheetLengthM;
          return sheet ? (
            <span title={t("imports.sheetHint", { length: sheet })} className="block">
              <LineText suffix={t("imports.units.metre")}>{formatQuantity(l.qtyStock, locale)}</LineText>
            </span>
          ) : (
            <LineNumberCell ctx={ctx} value={l.qtyStock} onChange={(v) => setLine(l.key, (line) => ({ ...line, qtyStock: v ?? 0 }))} />
          );
        },
      },
      {
        key: "unitPriceFc",
        header: `${label("unitPriceFc")} (${draft.currencyCode})`,
        type: "money",
        width: 120,
        error: (l) => (l.unitPriceFc >= 0 ? null : issue("line_price")),
        cell: (l, ctx) => <LineNumberCell ctx={ctx} value={l.unitPriceFc} onChange={(v) => setLine(l.key, (line) => ({ ...line, unitPriceFc: v ?? 0 }))} />,
      },
      {
        key: "lineTotalFc",
        header: `${label("lineTotalFc")} (${draft.currencyCode})`,
        type: "money",
        width: 128,
        cell: (l) => <LineText>{formatMoney(round2(l.qtyPurchase * l.unitPriceFc), locale, { currency: null })}</LineText>,
        total: <LineText>{formatMoney(totalFc, locale, { currency: null })}</LineText>,
      },
      {
        key: "dutyRatePct",
        header: label("dutyRatePct"),
        type: "number",
        width: 88,
        error: (l) => (l.dutyRatePct >= 0 && l.dutyRatePct <= 100 ? null : issue("line_duty")),
        cell: (l, ctx) => (
          <LineNumberCell ctx={ctx} value={l.dutyRatePct} suffix="%" max={100} onChange={(v) => setLine(l.key, (line) => ({ ...line, dutyRatePct: Math.min(100, v ?? 0) }))} />
        ),
      },
      {
        key: "weightKg",
        header: label("weightKg"),
        type: "number",
        width: 104,
        optional: true,
        cell: (l, ctx) => <LineNumberCell ctx={ctx} value={l.weightKg} suffix="kg" onChange={(v) => setLine(l.key, (line) => ({ ...line, weightKg: v }))} />,
        total: <LineText suffix="kg">{formatQuantity(totalKg, locale)}</LineText>,
      },
      {
        key: "volumeM3",
        header: label("volumeM3"),
        type: "number",
        width: 96,
        optional: true,
        cell: (l, ctx) => <LineNumberCell ctx={ctx} value={l.volumeM3} suffix="m³" onChange={(v) => setLine(l.key, (line) => ({ ...line, volumeM3: v }))} />,
      },
      {
        key: "hsCode",
        header: label("hsCode"),
        type: "code",
        width: 112,
        optional: true,
        cell: (l, ctx) => <LineTextCell ctx={ctx} mono maxLength={20} value={l.hsCode} onChange={(v) => setLine(l.key, (line) => ({ ...line, hsCode: v }))} />,
      },
      {
        key: "warehouse",
        header: label("warehouse"),
        type: "text",
        width: 180,
        optional: true,
        cell: (l, ctx) =>
          ctx.editable ? (
            <span className="ds-line-lookup">
              <EntityLookup
                entity="warehouse"
                size="sm"
                width="full"
                inlineAdd={false}
                value={l.warehouseId}
                selectedLabel={lookups.warehouses.find((w) => w.id === l.warehouseId)?.name}
                placeholder={t("imports.headerWarehouse")}
                onChange={(id, row) => {
                  if (row) onRemember({ warehouse: row });
                  setLine(l.key, (line) => ({ ...line, warehouseId: id }));
                }}
                aria-label={ctx.label}
              />
            </span>
          ) : (
            <LineText muted={!l.warehouseId}>{lookups.warehouses.find((w) => w.id === l.warehouseId)?.name ?? t("imports.headerWarehouse")}</LineText>
          ),
      },
    ];
    // The columns are rebuilt with the draft; the helpers above only close over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.lines, draft.currencyCode, products, lookups.warehouses, showIssues, t, locale]);

  return (
    <LineGrid
      id="imports-lines"
      label={t("imports.sections.lines")}
      lines={draft.lines}
      lineKey={(l) => l.key}
      lineLabel={(l) => products.get(l.productId)?.name ?? ""}
      columns={columns}
      labels={lineGridLabels(t)}
      editable={editable}
      newLineCell={(done) => (
        <LineProductCell
          value={null}
          autoOpen
          where={where}
          placeholder={t("imports.addProductPlaceholder")}
          onBarcodeMiss={barcodeMiss}
          ctx={{ index: draft.lines.length, label: t("imports.addProduct"), invalid: false, editable: true, inDrawer: false }}
          onChange={(_id, row) => {
            if (!row) return;
            onRemember({ product: row });
            setDraft((d) => ({ ...d, lines: [...d.lines, newLine(productOf(row))] }));
            done();
          }}
        />
      )}
      onRemove={(index) => setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }))}
      onDuplicate={(index) => setDraft((d) => ({ ...d, lines: d.lines.flatMap((l, i) => (i === index ? [l, duplicateLine(l)] : [l])) }))}
      onReorder={(keys) => setDraft((d) => ({ ...d, lines: keys.map((k) => d.lines.find((l) => l.key === k)).filter((l): l is ShipmentLineDraft => !!l) }))}
    />
  );
}
