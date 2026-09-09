"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  calcQuotationLine,
  calcQuotationTotals,
  type CrmDeal,
  type CrmQuotation,
  type QuotationItem,
} from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

type CatalogProduct = {
  id: string;
  code: string;
  name: string;
  unit: string;
  buy_price: number;
  sell_price: number;
};

interface QuotationBuilderModalProps {
  isOpen: boolean;
  deal: CrmDeal | null;
  quotation?: CrmQuotation | null;
  products: CatalogProduct[];
  saving?: boolean;
  defaultValidityDays?: number;
  onClose: () => void;
  onSubmit: (payload: {
    items: QuotationItem[];
    discount: number;
    taxRate: number;
    validUntil: string;
    notes: string;
    status: "DRAFT" | "SENT" | "WON";
  }) => void | Promise<void>;
}

function emptyItem(): QuotationItem {
  return {
    product_id: null,
    product_code: "",
    product_name: "",
    unit: "Ədəd",
    quantity: 1,
    cost_price: 0,
    margin_percent: 20,
    unit_price: 0,
    line_total: 0,
  };
}

function withPricing(item: QuotationItem): QuotationItem {
  const priced = calcQuotationLine(item.quantity, item.cost_price, item.margin_percent);
  return { ...item, unit_price: priced.unitPrice, line_total: priced.lineTotal };
}

export default function QuotationBuilderModal({
  isOpen,
  deal,
  quotation,
  products,
  saving,
  defaultValidityDays = 14,
  onClose,
  onSubmit,
}: QuotationBuilderModalProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<QuotationItem[]>([emptyItem()]);
  const [discount, setDiscount] = useState("0");
  const [taxRate, setTaxRate] = useState("0");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (quotation) {
      setItems(quotation.items_json.length ? quotation.items_json.map(withPricing) : [emptyItem()]);
      setDiscount(String(quotation.discount || 0));
      const subtotal = quotation.items_json.reduce((s, i) => s + i.line_total, 0);
      const taxable = Math.max(0, subtotal - quotation.discount);
      setTaxRate(taxable > 0 ? ((quotation.tax / taxable) * 100).toFixed(1) : "0");
      setValidUntil(quotation.valid_until || "");
      setNotes(quotation.notes || "");
      return;
    }
    const until = new Date();
    until.setDate(until.getDate() + Math.max(1, defaultValidityDays));
    setItems([emptyItem()]);
    setDiscount("0");
    setTaxRate("0");
    setValidUntil(until.toISOString().slice(0, 10));
    setNotes("");
  }, [defaultValidityDays, isOpen, quotation]);

  const totals = useMemo(
    () => calcQuotationTotals(items, Number(discount) || 0, Number(taxRate) || 0),
    [items, discount, taxRate]
  );

  if (!isOpen || !deal) return null;

  const updateItem = (index: number, patch: Partial<QuotationItem>) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? withPricing({ ...item, ...patch }) : item))
    );
  };

  const applyProduct = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateItem(index, { product_id: null });
      return;
    }
    const cost = product.buy_price || product.sell_price;
    const sell = product.sell_price || cost;
    const margin = cost > 0 ? ((sell - cost) / cost) * 100 : 20;
    updateItem(index, {
      product_id: product.id,
      product_code: product.code,
      product_name: product.name,
      unit: product.unit,
      cost_price: cost,
      margin_percent: Number(margin.toFixed(1)),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto app-scrim p-4">
      <div className="app-modal my-6 w-full max-w-4xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="font-bold text-app">{t("crm.quote.title")}</h3>
            <p className="text-[11px] text-app-muted">{deal.title}</p>
          </div>
          <button type="button" onClick={onClose} className="text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="overflow-x-auto rounded-xl border border-app">
            <table className="w-full text-left text-xs">
              <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
                <tr>
                  <th className="px-3 py-2">{t("crm.quote.product")}</th>
                  <th className="px-3 py-2">{t("crm.quote.qty")}</th>
                  <th className="px-3 py-2">{t("crm.quote.cost")}</th>
                  <th className="px-3 py-2">{t("crm.quote.margin")}</th>
                  <th className="px-3 py-2">{t("crm.quote.unitPrice")}</th>
                  <th className="px-3 py-2">{t("crm.quote.lineTotal")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, index) => (
                  <tr key={index}>
                    <td className="px-3 py-2">
                      <select
                        value={item.product_id || ""}
                        onChange={(e) => applyProduct(index, e.target.value)}
                        className="app-input text-xs"
                      >
                        <option value="">{t("crm.quote.customItem")}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name}
                          </option>
                        ))}
                      </select>
                      {!item.product_id && (
                        <input
                          value={item.product_name}
                          onChange={(e) => updateItem(index, { product_name: e.target.value })}
                          placeholder={t("crm.quote.itemName")}
                          className="mt-1 w-full rounded border px-2 py-1 text-xs"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, { quantity: Number(e.target.value) || 0 })}
                        className="w-20 rounded border px-2 py-1 font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.cost_price}
                        onChange={(e) => updateItem(index, { cost_price: Number(e.target.value) || 0 })}
                        className="w-24 rounded border px-2 py-1 font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.1"
                        value={item.margin_percent}
                        onChange={(e) =>
                          updateItem(index, { margin_percent: Number(e.target.value) || 0 })
                        }
                        className="w-20 rounded border px-2 py-1 font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono">{item.unit_price.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono font-bold">{item.line_total.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                        className="rounded p-1 text-rose-600 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, emptyItem()])}
            className="flex items-center gap-1 text-xs font-bold text-app-accent"
          >
            <Plus className="h-4 w-4" />
            {t("crm.quote.addLine")}
          </button>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-xs font-semibold">
              {t("crm.quote.discount")}
              <input
                type="number"
                min="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-semibold">
              {t("crm.quote.taxRate")}
              <input
                type="number"
                min="0"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-semibold">
              {t("crm.quote.validUntil")}
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="block text-xs font-semibold">
            {t("common.notes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <div className="rounded-xl border border-app bg-app-card-hover p-4 text-right">
            <p className="text-[11px] text-app-muted">{t("crm.quote.total")}</p>
            <p className="font-mono text-xl font-bold text-app">
              {totals.total.toFixed(2)} {t("common.currency")}
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-app pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-xs font-semibold">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void onSubmit({
                  items,
                  discount: Number(discount) || 0,
                  taxRate: Number(taxRate) || 0,
                  validUntil,
                  notes,
                  status: "DRAFT",
                })
              }
              className="rounded-lg border px-4 py-2 text-xs font-semibold"
            >
              {t("crm.quote.saveDraft")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void onSubmit({
                  items,
                  discount: Number(discount) || 0,
                  taxRate: Number(taxRate) || 0,
                  validUntil,
                  notes,
                  status: "SENT",
                })
              }
              className="rounded-lg bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-bold text-white"
            >
              {t("crm.quote.markSent")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void onSubmit({
                  items,
                  discount: Number(discount) || 0,
                  taxRate: Number(taxRate) || 0,
                  validUntil,
                  notes,
                  status: "WON",
                })
              }
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
            >
              {t("crm.quote.markWon")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
