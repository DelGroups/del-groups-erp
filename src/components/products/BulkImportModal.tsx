"use client";

import React, { useCallback, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import Button from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import ToastMessage from "@/components/ui/ToastMessage";
import {
  bulkImportRowToApiPayload,
  downloadBulkImportTemplate,
  formatBulkImportDimensions,
  formatBulkImportMetraj,
  formatBulkImportPricePair,
  parseBulkImportCsv,
  type BulkImportRow,
} from "@/lib/products/bulkImport";
import { cn } from "@/lib/cn";

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export default function BulkImportModal({ open, onClose, onImported }: BulkImportModalProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkImportRow[]>([]);
  const [validCount, setValidCount] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const resetState = useCallback(() => {
    setDragActive(false);
    setFileName(null);
    setRows([]);
    setValidCount(0);
    setInvalidCount(0);
    setParseError(null);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      showError(t("products.bulkImport.csvOnly"));
      return;
    }

    const text = await file.text();
    const result = parseBulkImportCsv(text);
    if (result.parseError) {
      setParseError(result.parseError);
      setRows([]);
      setValidCount(0);
      setInvalidCount(0);
      setFileName(file.name);
      return;
    }

    setParseError(null);
    setRows(result.rows);
    setValidCount(result.validCount);
    setInvalidCount(result.invalidCount);
    setFileName(file.name);
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void processFile(file);
  };

  const handleUpload = async () => {
    const validRows = rows.filter((row) => row.isValid);
    if (validRows.length === 0 || uploading) return;

    setUploading(true);
    try {
      const response = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: validRows.map((row) => {
            const payload = bulkImportRowToApiPayload(row);
            return {
              ...payload.product,
              _bulk: {
                stock: payload.stock,
              },
            };
          }),
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        inserted?: number;
        skipped?: number;
        stockEntries?: number;
        warning?: string;
      };

      if (!response.ok || !payload.success) {
        showError(payload.error || t("common.error"));
        return;
      }

      const hadInitialStock = validRows.some(
        (row) =>
          (row.stock_mode === "piece" && Number(row.initial_count) > 0) ||
          (row.stock_mode === "meter" && row.metraj_pieces.length > 0)
      );

      if (hadInitialStock || (payload.stockEntries ?? 0) > 0) {
        showSuccess(t("products.bulkImport.uploadSuccessWithStock"));
      } else {
        showSuccess(
          t("products.bulkImport.uploadSuccess", {
            inserted: payload.inserted ?? 0,
            skipped: payload.skipped ?? 0,
          })
        );
      }

      onImported?.();
      handleClose();
    } catch {
      showError(t("common.error"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
      title={t("products.bulkImportLabel")}
      className="max-w-5xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={uploading}>
            {t("common.close")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleUpload()}
            disabled={uploading || validCount === 0}
            loading={uploading}
          >
            {t("products.bulkImport.confirmUpload")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-app-muted">{t("products.bulkImport.description")}</p>
          <Button type="button" variant="outline" size="sm" onClick={downloadBulkImportTemplate}>
            <Download className="h-4 w-4" />
            {t("products.bulkImport.downloadTemplate")}
          </Button>
        </div>

        <div
          className={cn(
            "rounded-[var(--erp-radius-md)] border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragActive
              ? "border-[color:var(--erp-color-primary)] bg-[color:var(--erp-color-primary)]/5"
              : "border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-input)]/40 hover:border-[color:var(--erp-color-primary)]/40"
          )}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            handleFiles(event.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />
          <FileSpreadsheet className="mx-auto mb-3 h-8 w-8 text-app-accent" />
          <p className="text-sm font-medium text-app">{t("products.bulkImport.dropTitle")}</p>
          <p className="mt-1 text-xs text-app-muted">{t("products.bulkImport.dropHint")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {t("products.bulkImport.chooseFile")}
          </Button>
          {fileName ? (
            <p className="mt-3 text-xs text-app-muted">
              {t("products.bulkImport.selectedFile", { name: fileName })}
            </p>
          ) : null}
        </div>

        {parseError ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {parseError}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <>
            <p className="text-sm font-medium text-app">
              {t("products.bulkImport.summary", {
                total: rows.length,
                valid: validCount,
                invalid: invalidCount,
              })}
            </p>

            <div className="max-h-72 overflow-auto rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)]">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-[color:var(--erp-bg-table-header)]">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colCode")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colName")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colCategory")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colSubcategory")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colBrand")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colBarcode")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colDimensions")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colBuyPrice")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colSellPrice")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colUnit")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colInitialCount")}</th>
                    <th className="px-2 py-2 whitespace-nowrap">{t("products.bulkImport.colMetraj")}</th>
                    <th className="px-2 py-2">{t("products.bulkImport.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.rowNumber}-${row.code}`}
                      className={cn(
                        "border-t border-[color:var(--erp-border-default)]",
                        row.isValid ? "bg-emerald-50/40" : "bg-rose-50/80"
                      )}
                    >
                      <td className="px-2 py-2 text-app-muted">{row.rowNumber}</td>
                      <td
                        className={cn(
                          "px-2 py-2 font-mono",
                          !row.code.trim() && "bg-rose-100 font-semibold text-rose-800"
                        )}
                      >
                        {row.code || "—"}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-2 max-w-[10rem] truncate",
                          !row.name.trim() && "bg-rose-100 font-semibold text-rose-800"
                        )}
                      >
                        {row.name || "—"}
                      </td>
                      <td className="px-2 py-2">{row.category || "—"}</td>
                      <td className="px-2 py-2">{row.subcategory || "—"}</td>
                      <td className="px-2 py-2">{row.brand || "—"}</td>
                      <td className="px-2 py-2 font-mono">
                        {row.barcode || t("products.bulkImport.barcodeAuto")}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {row.is_dimensional ? (
                          <span className="font-medium text-app-accent">
                            {formatBulkImportDimensions(row)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono whitespace-nowrap">
                        {formatBulkImportPricePair(row.buy_price_piece, row.buy_price_meter)}
                      </td>
                      <td className="px-2 py-2 font-mono whitespace-nowrap">
                        {formatBulkImportPricePair(row.sell_price_piece, row.sell_price_meter)}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{row.measure_unit || "—"}</td>
                      <td className="px-2 py-2 font-mono">
                        {row.stock_mode === "piece" ? row.initial_count || "0" : "—"}
                      </td>
                      <td
                        className="px-2 py-2 max-w-[9rem] truncate"
                        title={formatBulkImportMetraj(row)}
                      >
                        {row.stock_mode === "meter" ? formatBulkImportMetraj(row) : "—"}
                      </td>
                      <td className="px-2 py-2">
                        {row.isValid ? (
                          <span className="font-semibold text-emerald-700">
                            {t("products.bulkImport.valid")}
                          </span>
                        ) : (
                          <span className="text-rose-700">{row.errors.join("; ") || "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-app-muted">{t("products.bulkImport.pricePairHint")}</p>
          </>
        ) : null}
      </div>

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </Modal>
  );
}
