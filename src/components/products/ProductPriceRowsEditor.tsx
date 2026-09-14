"use client";

import { Plus, Trash2 } from "lucide-react";
import Button from "@/components/ui/button";
import {
  formInputGroupClass,
  formNumberInputClass,
  formSelectClass,
} from "@/components/ui/form-field-styles";
import { useI18n } from "@/i18n/I18nProvider";
import type { PriceEntryUnit } from "@/lib/products/productPriceUnits";
import {
  createPriceRow,
  type ProductPriceRow,
  type ProductPriceRowsState,
} from "@/lib/products/productPriceRows";

const PRICE_UNITS: PriceEntryUnit[] = ["piece", "meter", "square_meter"];
const MAX_ROWS = 4;

interface PriceSideEditorProps {
  title: string;
  rows: ProductPriceRow[];
  onChange: (rows: ProductPriceRow[]) => void;
}

function PriceSideEditor({ title, rows, onChange }: PriceSideEditorProps) {
  const { t } = useI18n();

  const unitLabel = (unit: PriceEntryUnit) => {
    if (unit === "meter") return t("forms.priceUnitMeter");
    if (unit === "square_meter") return t("forms.priceUnitSquareMeter");
    return t("forms.priceUnitPiece");
  };

  const updateRow = (id: string, patch: Partial<ProductPriceRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id: string) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((row) => row.id !== id));
  };

  const addRow = () => {
    if (rows.length >= MAX_ROWS) return;
    const usedUnits = new Set(rows.map((row) => row.unit));
    const nextUnit =
      PRICE_UNITS.find((unit) => !usedUnits.has(unit)) ?? rows[rows.length - 1]?.unit ?? "piece";
    onChange([...rows, createPriceRow("", nextUnit)]);
  };

  return (
    <div className="min-w-0 space-y-3 rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)]/40 p-3">
      <p className="text-[length:var(--erp-text-sm)] font-semibold text-[color:var(--erp-text-main)]">
        {title}
      </p>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="flex min-w-0 items-center gap-2">
            <div className={`${formInputGroupClass} min-w-0 flex-1`}>
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={row.price}
                onChange={(event) => updateRow(row.id, { price: event.target.value })}
                placeholder={index === 0 ? "0.00" : t("forms.optionalPricePlaceholder")}
                className={formNumberInputClass}
                aria-label={`${title} ${index + 1}`}
              />
              <select
                value={row.unit}
                onChange={(event) =>
                  updateRow(row.id, { unit: event.target.value as PriceEntryUnit })
                }
                className={formSelectClass}
                aria-label={t("forms.unitMeasure")}
              >
                {PRICE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitLabel(unit)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 px-2"
              onClick={() => removeRow(row.id)}
              disabled={rows.length <= 1}
              aria-label={t("forms.removePriceRow")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={addRow}
        disabled={rows.length >= MAX_ROWS}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("forms.addPriceRow")}
      </Button>
    </div>
  );
}

interface ProductPriceRowsEditorProps {
  value: ProductPriceRowsState;
  onChange: (value: ProductPriceRowsState) => void;
}

export default function ProductPriceRowsEditor({ value, onChange }: ProductPriceRowsEditorProps) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <PriceSideEditor
        title={t("forms.purchasePriceColumn")}
        rows={value.buy}
        onChange={(buy) => onChange({ ...value, buy })}
      />
      <PriceSideEditor
        title={t("forms.sellingPriceColumn")}
        rows={value.sell}
        onChange={(sell) => onChange({ ...value, sell })}
      />
    </div>
  );
}
