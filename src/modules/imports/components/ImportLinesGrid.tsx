"use client";

import { useMemo, useState } from "react";
import { Split } from "lucide-react";
import { EntityLookup, type LookupRecord } from "@/components/lookups";
import { LineGrid, LineNumberCell, LineProductCell, LineText, LineTextCell, sumLines, type LineColumn } from "@/components/line-grid";
import { Truncate, useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { lineGridLabels } from "@/i18n/uiStandardLabels";
import { formatFigure, formatMoney, formatQuantity } from "@/lib/dates/localeDate";
import { round2, type LandedCostResult, type SplitMethod } from "@/lib/imports/landedCost";
import type { ImportLookups } from "../actions/imports";
import { applySplit, effectiveWarehouses, followLineQuantity, removeSplit } from "../lib/lineWarehouses";
import { changeLineProduct, duplicateLine, newLine, setLineQtyPurchase, type ImportProduct, type ShipmentDraft, type ShipmentLineDraft } from "../lib/shipment";
import { WarehouseSplitDrawer } from "./WarehouseSplitDrawer";

const WEIGHT_METHODS: readonly SplitMethod[] = ["by_weight", "chargeable_weight"];
const VOLUME_METHODS: readonly SplitMethod[] = ["by_volume"];

/**
 * The product lines of an import (UI-3 / IMP-4, behind UI_STANDARD): the standard LineGrid. A line
 * starts from a product search in the new row ("+ New product" creates one there). Every line shows
 * its warehouse (the header's default in muted text until it has its own, or "3 warehouses" when
 * split), its live landed cost per stock unit and its stock quantity (metres for sheets). Weight,
 * volume and HS code are optional columns; when a capitalized cost is split by weight or volume
 * and a line lacks it, the column shows on its own with the missing cells marked. Business rules
 * stay in lib/shipment and lib/lineWarehouses.
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
  result,
  splitsAvailable = true,
}: {
  draft: ShipmentDraft;
  setDraft: (update: (d: ShipmentDraft) => ShipmentDraft) => void;
  editable: boolean;
  products: ReadonlyMap<string, ImportProduct>;
  lookups: ImportLookups;
  showIssues: boolean;
  importProductOf: (row: LookupRecord) => ImportProduct;
  onRemember: (patch: { product?: LookupRecord; warehouse?: LookupRecord }) => void;
  /** The live landed cost (per line unit cost). */
  result?: LandedCostResult;
  /** False before the IMP-4 migration: no "Split across warehouses". */
  splitsAvailable?: boolean;
}) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [splitting, setSplitting] = useState<string | null>(null);
  const label = (key: string) => t(`imports.fields.${key}`);
  const issue = (key: string) => (showIssues ? t(`imports.draftIssues.${key}`) : null);
  const warehouseName = (id: string | null) => lookups.warehouses.find((w) => w.id === id)?.name ?? null;

  const setLine = (key: string, update: (l: ShipmentLineDraft) => ShipmentLineDraft) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? update(l) : l)) }));
  const productOf = (row: LookupRecord) => products.get(row.id) ?? importProductOf(row);
  const barcodeMiss = (code: string) => toast(t("uiStandard.lineGrid.barcodeMiss", { code }), undefined, "error");
  const where = { is_service: false, is_composite: false } as const;

  // A capitalized cost split by weight / volume needs it on every line: show the column.
  const needs = useMemo(() => {
    const capitalized = draft.costs.filter((c) => c.isCapitalized && c.costType !== "customs_vat");
    return {
      weight: capitalized.some((c) => WEIGHT_METHODS.includes(c.splitMethod)) && draft.lines.some((l) => !(Number(l.weightKg) > 0)),
      volume: capitalized.some((c) => VOLUME_METHODS.includes(c.splitMethod)) && draft.lines.some((l) => !(Number(l.volumeM3) > 0)),
    };
  }, [draft.costs, draft.lines]);
  const forceShown = [needs.weight ? "weightKg" : null, needs.volume ? "volumeM3" : null].filter((k): k is string => !!k);

  const columns = useMemo<LineColumn<ShipmentLineDraft>[]>(() => {
    const totalFc = sumLines(draft.lines, (l) => l.qtyPurchase * l.unitPriceFc);
    const totalKg = sumLines(draft.lines, (l) => l.weightKg, 3);
    const totalQty = sumLines(draft.lines, (l) => l.qtyPurchase, 3);
    const unitCost = new Map((result?.lines ?? []).map((l) => [l.id, l.unitCostStock]));
    return [
      {
        key: "product",
        header: label("product"),
        type: "text",
        width: 176,
        error: (l) => (l.productId ? null : issue("line_product")),
        cell: (l, ctx) => {
          const p = products.get(l.productId);
          return (
            <LineProductCell
              value={l.productId || null}
              selectedLabel={p ? `${p.code} · ${p.name}` : undefined}
              where={where}
              ctx={ctx}
              onBarcodeMiss={barcodeMiss}
              onChange={(_id, row) => {
                if (!row) return;
                onRemember({ product: row });
                setLine(l.key, (line) => changeLineProduct(line, productOf(row)));
              }}
            />
          );
        },
        total: <LineText>{t("imports.linesTotal", { count: draft.lines.length })}</LineText>,
      },
      {
        key: "qtyPurchase",
        header: label("qtyPurchase"),
        type: "number",
        width: 96,
        error: (l) => (l.qtyPurchase > 0 ? null : issue("line_quantity")),
        cell: (l, ctx) => (
          <LineNumberCell
            ctx={ctx}
            value={l.qtyPurchase}
            suffix={l.purchaseUnit}
            onChange={(v) => setLine(l.key, (line) => followLineQuantity(setLineQtyPurchase(line, v ?? 0, products.get(line.productId)), v ?? 0))}
          />
        ),
        total: <LineText>{formatQuantity(totalQty, locale)}</LineText>,
      },
      {
        key: "qtyStock",
        header: label("qtyStockShort"),
        type: "number",
        width: 100,
        error: (l) => (l.qtyStock > 0 ? null : issue("line_quantity")),
        cell: (l, ctx) => {
          const sheet = products.get(l.productId)?.sheetLengthM;
          return sheet ? (
            <span title={t("imports.sheetHint", { length: sheet })} className="block">
              <LineText muted suffix={t("imports.units.metre")}>{formatQuantity(l.qtyStock, locale)}</LineText>
            </span>
          ) : (
            <LineNumberCell ctx={ctx} value={l.qtyStock} onChange={(v) => setLine(l.key, (line) => ({ ...line, qtyStock: v ?? 0 }))} />
          );
        },
      },
      {
        key: "unitPriceFc",
        header: `${label("unitPriceFc")}, ${draft.currencyCode}`,
        type: "money",
        width: 104,
        error: (l) => (l.unitPriceFc >= 0 ? null : issue("line_price")),
        cell: (l, ctx) => <LineNumberCell ctx={ctx} value={l.unitPriceFc} onChange={(v) => setLine(l.key, (line) => ({ ...line, unitPriceFc: v ?? 0 }))} />,
      },
      {
        key: "lineTotalFc",
        header: `${label("lineTotalFc")}, ${draft.currencyCode}`,
        type: "money",
        width: 104,
        cell: (l) => <LineText>{formatMoney(round2(l.qtyPurchase * l.unitPriceFc), locale, { currency: null })}</LineText>,
        total: <LineText>{formatMoney(totalFc, locale, { currency: null })}</LineText>,
      },
      {
        key: "dutyRatePct",
        header: label("dutyRatePct"),
        type: "number",
        width: 80,
        error: (l) => (l.dutyRatePct >= 0 && l.dutyRatePct <= 100 ? null : issue("line_duty")),
        cell: (l, ctx) => (
          <LineNumberCell ctx={ctx} value={l.dutyRatePct} suffix="%" max={100} onChange={(v) => setLine(l.key, (line) => ({ ...line, dutyRatePct: Math.min(100, v ?? 0) }))} />
        ),
      },
      {
        key: "warehouse",
        header: label("warehouse"),
        type: "text",
        width: 116,
        error: (l) => (l.warehouses.length ? splitIssueText(l) : null),
        cell: (l, ctx) => {
          if (l.warehouses.length) {
            const shares = effectiveWarehouses(l, draft.defaultWarehouseId, products.get(l.productId)?.sheetLengthM ?? null);
            const list = shares.map((s) => `${warehouseName(s.warehouseId) ?? "—"}: ${formatQuantity(s.qtyPurchase, locale)} ${l.purchaseUnit ?? ""}`.trim()).join("\n");
            return (
              <button
                type="button"
                className="ds-line-text ds-line-split-cell"
                title={list}
                aria-label={`${ctx.label}: ${list.replace(/\n/g, ", ")}`}
                onClick={() => setSplitting(l.key)}
                data-line-focus=""
              >
                <Split className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <Truncate>{t("imports.whSplit.count", { count: shares.length })}</Truncate>
              </button>
            );
          }
          const fallback = warehouseName(draft.defaultWarehouseId);
          return ctx.editable ? (
            <span className="ds-line-lookup">
              <EntityLookup
                entity="warehouse"
                size="sm"
                width="full"
                inlineAdd={false}
                value={l.warehouseId}
                selectedLabel={warehouseName(l.warehouseId) ?? undefined}
                // No warehouse of its own: the header's, muted, and it follows the header.
                placeholder={fallback ?? t("imports.headerWarehouse")}
                onChange={(id, row) => {
                  if (row) onRemember({ warehouse: row });
                  setLine(l.key, (line) => ({ ...line, warehouseId: id }));
                }}
                aria-label={ctx.label}
              />
            </span>
          ) : (
            <LineText muted={!l.warehouseId}>{warehouseName(l.warehouseId) ?? fallback ?? t("imports.headerWarehouse")}</LineText>
          );
        },
      },
      {
        key: "landedUnit",
        header: t("imports.fields.landedUnit"),
        type: "money",
        width: 92,
        cell: (l) => {
          const v = unitCost.get(l.key);
          const unit = products.get(l.productId)?.sheetLengthM ? t("imports.units.metre") : l.purchaseUnit || t("imports.units.unit");
          return v === undefined || !(l.qtyStock > 0) ? (
            <LineText muted>—</LineText>
          ) : (
            <span title={t("imports.landedUnitHint", { unit })} className="block">
              <LineText className="font-semibold" suffix={`/${unit}`}>{formatFigure(v, v < 1 ? 4 : 2, locale)}</LineText>
            </span>
          );
        },
      },
      {
        key: "weightKg",
        header: label("weightKg"),
        type: "number",
        width: 96,
        optional: true,
        warning: (l) => (needs.weight && !(Number(l.weightKg) > 0) ? t("imports.missingWeight") : null),
        cell: (l, ctx) => <LineNumberCell ctx={ctx} value={l.weightKg} suffix="kg" onChange={(v) => setLine(l.key, (line) => ({ ...line, weightKg: v }))} />,
        total: <LineText suffix="kg">{formatQuantity(totalKg, locale)}</LineText>,
      },
      {
        key: "volumeM3",
        header: label("volumeM3"),
        type: "number",
        width: 88,
        optional: true,
        warning: (l) => (needs.volume && !(Number(l.volumeM3) > 0) ? t("imports.missingVolume") : null),
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
    ];
    // The columns are rebuilt with the draft; the helpers above only close over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.lines, draft.currencyCode, draft.defaultWarehouseId, products, lookups.warehouses, showIssues, result, needs, t, locale]);

  function splitIssueText(l: ShipmentLineDraft): string | null {
    return l.warehouses.some((s) => !s.warehouseId) || Math.abs(l.warehouses.reduce((s, x) => s + x.qtyPurchase, 0) - l.qtyPurchase) > 0.0005
      ? t("imports.draftIssues.line_warehouse_split")
      : null;
  }

  const splitLine = splitting ? draft.lines.find((l) => l.key === splitting) ?? null : null;

  return (
    <>
      <LineGrid
        id="imports-lines"
        label={t("imports.sections.lines")}
        lines={draft.lines}
        lineKey={(l) => l.key}
        lineLabel={(l) => products.get(l.productId)?.name ?? ""}
        columns={columns}
        labels={lineGridLabels(t)}
        editable={editable}
        forceShown={forceShown}
        rowMenuItems={(l) =>
          splitsAvailable
            ? [
                {
                  key: "split",
                  label: l.warehouses.length ? t("imports.whSplit.edit") : t("imports.whSplit.open"),
                  icon: <Split className="h-4 w-4" aria-hidden />,
                  onSelect: () => setSplitting(l.key),
                },
                ...(editable && l.warehouses.length
                  ? [{ key: "unsplit", label: t("imports.whSplit.remove"), onSelect: () => setLine(l.key, removeSplit) }]
                  : []),
              ]
            : []
        }
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
      {splitLine ? (
        <WarehouseSplitDrawer
          line={splitLine}
          product={products.get(splitLine.productId)}
          defaultWarehouseId={draft.defaultWarehouseId}
          warehouses={lookups.warehouses}
          editable={editable}
          onRemember={(row) => onRemember({ warehouse: row })}
          onClose={() => setSplitting(null)}
          onApply={(splits) => {
            setLine(splitLine.key, (line) => applySplit(line, splits));
            setSplitting(null);
          }}
        />
      ) : null}
    </>
  );
}
