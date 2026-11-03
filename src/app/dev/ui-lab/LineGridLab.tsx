"use client";

import { useState } from "react";
import { LineGrid, LineNumberCell, LineText, LineTextCell, duplicateLineAt, reorderByKeys, sumLines, type LineColumn } from "@/components/line-grid";
import { LookupFieldView } from "@/components/lookups";
import { useI18n } from "@/i18n/I18nProvider";
import { lineGridLabels } from "@/i18n/uiStandardLabels";
import { formatMoney } from "@/lib/dates/localeDate";

/*
 * UI lab (UI-3): a document line grid with 30 lines and long Azerbaijani product names, the way a
 * sales invoice or a purchase shows them. Fixture data (no database): the product cell is the
 * lookup's look with fixed rows. npm run ui:guard checks that no row wraps.
 */

interface LabLine {
  key: string;
  productId: string;
  qty: number;
  unit: string;
  price: number;
  hsCode: string | null;
}

const PRODUCTS = [
  "Laminat döşəmə 8 mm, palıd rəngli, su davamlı (Kronospan, Almaniya istehsalı)",
  "MDF lövhə 18 mm 2800×2070, ağ parlaq, iki tərəfli laminasiya",
  "Alüminium kompozit panel 4 mm, gümüşü metallik, PVDF örtüklü",
  "Qapı menteşəsi, yumşaq bağlanan, 110°, nikel örtüklü (Blum Clip Top)",
  "Плита ДСП 16 мм, дуб сонома, двусторонняя ламинация",
  "Vida 4×40",
].map((label, i) => ({ value: `p${i}`, label, hint: `KOD-${1000 + i}` }));

const UNITS = ["vərəq", "ədəd", "m²", "kq"];

const initialLines = (): LabLine[] =>
  Array.from({ length: 30 }, (_, i) => ({
    key: `l${i}`,
    productId: PRODUCTS[i % PRODUCTS.length].value,
    qty: (i % 7) + 1 + (i % 3) * 0.5,
    unit: UNITS[i % UNITS.length],
    price: 12.5 * ((i % 5) + 1) + i * 3.75,
    hsCode: i % 4 === 0 ? `4411.12.${String(i).padStart(2, "0")}` : null,
  }));

export function LineGridLab() {
  const { t, locale } = useI18n();
  const [lines, setLines] = useState<LabLine[]>(initialLines);
  const set = (key: string, patch: Partial<LabLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const nameOf = (id: string) => PRODUCTS.find((p) => p.value === id)?.label ?? "";
  const l = (key: string) => t(`uiStandard.lab.${key}`);

  const columns: LineColumn<LabLine>[] = [
    {
      key: "product",
      header: t("dashboard.product"),
      type: "text",
      width: 260,
      cell: (line, ctx) => (
        <span className="ds-line-lookup">
          <LookupFieldView
            value={line.productId}
            onChange={(id) => id && set(line.key, { productId: id })}
            options={PRODUCTS}
            selectedLabel={nameOf(line.productId)}
            createLabel={t("lookup.create.product")}
            onCreate={() => undefined}
            inlineAdd={false}
            clearable={false}
            size="sm"
            aria-label={ctx.label}
          />
        </span>
      ),
    },
    {
      key: "qty",
      header: l("quantity"),
      type: "number",
      width: 120,
      error: (line) => (line.qty > 0 ? null : l("quantity")),
      cell: (line, ctx) => <LineNumberCell ctx={ctx} value={line.qty} suffix={line.unit} onChange={(v) => set(line.key, { qty: v ?? 0 })} />,
    },
    {
      key: "price",
      header: l("amount"),
      type: "money",
      width: 120,
      cell: (line, ctx) => <LineNumberCell ctx={ctx} value={line.price} onChange={(v) => set(line.key, { price: v ?? 0 })} />,
    },
    {
      key: "total",
      header: t("uiStandard.lineGrid.total"),
      type: "money",
      width: 136,
      cell: (line) => <LineText>{formatMoney(line.qty * line.price, locale)}</LineText>,
      total: <LineText>{formatMoney(sumLines(lines, (x) => x.qty * x.price), locale)}</LineText>,
    },
    {
      key: "hsCode",
      header: "HS",
      type: "code",
      optional: true,
      cell: (line, ctx) => <LineTextCell ctx={ctx} mono value={line.hsCode} onChange={(v) => set(line.key, { hsCode: v })} />,
    },
  ];

  return (
    <div style={{ ["--ds-grid-max-h" as string]: "24rem" }}>
      <LineGrid
        id="ui-lab-lines"
        label={l("lineGrid")}
        scoped={false}
        lines={lines}
        lineKey={(line) => line.key}
        lineLabel={(line) => nameOf(line.productId)}
        columns={columns}
        labels={lineGridLabels(t)}
        onAddLine={() => setLines((prev) => [...prev, { key: `l${Date.now()}`, productId: "", qty: 1, unit: "ədəd", price: 0, hsCode: null }])}
        onRemove={(index) => setLines((prev) => prev.filter((_, i) => i !== index))}
        onDuplicate={(index) => setLines((prev) => duplicateLineAt(prev, index, (x) => ({ ...x, key: `l${Date.now()}` })))}
        onReorder={(keys) => setLines((prev) => reorderByKeys(prev, keys, (x) => x.key))}
      />
    </div>
  );
}
