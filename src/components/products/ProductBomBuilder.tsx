"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Product } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

export type BomBuilderRow = {
  id: string;
  componentProductId: string;
  quantity: string;
};

type ProductBomBuilderProps = {
  products: Product[];
  parentProductId?: string;
  rows: BomBuilderRow[];
  onChange: (rows: BomBuilderRow[]) => void;
};

function newRow(): BomBuilderRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    componentProductId: "",
    quantity: "1",
  };
}

export default function ProductBomBuilder({
  products,
  parentProductId,
  rows,
  onChange,
}: ProductBomBuilderProps) {
  const { t } = useI18n();

  const componentOptions = products.filter((p) => p.id !== parentProductId && !p.is_composite);

  return (
    <div className="space-y-3 rounded-xl border border-app bg-app-card-hover p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-app">{t("products.bom.title")}</h3>
        <button type="button" className="btn-secondary" onClick={() => onChange([...rows, newRow()])}>
          <Plus className="h-4 w-4" />
          {t("products.bom.addComponent")}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-app-muted">{t("products.bom.empty")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-12 gap-2">
              <select
                value={row.componentProductId}
                onChange={(e) =>
                  onChange(
                    rows.map((item) =>
                      item.id === row.id ? { ...item, componentProductId: e.target.value } : item
                    )
                  )
                }
                className="app-input col-span-8 text-sm"
              >
                <option value="">{t("products.bom.selectComponent")}</option>
                {componentOptions.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.code} — {product.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0.0001"
                step="0.0001"
                value={row.quantity}
                onChange={(e) =>
                  onChange(
                    rows.map((item) =>
                      item.id === row.id ? { ...item, quantity: e.target.value } : item
                    )
                  )
                }
                className="app-input col-span-3 text-sm"
                placeholder="1"
              />
              <button
                type="button"
                className="btn-secondary col-span-1"
                onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
