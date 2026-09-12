"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, Plus, Save, Trash2 } from "lucide-react";
import ProductCombobox from "@/components/products/ProductCombobox";
import {
  applyProductToInitialBalanceLine,
  calcInitialBalanceLineTotal,
  createEmptyInitialBalanceLine,
  parsePieceLengthsInput,
  syncMetricLineFromPieces,
} from "@/lib/initialBalance/helpers";
import {
  peekInitialBalanceDocNoAction,
  postInitialBalanceDocumentAction,
  saveInitialBalanceDraftAction,
} from "@/lib/initialBalance/actions";
import type { InitialBalanceDocument, InitialBalanceLineItem } from "@/lib/initialBalance/types";
import type { Product, Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import { formatRpcError } from "@/lib/forms/rpcErrors";

interface InitialBalanceFormProps {
  products: Product[];
  warehouses: Warehouse[];
  initialDocument?: InitialBalanceDocument | null;
  onSuccess?: (documentId: string) => void;
}

export default function InitialBalanceForm({
  products,
  warehouses,
  initialDocument = null,
  onSuccess,
}: InitialBalanceFormProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const isPosted = initialDocument?.status === "posted";
  const isLocked = isPosted || initialDocument?.status === "cancelled";

  const [docNo, setDocNo] = useState(initialDocument?.document_number || "");
  const [docDate, setDocDate] = useState(
    initialDocument?.doc_date || new Date().toISOString().slice(0, 10)
  );
  const [warehouseId, setWarehouseId] = useState(initialDocument?.warehouse_id || warehouses[0]?.id || "");
  const [notes, setNotes] = useState(initialDocument?.notes || "");
  const [items, setItems] = useState<InitialBalanceLineItem[]>(
    initialDocument?.items?.length
      ? initialDocument.items
      : [createEmptyInitialBalanceLine()]
  );
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [documentId, setDocumentId] = useState(initialDocument?.id || "");

  useEffect(() => {
    if (initialDocument?.document_number) return;
    void peekInitialBalanceDocNoAction().then((result) => {
      if (result.success && result.data) setDocNo(result.data);
    });
  }, [initialDocument?.document_number]);

  const warehouseName =
    warehouses.find((warehouse) => warehouse.id === warehouseId)?.name || "";

  const totalAmount = useMemo(
    () => items.reduce((sum, row) => sum + (Number(row.line_total) || 0), 0),
    [items]
  );

  const updateItem = (id: string, patch: Partial<InitialBalanceLineItem>) => {
    setItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        next.line_total = calcInitialBalanceLineTotal(next);
        return next;
      })
    );
  };

  const handleProductSelect = (rowId: string, product: Product | null) => {
    if (!product) {
      updateItem(rowId, {
        product_id: "",
        product_code: "",
        product_name: "",
        unit: "Ədəd",
        is_metric: false,
        quantity: 0,
        metric_total_meters: 0,
        piece_lengths_input: "",
        unit_cost: 0,
        line_total: 0,
      });
      return;
    }
    const row = items.find((item) => item.id === rowId);
    if (!row) return;
    updateItem(rowId, applyProductToInitialBalanceLine(row, product));
  };

  const buildPayload = () => ({
    id: documentId || null,
    doc_date: docDate,
    warehouse_id: warehouseId,
    warehouse_name: warehouseName,
    notes,
    items: items
      .filter((row) => row.product_id)
      .map((row) => ({
        product_id: row.product_id,
        product_code: row.product_code,
        product_name: row.product_name,
        unit: row.unit,
        quantity: row.quantity,
        unit_cost: row.unit_cost,
        line_total: row.line_total,
        is_metric: row.is_metric,
        metric_total_meters: row.is_metric ? row.metric_total_meters : null,
        piece_lengths: row.is_metric ? parsePieceLengthsInput(row.piece_lengths_input) : null,
      })),
  });

  const handleSaveDraft = async () => {
    const payload = buildPayload();
    if (!payload.items.length) {
      showError(t("initialBalance.noLines"));
      return;
    }
    setSaving(true);
    const result = await saveInitialBalanceDraftAction(payload);
    setSaving(false);
    if (!result.success || !result.data) {
      showError(formatRpcError(result.error, t) || t("common.error"));
      return;
    }
    setDocumentId(result.data.id);
    setDocNo(result.data.document_number);
    showSuccess(t("initialBalance.draftSaved"));
    onSuccess?.(result.data.id);
  };

  const handlePost = async () => {
    setPosting(true);
    const saveResult = await saveInitialBalanceDraftAction(buildPayload());
    if (!saveResult.success || !saveResult.data) {
      setPosting(false);
      showError(formatRpcError(saveResult.error, t) || t("common.error"));
      return;
    }
    setDocumentId(saveResult.data.id);
    setDocNo(saveResult.data.document_number);

    const postResult = await postInitialBalanceDocumentAction(saveResult.data.id);
    setPosting(false);
    if (!postResult.success) {
      showError(formatRpcError(postResult.error, t) || t("common.error"));
      return;
    }
    showSuccess(t("initialBalance.posted", { docNo: saveResult.data.document_number }));
    onSuccess?.(saveResult.data.id);
  };

  return (
    <>
      <div className="app-card space-y-6 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app pb-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-app-accent" />
            <h2 className="text-sm font-bold text-app">{t("initialBalance.formTitle")}</h2>
          </div>
          {isPosted ? (
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700">
              {t("initialBalance.statusPosted")}
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700">
              {t("initialBalance.statusDraft")}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="block text-xs font-semibold text-app">
            {t("initialBalance.docNo")}
            <input value={docNo} readOnly className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-semibold text-app">
            {t("common.date")}
            <input
              type="date"
              value={docDate}
              disabled={isLocked}
              onChange={(event) => setDocDate(event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-app">
            {t("common.warehouse")}
            <select
              value={warehouseId}
              disabled={isLocked}
              onChange={(event) => setWarehouseId(event.target.value)}
              className="app-input mt-1 text-sm"
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-app md:col-span-1">
            {t("initialBalance.totalValue")}
            <input
              value={`${totalAmount.toFixed(2)} AZN`}
              readOnly
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="block text-xs font-semibold text-app md:col-span-4">
            {t("common.notes")}
            <textarea
              rows={2}
              value={notes}
              disabled={isLocked}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="overflow-x-auto rounded-xl border border-app">
          <table className="min-w-full text-xs">
            <thead className="bg-app-card-hover text-app-muted">
              <tr>
                <th className="px-3 py-2 text-left">{t("forms.productName")}</th>
                <th className="px-3 py-2 text-left">{t("forms.unitMeasure")}</th>
                <th className="px-3 py-2 text-left">{t("initialBalance.qtyOrBreakdown")}</th>
                <th className="px-3 py-2 text-left">{t("initialBalance.unitCost")}</th>
                <th className="px-3 py-2 text-right">{t("initialBalance.lineTotal")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-app align-top">
                  <td className="px-3 py-2 min-w-[220px]">
                    <ProductCombobox
                      products={products}
                      selectedId={row.product_id}
                      selectedName={row.product_name}
                      disabled={isLocked}
                      onSelect={(product) => handleProductSelect(row.id, product)}
                    />
                  </td>
                  <td className="px-3 py-2">{row.unit || "—"}</td>
                  <td className="px-3 py-2 min-w-[220px]">
                    {row.is_metric ? (
                      <div className="space-y-2">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          disabled={isLocked}
                          value={row.metric_total_meters || ""}
                          onChange={(event) =>
                            updateItem(row.id, {
                              metric_total_meters: Number(event.target.value) || 0,
                              quantity: Number(event.target.value) || 0,
                            })
                          }
                          placeholder={t("initialBalance.totalMeters")}
                          className="w-full rounded border px-2 py-1"
                        />
                        <input
                          type="text"
                          disabled={isLocked}
                          value={row.piece_lengths_input}
                          onChange={(event) => {
                            const synced = syncMetricLineFromPieces({
                              ...row,
                              piece_lengths_input: event.target.value,
                            });
                            updateItem(row.id, {
                              piece_lengths_input: synced.piece_lengths_input,
                              metric_total_meters: synced.metric_total_meters,
                              quantity: synced.quantity,
                              line_total: synced.line_total,
                            });
                          }}
                          placeholder={t("initialBalance.pieceBreakdownPlaceholder")}
                          className="w-full rounded border px-2 py-1 font-mono"
                        />
                      </div>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={isLocked}
                        value={row.quantity || ""}
                        onChange={(event) =>
                          updateItem(row.id, { quantity: Number(event.target.value) || 0 })
                        }
                        className="w-full rounded border px-2 py-1"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={isLocked}
                      value={row.unit_cost}
                      onChange={(event) =>
                        updateItem(row.id, { unit_cost: Number(event.target.value) || 0 })
                      }
                      className="w-full rounded border px-2 py-1 font-mono"
                    />
                    {row.is_metric ? (
                      <p className="mt-0.5 text-[10px] text-app-muted">{t("forms.pricePerMeterShort")}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {row.line_total.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {!isLocked ? (
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) =>
                            prev.length === 1 ? prev : prev.filter((item) => item.id !== row.id)
                          )
                        }
                        className="text-app-muted hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLocked ? (
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, createEmptyInitialBalanceLine()])}
            className="btn-secondary inline-flex items-center gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("initialBalance.addLine")}
          </button>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-app pt-4">
          {!isLocked ? (
            <>
              <button
                type="button"
                disabled={saving || posting}
                onClick={() => void handleSaveDraft()}
                className="btn-secondary inline-flex items-center gap-1 text-xs"
              >
                <Save className="h-3.5 w-3.5" />
                {t("initialBalance.saveDraft")}
              </button>
              <button
                type="button"
                disabled={saving || posting}
                onClick={() => void handlePost()}
                className="btn-primary inline-flex items-center gap-1 text-xs"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {posting ? t("common.saving") : t("initialBalance.postDocument")}
              </button>
            </>
          ) : null}
        </div>
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
