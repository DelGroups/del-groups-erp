"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Barcode, Plus, Trash2 } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { ERPPage } from "@/components/layout/ERPLayout";
import Panel from "@/components/ui/panel";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import Select from "@/components/ui/select";
import ToastMessage from "@/components/ui/ToastMessage";
import StockTransferPrintTemplate from "./StockTransferPrintTemplate";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import {
  loadWarehousesForTransfer,
  resolveTransferBarcode,
  type StockTransferLineInput,
  type StockTransferPrintData,
} from "../lib/stockTransfer";
import { fetchTransferSourceStock } from "../actions/stockTransfer";
import type { Warehouse } from "@/types/database.types";
import { generateStockTransferDocumentNumber } from "@/types/database.types";
import { EntityLookup, mergeRecord } from "@/components/lookups";
import { useUiStandard } from "@/design-system/components";
import { LineGrid, LineNumberCell, LineText, type LineCellContext } from "@/components/line-grid";
import { LotAutoText, LotPicker } from "./LotPicker";
import { useLotTracking } from "./LotTrackingFlag";
import { followQuantity, lotsPayload } from "../lib/lotPicker";
import { lineGridLabels } from "@/i18n/uiStandardLabels";
import { codeName } from "@/components/lists/standardGridLogic";
import { formatQuantity } from "@/lib/dates/localeDate";

function createLineId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyLine(): StockTransferLineInput {
  return {
    id: createLineId(),
    product_id: "",
    product_code: "",
    product_name: "",
    unit: "Ədəd",
    barcode: "",
    offcut_id: null,
    quantity: 1,
    available_stock: 0,
  };
}

export default function StockTransferNewPage() {
  const { t, locale } = useI18n();
  // UI_STANDARD (UI-2 lookups): both warehouses through EntityLookup.
  const uiStandard = useUiStandard();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const { printData, setPrintData } = useDocumentPrint<StockTransferPrintData>();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  // LOT-3: lots per line (LOT_TRACKING); off = no column and no "lots" key.
  const lotsOn = useLotTracking();
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [referenceNumber] = useState(() => generateStockTransferDocumentNumber());
  const [lines, setLines] = useState<StockTransferLineInput[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadWarehousesForTransfer().then((rows) => {
      setWarehouses(rows);
      const defaultWh = rows.find((w) => w.is_default) ?? rows[0];
      if (defaultWh) {
        setFromWarehouseId(defaultWh.id);
        setToWarehouseId(rows.find((w) => w.id !== defaultWh.id)?.id ?? defaultWh.id);
      }
    });
  }, []);

  const warehouseOptions = useMemo(
    () => warehouses.map((w) => ({ value: w.id, label: w.name })),
    [warehouses]
  );

  // A new source warehouse: chosen lots belong to the old one (LOT-3).
  const changeFromWarehouse = (id: string) => {
    setFromWarehouseId(id);
    setLines((prev) => (prev.some((l) => l.lots) ? prev.map((l) => (l.lots ? { ...l, lots: undefined } : l)) : prev));
  };

  const updateLine = (id: string, patch: Partial<StockTransferLineInput>) => {
    setLines((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((row) => row.id !== id));
  };

  const addResolvedLine = useCallback(
    (resolved: Omit<StockTransferLineInput, "id">) => {
      const duplicate = lines.find(
        (row) =>
          row.product_id === resolved.product_id &&
          (row.offcut_id || null) === (resolved.offcut_id || null)
      );
      if (duplicate) {
        const nextQty = Math.min(
          duplicate.available_stock,
          duplicate.quantity + (resolved.quantity || 1)
        );
        updateLine(duplicate.id, { quantity: nextQty });
        return;
      }
      setLines((prev) => [...prev, { ...resolved, id: createLineId() }]);
    },
    [lines]
  );

  const handleBarcodeSubmit = async () => {
    if (!fromWarehouseId) {
      showError(t("stockTransfer.selectSourceWarehouse"));
      return;
    }
    const result = await resolveTransferBarcode(barcodeInput, fromWarehouseId);
    if (!result.ok || !result.line) {
      showError(result.error || t("common.error"));
      return;
    }
    addResolvedLine({
      product_id: result.line.product_id,
      product_code: result.line.product_code,
      product_name: result.line.product_name,
      unit: result.line.unit,
      barcode: result.line.barcode,
      offcut_id: result.line.offcut_id,
      quantity: result.line.quantity ?? 1,
      available_stock: result.line.available_stock,
    });
    setBarcodeInput("");
    barcodeRef.current?.focus();
  };

  const refreshLineStock = async (line: StockTransferLineInput) => {
    if (!line.product_id || !fromWarehouseId || line.offcut_id) return;
    const stock = await fetchTransferSourceStock(line.product_id, fromWarehouseId);
    updateLine(line.id, { available_stock: stock });
  };

  useEffect(() => {
    if (!fromWarehouseId) return;
    void Promise.all(lines.map((line) => refreshLineStock(line)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromWarehouseId]);

  const handleConfirm = async () => {
    if (!fromWarehouseId || !toWarehouseId) {
      showError(t("stockTransfer.selectWarehouses"));
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      showError(t("stockTransfer.sameWarehouseError"));
      return;
    }

    const validLines = lines.filter((row) => row.product_id && row.quantity > 0);
    if (validLines.length === 0) {
      showError(t("stockTransfer.noLines"));
      return;
    }

    for (const line of validLines) {
      if (line.quantity > line.available_stock) {
        showError(t("stockTransfer.qtyExceedsStock", { name: line.product_name }));
        return;
      }
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inventory/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_number: referenceNumber,
          from_warehouse_id: fromWarehouseId,
          to_warehouse_id: toWarehouseId,
          transfer_date: transferDate,
          notes,
          items: validLines.map((line) => {
            // A single chosen lot takes the whole line; automatic lines send no "lots" key.
            if (!line.lots) return line;
            const { lots: chosen, ...rest } = line;
            const lots = line.offcut_id ? undefined : lotsPayload(followQuantity(chosen.map((l) => ({ lotId: l.lot_id, qty: l.qty })), line.quantity));
            return lots ? { ...rest, lots } : rest;
          }),
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        print?: StockTransferPrintData;
      };

      if (!response.ok || !payload.success) {
        showError(payload.error || t("common.error"));
        return;
      }

      showSuccess(t("stockTransfer.success"));
      setLines([]);
      setNotes("");
      if (payload.print) setPrintData(payload.print);
    } catch {
      showError(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageLayout>
      <ERPPage
        title={t("stockTransfer.pageTitle")}
        subtitle={t("stockTransfer.pageDescription")}
      >
        <div className="space-y-4">
          <Panel title={t("stockTransfer.headerPanel")}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <label className="erp-label">{t("stockTransfer.sourceWarehouse")}</label>
                {uiStandard ? (
                  <EntityLookup
                    entity="warehouse"
                    value={fromWarehouseId}
                    selectedLabel={warehouses.find((w) => w.id === fromWarehouseId)?.name}
                    allowedIds={warehouses.map((w) => w.id)}
                    clearable={false}
                    aria-label={t("stockTransfer.sourceWarehouse")}
                    onCreated={(row) => setWarehouses((prev) => mergeRecord(prev, row as unknown as Warehouse))}
                    onChange={(id) => changeFromWarehouse(id ?? "")}
                  />
                ) : (
                <Select
                  value={fromWarehouseId}
                  onChange={(event) => changeFromWarehouse(event.target.value)}
                >
                  {warehouseOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                )}
              </div>
              <div className="space-y-3">
                <label className="erp-label">{t("stockTransfer.destinationWarehouse")}</label>
                {uiStandard ? (
                  <EntityLookup
                    entity="warehouse"
                    value={toWarehouseId}
                    selectedLabel={warehouses.find((w) => w.id === toWarehouseId)?.name}
                    allowedIds={warehouses.map((w) => w.id)}
                    clearable={false}
                    aria-label={t("stockTransfer.destinationWarehouse")}
                    onCreated={(row) => setWarehouses((prev) => mergeRecord(prev, row as unknown as Warehouse))}
                    onChange={(id) => setToWarehouseId(id ?? "")}
                  />
                ) : (
                <Select
                  value={toWarehouseId}
                  onChange={(event) => setToWarehouseId(event.target.value)}
                >
                  {warehouseOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                )}
              </div>
              <div className="space-y-3">
                <label className="erp-label">{t("stockTransfer.date")}</label>
                <Input
                  type="date"
                  value={transferDate}
                  onChange={(event) => setTransferDate(event.target.value)}
                />
              </div>
              <div className="space-y-3 lg:col-span-2">
                <label className="erp-label">{t("stockTransfer.notes")}</label>
                <textarea
                  className="min-h-[72px] w-full rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-input)] px-3 py-2 text-sm"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={t("stockTransfer.notesPlaceholder")}
                />
              </div>
            </div>
          </Panel>

          <Panel title={t("stockTransfer.linesPanel")}>
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <div className="min-w-[240px] flex-1">
                <label className="erp-label">{t("stockTransfer.scanBarcode")}</label>
                <Input
                  ref={barcodeRef}
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleBarcodeSubmit();
                    }
                  }}
                  placeholder={t("stockTransfer.scanPlaceholder")}
                />
              </div>
              <Button type="button" variant="outline" onClick={() => void handleBarcodeSubmit()}>
                <Barcode className="h-4 w-4" />
                {t("stockTransfer.addByBarcode")}
              </Button>
              {uiStandard ? null : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLines((prev) => [...prev, createEmptyLine()])}
              >
                <Plus className="h-4 w-4" />
                {t("stockTransfer.addRow")}
              </Button>
              )}
            </div>

            {uiStandard ? (
              <LineGrid<StockTransferLineInput>
                id="stock-transfer-lines"
                label={t("stockTransfer.colProduct")}
                lines={lines}
                lineKey={(line) => line.id}
                lineLabel={(line, index) => line.product_name || `#${index + 1}`}
                labels={{ ...lineGridLabels(t), empty: t("stockTransfer.emptyLines") }}
                onAddLine={() => setLines((prev) => [...prev, createEmptyLine()])}
                onRemove={(index) => removeLine(lines[index].id)}
                columns={[
                  { key: "product", header: t("stockTransfer.colProduct"), width: 260, cell: (line) => <LineText>{codeName(line.product_code, line.product_name)}</LineText> },
                  { key: "barcode", header: t("stockTransfer.colBarcode"), type: "code", cell: (line) => <LineText muted>{line.barcode || "—"}</LineText> },
                  { key: "unit", header: t("stockTransfer.colUnit"), type: "code", width: 88, cell: (line) => <LineText muted>{line.unit}</LineText> },
                  { key: "available", header: t("stockTransfer.colAvailable"), type: "number", cell: (line) => <LineText>{formatQuantity(line.available_stock, locale)}</LineText> },
                  {
                    key: "quantity",
                    header: t("stockTransfer.colTransferQty"),
                    type: "number",
                    width: 128,
                    error: (line) => (line.quantity > line.available_stock ? t("stockTransfer.qtyExceedsStock", { name: line.product_name }) : null),
                    cell: (line, ctx) => <LineNumberCell ctx={ctx} value={line.quantity} max={line.available_stock} onChange={(value) => updateLine(line.id, { quantity: value ?? 0 })} />,
                  },
                  ...(lotsOn
                    ? [
                        {
                          key: "lots",
                          header: t("lots.picker.column"),
                          width: 220,
                          cell: (line: StockTransferLineInput, ctx: LineCellContext) =>
                            line.product_id && fromWarehouseId && !line.offcut_id ? (
                              <LotPicker
                                productId={line.product_id}
                                warehouseId={fromWarehouseId}
                                quantity={Number(line.quantity) || 0}
                                unit={line.unit}
                                value={(line.lots ?? []).map((l) => ({ lotId: l.lot_id, qty: Number(l.qty) || 0 }))}
                                onChange={(next) => updateLine(line.id, { lots: next ? next.map((c) => ({ lot_id: c.lotId, qty: c.qty })) : undefined })}
                                label={ctx.label}
                                invalid={ctx.invalid}
                              />
                            ) : (
                              <LotAutoText />
                            ),
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
            <div className="overflow-x-auto rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[color:var(--erp-bg-table-header)]">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">{t("stockTransfer.colProduct")}</th>
                    <th className="px-3 py-2">{t("stockTransfer.colBarcode")}</th>
                    <th className="px-3 py-2">{t("stockTransfer.colUnit")}</th>
                    <th className="px-3 py-2 text-right">{t("stockTransfer.colAvailable")}</th>
                    <th className="px-3 py-2 text-right">{t("stockTransfer.colTransferQty")}</th>
                    <th className="px-3 py-2 text-right">{t("inventory.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-app-muted">
                        {t("stockTransfer.emptyLines")}
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, index) => (
                      <tr key={line.id} className="border-t border-[color:var(--erp-border-default)]">
                        <td className="px-3 py-2">{index + 1}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{line.product_name || "—"}</div>
                          <div className="text-xs text-app-muted font-mono">{line.product_code}</div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{line.barcode || "—"}</td>
                        <td className="px-3 py-2">{line.unit}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {line.available_stock}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            max={line.available_stock}
                            step={line.unit === "Metr" ? 0.001 : 1}
                            className="ml-auto w-28 text-right font-mono tabular-nums"
                            value={line.quantity}
                            onChange={(event) => {
                              const qty = Number(event.target.value) || 0;
                              updateLine(line.id, { quantity: qty });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            appearance="text"
                            color="danger"
                            size="sm"
                            onClick={() => removeLine(line.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            )}
          </Panel>

          <div className="flex justify-end">
            <Button type="button" onClick={() => void handleConfirm()} loading={submitting}>
              {t("stockTransfer.confirm")}
            </Button>
          </div>
        </div>

        {printData ? (
          <div className="fixed inset-0 z-[var(--erp-z-modal)] overflow-auto bg-[color:var(--erp-bg-overlay)] p-4 print:static print:bg-white print:p-0">
            <div className="mx-auto mb-4 flex max-w-4xl justify-end gap-2 print:hidden">
              <Button type="button" variant="secondary" onClick={() => setPrintData(null)}>
                {t("common.close")}
              </Button>
              <Button type="button" onClick={() => window.print()}>
                {t("common.print")}
              </Button>
            </div>
            <StockTransferPrintTemplate transfer={printData} />
          </div>
        ) : null}

        <ToastMessage message={toastMessage} variant={toastVariant} />
      </ERPPage>
    </PageLayout>
  );
}
