"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import {
  applyInventoryAuditAdjustmentsAction,
  fetchInventoryAuditVouchersAction,
  fetchWarehousesForAuditAction,
  saveInventoryAuditDraftAction,
  type InventoryAuditDraftItemInput,
} from "@/lib/actions/inventoryAudit";
import { fetchAllPolywoodInventory } from "@/lib/polywood/inventory";
import InventoryAuditPrecheckPrintTemplate, {
  type InventoryAuditPrecheckPrintData,
} from "@/components/inventory/InventoryAuditPrecheckPrintTemplate";
import InventoryAuditVoucherPrintTemplate, {
  type InventoryAuditVoucherPrintData,
} from "@/components/inventory/InventoryAuditVoucherPrintTemplate";
import { ClipboardCheck, Printer, Save, Send } from "lucide-react";

type AuditMode = "standard" | "polywood";

interface WarehouseOpt {
  id: string;
  name: string;
  warehouse_type: string | null;
}

interface StandardAuditRow {
  product_id: string;
  product_code: string;
  product_name: string;
  unit: string;
  system_qty: number;
  actual_qty_input: string;
}

interface PolywoodAuditRow {
  product_id: string;
  product_code: string;
  product_name: string;
  full_sheet_length_m: number;
  system_total_m: number;
  system_full_sheet_count: number;
  system_cut_pieces: number[];
  actual_full_sheet_count_input: string;
  actual_cut_pieces_input: string;
}

function parseLengths(raw: string): number[] {
  return raw
    .split(/[;,| ]+/)
    .map((x) => Number(x.replace(",", ".")))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v * 1000) / 1000);
}

function fmtCutPieces(lengths: number[]): string {
  if (!lengths.length) return "-";
  const map = new Map<number, number>();
  for (const len of lengths) map.set(len, (map.get(len) || 0) + 1);
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([len, count]) => `${count}×${len}m`)
    .join(", ");
}

export default function InventoryAuditPageClient() {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuditMode>("standard");
  const [warehouses, setWarehouses] = useState<WarehouseOpt[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [auditDate, setAuditDate] = useState(new Date().toISOString().slice(0, 10));
  const [auditorName, setAuditorName] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [standardRows, setStandardRows] = useState<StandardAuditRow[]>([]);
  const [polywoodRows, setPolywoodRows] = useState<PolywoodAuditRow[]>([]);
  const [confirmApply, setConfirmApply] = useState<{ open: boolean; auditId: string }>({
    open: false,
    auditId: "",
  });
  const [vouchers, setVouchers] = useState<
    Array<{
      id: string;
      voucher_number: string;
      audit_type: AuditMode;
      warehouse_name: string;
      audit_date: string;
      auditor_name: string;
      applied_at: string;
      items: unknown[];
    }>
  >([]);

  const { printData: precheckPrint, setPrintData: setPrecheckPrint } =
    useDocumentPrint<InventoryAuditPrecheckPrintData>();
  const { printData: voucherPrint, setPrintData: setVoucherPrint } =
    useDocumentPrint<InventoryAuditVoucherPrintData>();

  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId) || null;
  const polywoodWarehouse = warehouses.find((w) => w.warehouse_type === "polywood") || null;

  const standardWarehouses = useMemo(
    () => warehouses.filter((w) => w.warehouse_type !== "polywood"),
    [warehouses]
  );

  const loadVouchers = useCallback(async () => {
    const result = await fetchInventoryAuditVouchersAction();
    if (result.success && result.data) setVouchers(result.data);
  }, []);

  const loadWarehouses = useCallback(async () => {
    const result = await fetchWarehousesForAuditAction();
    if (!result.success || !result.data) return;
    setWarehouses(result.data);
    const firstStandard = result.data.find((w) => w.warehouse_type !== "polywood");
    setWarehouseId((prev) => prev || firstStandard?.id || result.data[0]?.id || "");
  }, []);

  const loadStandardRows = useCallback(async () => {
    if (!warehouseId) return;
    setLoadingRows(true);
    const { data } = await supabase
      .from("products")
      .select("id, code, name, unit, stock, inventory_mode")
      .neq("inventory_mode", "polywood")
      .order("name", { ascending: true });
    const rows = (data || []).map((row) => ({
      product_id: row.id as string,
      product_code: (row.code as string) || "",
      product_name: (row.name as string) || "",
      unit: (row.unit as string) || "Ədəd",
      system_qty: Number(row.stock) || 0,
      actual_qty_input: "",
    }));
    setStandardRows(rows);
    setLoadingRows(false);
  }, [warehouseId]);

  const loadPolywoodRows = useCallback(async () => {
    if (!polywoodWarehouse) return;
    setLoadingRows(true);
    const data = await fetchAllPolywoodInventory(polywoodWarehouse.id);
    setPolywoodRows(
      data.map(({ product, summary }) => ({
        product_id: product.id,
        product_code: product.code || "",
        product_name: product.name,
        full_sheet_length_m: Number(summary.full_sheet_length_m) || 4,
        system_total_m: Number(summary.total_length_m) || 0,
        system_full_sheet_count: Number(summary.full_sheet_count) || 0,
        system_cut_pieces: summary.cut_pieces.flatMap((piece) =>
          Array.from({ length: piece.count }).map(() => piece.length_m)
        ),
        actual_full_sheet_count_input: "",
        actual_cut_pieces_input: "",
      }))
    );
    setLoadingRows(false);
  }, [polywoodWarehouse]);

  useEffect(() => {
    void loadWarehouses();
    void loadVouchers();
  }, [loadVouchers, loadWarehouses]);

  useEffect(() => {
    if (mode === "polywood") {
      if (polywoodWarehouse) setWarehouseId(polywoodWarehouse.id);
      void loadPolywoodRows();
    } else {
      if (selectedWarehouse?.warehouse_type === "polywood") {
        setWarehouseId(standardWarehouses[0]?.id || "");
      } else {
        void loadStandardRows();
      }
    }
  }, [mode, warehouseId, selectedWarehouse, standardWarehouses, polywoodWarehouse, loadStandardRows, loadPolywoodRows]);

  const standardPreview = useMemo(
    () =>
      standardRows.map((row) => ({
        ...row,
        actual_qty: Number(row.actual_qty_input || 0),
        variance: Number(row.actual_qty_input || 0) - row.system_qty,
      })),
    [standardRows]
  );

  const polywoodPreview = useMemo(
    () =>
      polywoodRows.map((row) => {
        const fullCount = Number(row.actual_full_sheet_count_input || 0);
        const cuts = parseLengths(row.actual_cut_pieces_input);
        const actualTotal = fullCount * row.full_sheet_length_m + cuts.reduce((s, n) => s + n, 0);
        const variance = actualTotal - row.system_total_m;
        return { ...row, actual_full_count: fullCount, actual_cuts: cuts, actual_total: actualTotal, variance };
      }),
    [polywoodRows]
  );

  const handlePrintPrecheck = () => {
    if (!selectedWarehouse) return;
    if (mode === "polywood") {
      setPrecheckPrint({
        audit_type: "polywood",
        warehouse_name: selectedWarehouse.name,
        audit_date: auditDate,
        auditor_name: auditorName,
        polywood_rows: polywoodRows.map((row) => ({
          product_code: row.product_code,
          product_name: row.product_name,
          total_meters: row.system_total_m,
          full_sheet_count: row.system_full_sheet_count,
          full_sheet_length_m: row.full_sheet_length_m,
          cut_breakdown: fmtCutPieces(row.system_cut_pieces),
        })),
      });
      return;
    }
    setPrecheckPrint({
      audit_type: "standard",
      warehouse_name: selectedWarehouse.name,
      audit_date: auditDate,
      auditor_name: auditorName,
      standard_rows: standardRows.map((row) => ({
        product_code: row.product_code,
        product_name: row.product_name,
        system_qty: row.system_qty,
        unit: row.unit,
      })),
    });
  };

  const handleSaveAudit = async () => {
    if (!selectedWarehouse) return;
    if (!auditorName.trim()) {
      alert(t("inventoryAudit.auditorRequired"));
      return;
    }

    const items: InventoryAuditDraftItemInput[] =
      mode === "polywood"
        ? polywoodPreview.map((row) => ({
            product_id: row.product_id,
            product_code: row.product_code,
            product_name: row.product_name,
            unit: "Metr",
            system_qty: row.system_total_m,
            actual_qty: row.actual_total,
            variance_qty: row.variance,
            full_sheet_length_m: row.full_sheet_length_m,
            system_full_sheet_count: row.system_full_sheet_count,
            system_cut_pieces: row.system_cut_pieces,
            actual_full_sheet_count: row.actual_full_count,
            actual_cut_pieces: row.actual_cuts,
          }))
        : standardPreview.map((row) => ({
            product_id: row.product_id,
            product_code: row.product_code,
            product_name: row.product_name,
            unit: row.unit,
            system_qty: row.system_qty,
            actual_qty: row.actual_qty,
            variance_qty: row.variance,
          }));

    setSaving(true);
    const result = await saveInventoryAuditDraftAction({
      audit_type: mode,
      warehouse_id: selectedWarehouse.id,
      warehouse_name: selectedWarehouse.name,
      audit_date: auditDate,
      auditor_name: auditorName,
      notes,
      items,
    });
    setSaving(false);

    if (!result.success || !result.data) {
      alert(t("common.errorOccurred", { message: result.error || t("common.error") }));
      return;
    }

    setConfirmApply({ open: true, auditId: result.data.auditId });
  };

  const handleConfirmApply = async () => {
    if (!confirmApply.auditId) return;
    setSaving(true);
    const result = await applyInventoryAuditAdjustmentsAction(confirmApply.auditId);
    setSaving(false);

    if (!result.success || !result.data) {
      alert(t("common.errorOccurred", { message: result.error || t("common.error") }));
      return;
    }

    setConfirmApply({ open: false, auditId: "" });
    await loadVouchers();

    const appliedVoucher = await fetchInventoryAuditVouchersAction();
    if (appliedVoucher.success && appliedVoucher.data) {
      const voucher = appliedVoucher.data.find((v) => v.id === result.data?.voucherId);
      if (voucher) {
        setVoucherPrint({
          voucher_number: voucher.voucher_number,
          audit_type: voucher.audit_type,
          warehouse_name: voucher.warehouse_name,
          audit_date: voucher.audit_date,
          auditor_name: voucher.auditor_name,
          applied_at: voucher.applied_at,
          items: (voucher.items as Array<Record<string, unknown>>).map((item) => ({
            product_code: String(item.product_code || ""),
            product_name: String(item.product_name || ""),
            unit: String(item.unit || ""),
            system_qty: Number(item.system_qty || 0),
            actual_qty: Number(item.actual_qty || 0),
            variance_qty: Number(item.variance_qty || 0),
            full_sheet_length_m: Number(item.full_sheet_length_m || 0) || null,
            system_full_sheet_count: Number(item.system_full_sheet_count || 0) || null,
            actual_full_sheet_count: Number(item.actual_full_sheet_count || 0) || null,
            system_cut_pieces: Array.isArray(item.system_cut_pieces)
              ? (item.system_cut_pieces as number[])
              : [],
            actual_cut_pieces: Array.isArray(item.actual_cut_pieces)
              ? (item.actual_cut_pieces as number[])
              : [],
          })),
        });
      }
    }

    alert(t("inventoryAudit.applySuccess"));
  };

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<ClipboardCheck className="h-6 w-6 text-app-accent" />}
        title={t("inventoryAudit.title")}
        description={t("inventoryAudit.description")}
        createLabel={t("inventoryAudit.saveAudit")}
        onCreate={() => void handleSaveAudit()}
        createDisabled={saving || loadingRows}
        extraActions={
          <button
            type="button"
            onClick={handlePrintPrecheck}
            className="flex items-center gap-2 rounded-xl border border-app bg-app-card-hover px-4 py-2.5 text-xs font-semibold text-app hover:bg-app-card-hover"
          >
            <Printer className="h-4 w-4" />
            {t("inventoryAudit.printPrecheck")}
          </button>
        }
      />

      <main className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-app bg-app-card p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-app-muted">{t("inventoryAudit.mode")}</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("standard")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === "standard" ? "bg-[image:var(--app-gradient)] text-white" : "border border-app text-app"}`}
              >
                {t("inventoryAudit.standard")}
              </button>
              <button
                type="button"
                onClick={() => setMode("polywood")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === "polywood" ? "bg-[image:var(--app-gradient)] text-white" : "border border-app text-app"}`}
              >
                {t("inventoryAudit.polywood")}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-app-muted">{t("common.warehouse")}</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="app-input text-sm"
              disabled={mode === "polywood"}
            >
              {(mode === "polywood" ? [polywoodWarehouse].filter(Boolean) : standardWarehouses).map((w) => (
                <option key={w!.id} value={w!.id}>
                  {w!.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-app-muted">{t("common.date")}</label>
            <input
              type="date"
              value={auditDate}
              onChange={(e) => setAuditDate(e.target.value)}
              className="app-input text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-app-muted">{t("common.checker")}</label>
            <input
              type="text"
              value={auditorName}
              onChange={(e) => setAuditorName(e.target.value)}
              className="app-input text-sm"
              placeholder={t("inventoryAudit.auditorPlaceholder")}
            />
          </div>
        </div>

        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="app-input text-sm"
          placeholder={t("inventoryAudit.notesPlaceholder")}
        />

        <div className="app-table-wrap">
          {loadingRows ? (
            <div className="p-10 text-center text-sm text-app-muted">{t("common.loading")}</div>
          ) : mode === "polywood" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                  <tr>
                    <th className="px-3 py-2">{t("common.code")}</th>
                    <th className="px-3 py-2">{t("common.product")}</th>
                    <th className="px-3 py-2 text-right">{t("inventoryAudit.systemStock")}</th>
                    <th className="px-3 py-2 text-right">{t("inventoryAudit.actualFullSheets")}</th>
                    <th className="px-3 py-2">{t("inventoryAudit.actualCutPieces")}</th>
                    <th className="px-3 py-2 text-right">{t("inventoryAudit.actualCount")}</th>
                    <th className="px-3 py-2 text-right">{t("inventoryAudit.variance")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {polywoodPreview.map((row) => (
                    <tr key={row.product_id}>
                      <td className="px-3 py-2 font-mono">{row.product_code}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-app">{row.product_name}</div>
                        <div className="text-[10px] text-app-muted">
                          {row.system_full_sheet_count}×{row.full_sheet_length_m}m | {fmtCutPieces(row.system_cut_pieces)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{row.system_total_m.toFixed(2)} m</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          value={row.actual_full_sheet_count_input}
                          onChange={(e) =>
                            setPolywoodRows((prev) =>
                              prev.map((r) =>
                                r.product_id === row.product_id
                                  ? { ...r, actual_full_sheet_count_input: e.target.value }
                                  : r
                              )
                            )
                          }
                          className="app-input w-24 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.actual_cut_pieces_input}
                          onChange={(e) =>
                            setPolywoodRows((prev) =>
                              prev.map((r) =>
                                r.product_id === row.product_id
                                  ? { ...r, actual_cut_pieces_input: e.target.value }
                                  : r
                              )
                            )
                          }
                          placeholder="2.5,1.2"
                          className="app-input text-xs"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{row.actual_total.toFixed(2)} m</td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-semibold ${row.variance < 0 ? "text-rose-600" : "text-emerald-600"}`}
                      >
                        {row.variance.toFixed(2)} m
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                  <tr>
                    <th className="px-3 py-2">{t("common.code")}</th>
                    <th className="px-3 py-2">{t("common.product")}</th>
                    <th className="px-3 py-2 text-right">{t("inventoryAudit.systemStock")}</th>
                    <th className="px-3 py-2 text-right">{t("inventoryAudit.actualCount")}</th>
                    <th className="px-3 py-2 text-right">{t("inventoryAudit.variance")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {standardPreview.map((row) => (
                    <tr key={row.product_id}>
                      <td className="px-3 py-2 font-mono">{row.product_code}</td>
                      <td className="px-3 py-2 font-semibold text-app">{row.product_name}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.system_qty.toFixed(2)} {row.unit}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={row.actual_qty_input}
                          onChange={(e) =>
                            setStandardRows((prev) =>
                              prev.map((r) =>
                                r.product_id === row.product_id
                                  ? { ...r, actual_qty_input: e.target.value }
                                  : r
                              )
                            )
                          }
                          className="app-input w-28 text-right text-xs"
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-semibold ${row.variance < 0 ? "text-rose-600" : "text-emerald-600"}`}
                      >
                        {row.variance.toFixed(2)} {row.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-app bg-app-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-app">{t("inventoryAudit.voucherHistory")}</h3>
            <button
              type="button"
              onClick={() => void loadVouchers()}
              className="rounded-lg border border-app px-3 py-1 text-xs font-semibold text-app"
            >
              {t("common.refresh")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                <tr>
                  <th className="px-3 py-2">{t("inventoryAudit.voucherNo")}</th>
                  <th className="px-3 py-2">{t("common.warehouse")}</th>
                  <th className="px-3 py-2">{t("common.date")}</th>
                  <th className="px-3 py-2">{t("common.checker")}</th>
                  <th className="px-3 py-2 text-center">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vouchers.map((voucher) => (
                  <tr key={voucher.id}>
                    <td className="px-3 py-2 font-mono font-semibold">{voucher.voucher_number}</td>
                    <td className="px-3 py-2">{voucher.warehouse_name}</td>
                    <td className="px-3 py-2">{voucher.audit_date}</td>
                    <td className="px-3 py-2">{voucher.auditor_name}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setVoucherPrint({
                            voucher_number: voucher.voucher_number,
                            audit_type: voucher.audit_type,
                            warehouse_name: voucher.warehouse_name,
                            audit_date: voucher.audit_date,
                            auditor_name: voucher.auditor_name,
                            applied_at: voucher.applied_at,
                            items: (voucher.items as Array<Record<string, unknown>>).map((item) => ({
                              product_code: String(item.product_code || ""),
                              product_name: String(item.product_name || ""),
                              unit: String(item.unit || ""),
                              system_qty: Number(item.system_qty || 0),
                              actual_qty: Number(item.actual_qty || 0),
                              variance_qty: Number(item.variance_qty || 0),
                              full_sheet_length_m: Number(item.full_sheet_length_m || 0) || null,
                              system_full_sheet_count: Number(item.system_full_sheet_count || 0) || null,
                              actual_full_sheet_count: Number(item.actual_full_sheet_count || 0) || null,
                              system_cut_pieces: Array.isArray(item.system_cut_pieces)
                                ? (item.system_cut_pieces as number[])
                                : [],
                              actual_cut_pieces: Array.isArray(item.actual_cut_pieces)
                                ? (item.actual_cut_pieces as number[])
                                : [],
                            })),
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        {t("common.print")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {confirmApply.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
          <div className="w-full max-w-md rounded-xl border border-app bg-app-card p-5">
            <h3 className="text-sm font-bold text-app">{t("inventoryAudit.confirmTitle")}</h3>
            <p className="mt-2 text-sm text-app-muted">{t("inventoryAudit.confirmText")}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmApply({ open: false, auditId: "" })}
                className="rounded-lg border border-app px-3 py-1.5 text-xs font-semibold text-app"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmApply()}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                {saving ? t("common.saving") : t("inventoryAudit.applyNow")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {precheckPrint ? (
        <div className="print-area">
          <InventoryAuditPrecheckPrintTemplate data={precheckPrint} />
        </div>
      ) : null}

      {voucherPrint ? (
        <div className="print-area">
          <InventoryAuditVoucherPrintTemplate data={voucherPrint} />
        </div>
      ) : null}

      <div className="fixed bottom-4 right-4 z-20 flex gap-2">
        <button
          type="button"
          onClick={handlePrintPrecheck}
          className="inline-flex items-center gap-1 rounded-lg border border-app bg-app-card px-3 py-1.5 text-xs font-semibold text-app"
        >
          <Printer className="h-3.5 w-3.5" />
          {t("inventoryAudit.printPrecheck")}
        </button>
        <button
          type="button"
          onClick={() => void handleSaveAudit()}
          disabled={saving || loadingRows}
          className="inline-flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {t("inventoryAudit.saveAudit")}
        </button>
      </div>
    </PageLayout>
  );
}
