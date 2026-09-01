"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  deleteProductionBomAction,
  fetchProductionLookupsAction,
  saveProductionBomAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import type { ProductionBom } from "@/lib/production/types";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { Layers, Trash2 } from "lucide-react";

interface DraftItem {
  product_id: string;
  quantity: string;
  warehouse_id: string;
}

export default function ProductionBomPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_production");
  const [lookups, setLookups] = useState<ProductionLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finishedProductId, setFinishedProductId] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([{ product_id: "", quantity: "1", warehouse_id: "" }]);
  const initialLoadStarted = useRef(false);
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchProductionLookupsAction();
    if (result.success && result.data) setLookups(result.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    queueMicrotask(() => void load());
  }, [load]);

  const editBom = (bom: ProductionBom) => {
    setFinishedProductId(bom.finished_product_id);
    setName(bom.name);
    setNotes(bom.notes || "");
    setItems(
      bom.items.length
        ? bom.items.map((item) => ({
            product_id: item.product_id,
            quantity: String(item.quantity),
            warehouse_id: item.warehouse_id || "",
          }))
        : [{ product_id: "", quantity: "1", warehouse_id: "" }]
    );
  };

  const handleSave = async () => {
    const product = lookups?.products.find((p) => p.id === finishedProductId);
    if (!product) {
      showError(t("production.selectFinishedProduct"));
      return;
    }
    const mapped = items
      .map((item) => {
        const component = lookups?.products.find((p) => p.id === item.product_id);
        const warehouse = lookups?.warehouses.find((w) => w.id === item.warehouse_id);
        if (!component || Number(item.quantity) <= 0) return null;
        return {
          product_id: component.id,
          product_code: component.code,
          product_name: component.name,
          warehouse_id: warehouse?.id || null,
          warehouse_name: warehouse?.name || null,
          quantity: Number(item.quantity),
          unit: component.unit || "Ədəd",
          unit_cost: Number(component.buy_price) || 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    setSaving(true);
    const result = await saveProductionBomAction({
      finished_product_id: finishedProductId,
      name: name.trim() || `${product.name} BOM`,
      notes,
      items: mapped,
    });
    setSaving(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("common.success"));
    await load();
  };

  const handleDelete = async (bomId: string) => {
    if (!confirm(t("common.confirmDelete", { name: t("production.bomTitle") }))) return;
    const result = await deleteProductionBomAction(bomId);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    await load();
  };

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<Layers className="h-6 w-6 text-app-accent" />}
        title={t("production.bomTitle")}
        description={t("production.bomDescription")}
        backLink={{ href: "/production", label: t("common.back") }}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {loading ? (
          <p className="text-sm text-app-muted">{t("common.loading")}</p>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <section className="rounded-xl border border-app bg-app-surface p-4">
              <h3 className="mb-3 font-semibold">{t("production.existingBoms")}</h3>
              <div className="space-y-2">
                {(lookups?.boms || []).length === 0 && (
                  <p className="text-sm text-app-muted">{t("common.noData")}</p>
                )}
                {(lookups?.boms || []).map((bom) => {
                  const product = lookups?.products.find((p) => p.id === bom.finished_product_id);
                  return (
                    <div key={bom.id} className="flex items-start justify-between gap-3 rounded-lg border border-app p-3">
                      <button type="button" className="text-left" onClick={() => editBom(bom)}>
                        <p className="font-semibold">{bom.name}</p>
                        <p className="text-xs text-app-muted">
                          {product?.name || bom.finished_product_id} · {bom.items.length} {t("production.components")}
                        </p>
                      </button>
                      {canManage && (
                        <button type="button" className="text-red-500" onClick={() => handleDelete(bom.id)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-app bg-app-surface p-4">
              <h3 className="mb-3 font-semibold">{t("production.editBom")}</h3>
              <div className="grid gap-3">
                <label className="text-xs">
                  {t("production.finishedProduct")}
                  <select
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={finishedProductId}
                    onChange={(e) => setFinishedProductId(e.target.value)}
                    disabled={!canManage}
                  >
                    <option value="">{t("common.select")}</option>
                    {(lookups?.products || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  {t("production.bomName")}
                  <input
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={!canManage}
                  />
                </label>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="grid gap-2 rounded-lg border border-app p-2 md:grid-cols-[1.4fr_0.6fr_1fr_auto]">
                      <select
                        className="rounded-lg border border-app bg-app px-2 py-2 text-sm"
                        value={item.product_id}
                        disabled={!canManage}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, product_id: e.target.value } : row))
                          )
                        }
                      >
                        <option value="">{t("forms.selectProduct")}</option>
                        {(lookups?.products || []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0.001}
                        step="0.001"
                        className="rounded-lg border border-app bg-app px-2 py-2 text-sm"
                        value={item.quantity}
                        disabled={!canManage}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, quantity: e.target.value } : row))
                          )
                        }
                      />
                      <select
                        className="rounded-lg border border-app bg-app px-2 py-2 text-sm"
                        value={item.warehouse_id}
                        disabled={!canManage}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, warehouse_id: e.target.value } : row))
                          )
                        }
                      >
                        <option value="">{t("common.warehouse")}</option>
                        {(lookups?.warehouses || []).map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      {canManage && (
                        <button
                          type="button"
                          className="text-xs text-red-500"
                          onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          {t("forms.remove")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="btn-secondary self-start text-xs"
                    onClick={() => setItems((prev) => [...prev, { product_id: "", quantity: "1", warehouse_id: "" }])}
                  >
                    {t("forms.addRow")}
                  </button>
                )}
                <label className="text-xs">
                  {t("common.notes")}
                  <textarea
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    rows={2}
                    value={notes}
                    disabled={!canManage}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
                {canManage && (
                  <button type="button" className="btn-primary self-start" disabled={saving} onClick={handleSave}>
                    {saving ? t("common.saving") : t("common.save")}
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
