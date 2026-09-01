"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import type { DamagedGoodsItem, Product, Warehouse } from "@/types/database.types";
import {
  createEmptyDamagedGoodsItem,
  generateWriteoffDocumentNumber,
} from "@/types/database.types";
import type { WriteoffRecord } from "@/lib/inventory/writeoff";
import {
  fetchProductsByWarehouse,
  submitDamagedGoodsWriteoff,
  updateInventoryWriteoff,
} from "@/lib/inventory/writeoff";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { formatRpcError } from "@/lib/forms/rpcErrors";

interface DamagedGoodsFormProps {
  warehouses: Warehouse[];
  mode?: "create" | "edit";
  initialWriteoff?: WriteoffRecord | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function DamagedGoodsForm({
  warehouses,
  mode = "create",
  initialWriteoff = null,
  onSuccess,
  onCancel,
}: DamagedGoodsFormProps) {
  const isEdit = mode === "edit" && !!initialWriteoff;
  const { displayName, isAdmin, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError: showToastError } = useToast();
  const lockChecker = !authLoading && !isAdmin;

  const [documentNumber] = useState(
    () => initialWriteoff?.document_number || generateWriteoffDocumentNumber()
  );
  const [writeoffDate, setWriteoffDate] = useState(
    initialWriteoff?.writeoff_date || new Date().toISOString().slice(0, 10)
  );
  const [warehouseId, setWarehouseId] = useState(
    initialWriteoff?.warehouse_id || warehouses[0]?.id || ""
  );
  const [checkerName, setCheckerName] = useState(initialWriteoff?.checker_name || "");
  const [notes, setNotes] = useState(initialWriteoff?.notes || "");
  const [items, setItems] = useState<DamagedGoodsItem[]>(
    initialWriteoff?.items?.length
      ? initialWriteoff.items
      : [createEmptyDamagedGoodsItem()]
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);

  const effectiveCheckerName = lockChecker ? displayName : checkerName;

  useEffect(() => {
    if (warehouses[0] && !warehouseId) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  useEffect(() => {
    if (!warehouseId) return;
    void fetchProductsByWarehouse(warehouseId).then(setProducts);
  }, [warehouseId]);

  const updateItem = (id: string, patch: Partial<DamagedGoodsItem>) => {
    setItems((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const handleProductSelect = (rowId: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateItem(rowId, {
        product_id: "",
        product_code: "",
        product_name: "",
        unit: "Ədəd",
        available_stock: 0,
      });
      return;
    }

    updateItem(rowId, {
      product_id: product.id,
      product_code: product.code,
      product_name: product.name,
      unit: product.unit || "Ədəd",
      available_stock: Number(product.stock) || 0,
    });
  };

  const addRow = () => setItems((prev) => [...prev, createEmptyDamagedGoodsItem()]);
  const removeRow = (id: string) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((row) => row.id !== id));
  };

  const submitPreflightIssue = useMemo(() => {
    if (!warehouseId) return "forms.selectWarehouse";
    if (!effectiveCheckerName.trim()) return "forms.enterCheckerName";
    const validLines = items.filter((row) => row.product_id && row.quantity > 0);
    if (validLines.length === 0) return "forms.selectProduct";
    return null;
  }, [effectiveCheckerName, items, warehouseId]);
  const submitPreflightHint = submitPreflightIssue ? t(submitPreflightIssue) : undefined;

  const handleSubmit = async () => {
    if (submitPreflightIssue) {
      showToastError(submitPreflightHint || t("common.error"));
      return;
    }

    setSaving(true);

    const payload = {
      document_number: documentNumber,
      writeoff_date: writeoffDate,
      warehouse_id: warehouseId,
      checker_name: effectiveCheckerName,
      items,
      notes,
    };

    const result = isEdit
      ? await updateInventoryWriteoff(
          initialWriteoff!.id,
          payload,
          initialWriteoff!.items
        )
      : await submitDamagedGoodsWriteoff(payload);

    setSaving(false);

    if (!result.success) {
      showToastError(formatRpcError(result.error ?? t("common.error"), t));
      return;
    }

    onSuccess?.();
  };

  return (
    <div className="space-y-4">
      <div className="app-card app-card-elevated p-5">
        <div className="mb-4 flex items-center justify-between border-b border-app pb-3">
          <div>
            <h2 className="text-sm font-bold text-app">
              {isEdit ? t("forms.editDoc") : t("forms.newDamagedDoc")}
            </h2>
            <p className="text-[11px] text-app-muted">
              {t("forms.docNoLabel")}:{" "}
              <span className="font-mono font-semibold text-app-accent">{documentNumber}</span>
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover hover:text-app"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block text-xs font-semibold text-app">
            {t("common.date")}
            <input
              type="date"
              value={writeoffDate}
              onChange={(e) => setWriteoffDate(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs font-semibold text-app">
            {t("common.warehouse")} *
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="app-input mt-1 text-sm"
            >
              <option value="">{t("common.select")}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold text-app">
            {t("common.checker")} *
            <input
              type="text"
              value={effectiveCheckerName}
              onChange={(e) => setCheckerName(e.target.value)}
              readOnly={lockChecker}
              placeholder={t("forms.nameSurnamePlaceholder")}
              className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                lockChecker ? "bg-app-card-hover text-app-muted" : ""
              }`}
            />
            {lockChecker && (
              <span className="mt-1 block text-[10px] font-semibold text-app-muted">
                {t("forms.ownNameOnly")}
              </span>
            )}
          </label>
        </div>
      </div>

      <div className="app-table-wrap">
        <div className="flex items-center justify-between app-toolbar px-4 py-2.5 text-xs font-bold">
          <span>{t("forms.damagedProducts")}</span>
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1 rounded bg-[image:var(--app-gradient)] px-2.5 py-1 text-[11px] hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("forms.addRow")}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-app-card-hover font-bold uppercase text-app">
              <tr>
                <th className="w-8 p-2.5">{t("print.rowNo")}</th>
                <th className="p-2.5">{t("dashboard.product")}</th>
                <th className="w-24 p-2.5">{t("forms.quantity")}</th>
                <th className="w-24 p-2.5">{t("forms.stockCol")}</th>
                <th className="p-2.5">{t("forms.issueReason")}</th>
                <th className="w-10 p-2.5">{t("forms.remove")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((row, idx) => (
                <tr key={row.id}>
                  <td className="p-2.5 font-mono text-app-muted">{idx + 1}</td>
                  <td className="p-2.5">
                    <select
                      value={row.product_id}
                      onChange={(e) => handleProductSelect(row.id, e.target.value)}
                      className="w-full min-w-[220px] rounded border px-2 py-1.5"
                    >
                      <option value="">{t("forms.selectProduct")}</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {t("forms.stockOption", {
                            name: p.name,
                            code: p.code,
                            stock: String(p.stock),
                          })}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.quantity}
                      onChange={(e) =>
                        updateItem(row.id, { quantity: Number(e.target.value) || 0 })
                      }
                      className="w-full rounded border px-2 py-1 text-center"
                    />
                  </td>
                  <td className="p-2.5 text-app-muted">
                    {row.available_stock} {row.unit}
                  </td>
                  <td className="p-2.5">
                    <input
                      type="text"
                      value={row.issue_description}
                      onChange={(e) =>
                        updateItem(row.id, { issue_description: e.target.value })
                      }
                      placeholder={t("forms.issueReasonPlaceholder")}
                      className="w-full min-w-[180px] rounded border px-2 py-1"
                    />
                  </td>
                  <td className="p-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="text-app-muted hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <label className="app-card block p-4 text-xs font-semibold text-app shadow-sm">
        {t("common.notes")}
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal"
        />
      </label>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-app px-4 py-2.5 text-xs font-semibold text-app hover:bg-app-card-hover"
          >
            {t("common.cancel")}
          </button>
        )}
        <button
          type="button"
          disabled={saving || Boolean(submitPreflightIssue)}
          title={submitPreflightHint}
          onClick={handleSubmit}
          className="flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-5 py-2.5 text-xs font-bold text-white hover:brightness-110 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? t("common.saving") : isEdit ? t("forms.saveChanges") : t("forms.confirmAndSave")}
        </button>
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </div>
  );
}
