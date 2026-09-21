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
  formatBulkImportPricePair,
  parseBulkImportCsv,
  type BulkImportRow,
} from "@/lib/products/bulkImport";
import { cn } from "@/lib/cn";

const thClass =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-[color:var(--erp-text-main)]";
const tdClass =
  "px-3 py-2 text-xs text-[color:var(--erp-text-main)] border-b border-[color:var(--erp-border-default)]/70 whitespace-nowrap";

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

  const hasParsedPreview = rows.length > 0;

  const handleUpload = async () => {
    const validRows = rows.filter((row) => row.isValid);
    if (validRows.length === 0 || uploading) return;

    setUploading(true);
    try {
      const response = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: validRows.map((row) => bulkImportRowToApiPayload(row).product),
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        inserted?: number;
        skipped?: number;
        warning?: string;
      };

      if (!response.ok || !payload.success) {
        showError(payload.error || t("common.error"));
        return;
      }

      const successText = t("products.bulkImport.uploadSuccess", {
        inserted: payload.inserted ?? 0,
        skipped: payload.skipped ?? 0,
      });

      showSuccess(payload.warning ? `${successText} ${payload.warning}` : successText);

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
      className="top-1/2 w-[min(92vw,72rem)] max-w-none -translate-y-1/2 sm:w-[min(85vw,72rem)]"
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-6"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
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
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-app-muted">{t("products.bulkImport.description")}</p>
          <Button type="button" variant="outline" size="sm" onClick={downloadBulkImportTemplate}>
            <Download className="h-4 w-4" />
            {t("products.bulkImport.downloadTemplate")}
          </Button>
        </div>

        {hasParsedPreview ? (
          <div
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)]/60 px-3 py-2"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleFiles(event.dataTransfer.files);
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-app-accent" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-app">{fileName}</p>
                <p className="text-xs text-app-muted">
                  {t("products.bulkImport.productsFound", { count: rows.length })}
                  {invalidCount > 0
                    ? ` · ${t("products.bulkImport.invalidCount", { count: invalidCount })}`
                    : null}
                </p>
              </div>
            </div>
            <Button
              type="button"
              appearance="text"
              color="primary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              {t("products.bulkImport.changeFile")}
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "shrink-0 rounded-[var(--erp-radius-md)] border-2 border-dashed px-6 py-8 text-center transition-colors",
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
            <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-app-accent" />
            <p className="text-sm font-medium text-app">{t("products.bulkImport.dropTitle")}</p>
            <p className="mt-1 text-xs text-app-muted">{t("products.bulkImport.dropHint")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {t("products.bulkImport.chooseFile")}
            </Button>
            {fileName && !hasParsedPreview ? (
              <p className="mt-2 text-xs text-app-muted">
                {t("products.bulkImport.selectedFile", { name: fileName })}
              </p>
            ) : null}
          </div>
        )}

        {parseError ? (
          <p className="shrink-0 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {parseError}
          </p>
        ) : null}

        {hasParsedPreview ? (
          <>
            <div
              className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-[color:var(--erp-border-default)] shadow-inner"
            >
              <table className="w-full min-w-[1500px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-[color:var(--erp-bg-table-header)] font-semibold shadow-[0_1px_0_var(--erp-border-default)]">
                  <tr>
                    <th className={cn(thClass, "min-w-[48px]")}>#</th>
                    <th className={cn(thClass, "min-w-[130px]")}>{t("products.bulkImport.colCode")}</th>
                    <th className={cn(thClass, "min-w-[200px]")}>{t("products.bulkImport.colName")}</th>
                    <th className={cn(thClass, "min-w-[140px]")}>{t("products.bulkImport.colCategory")}</th>
                    <th className={cn(thClass, "min-w-[140px]")}>{t("products.bulkImport.colSubcategory")}</th>
                    <th className={cn(thClass, "min-w-[100px]")}>{t("products.bulkImport.colBrand")}</th>
                    <th className={cn(thClass, "min-w-[110px]")}>{t("products.bulkImport.colBarcode")}</th>
                    <th className={cn(thClass, "min-w-[110px]")}>{t("products.bulkImport.colDimensions")}</th>
                    <th className={cn(thClass, "min-w-[120px]")}>{t("products.bulkImport.colBuyPrice")}</th>
                    <th className={cn(thClass, "min-w-[120px]")}>{t("products.bulkImport.colSellPrice")}</th>
                    <th className={cn(thClass, "min-w-[90px]")}>{t("products.bulkImport.colUnit")}</th>
                    <th className={cn(thClass, "min-w-[160px]")}>{t("products.bulkImport.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.rowNumber}-${row.code}`}
                      className={cn(row.isValid ? "bg-emerald-50/30" : "bg-rose-50/70")}
                    >
                      <td className={cn(tdClass, "text-app-muted")}>{row.rowNumber}</td>
                      <td
                        className={cn(
                          tdClass,
                          "font-mono",
                          !row.code.trim() && "bg-rose-100/90 font-semibold text-rose-800"
                        )}
                      >
                        {row.code || "—"}
                      </td>
                      <td
                        className={cn(
                          tdClass,
                          "max-w-[220px] truncate",
                          !row.name.trim() && "bg-rose-100/90 font-semibold text-rose-800"
                        )}
                        title={row.name}
                      >
                        {row.name || "—"}
                      </td>
                      <td className={cn(tdClass, "min-w-[140px]")}>{row.category || "—"}</td>
                      <td className={cn(tdClass, "min-w-[140px]")}>{row.subcategory || "—"}</td>
                      <td className={tdClass}>{row.brand || "—"}</td>
                      <td className={cn(tdClass, "font-mono")}>
                        {row.barcode || t("products.bulkImport.barcodeAuto")}
                      </td>
                      <td className={tdClass}>
                        {row.is_dimensional ? (
                          <span className="font-medium text-app-accent">
                            {formatBulkImportDimensions(row)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={cn(tdClass, "font-mono")}>
                        {formatBulkImportPricePair(row.buy_price_piece, row.buy_price_meter)}
                      </td>
                      <td className={cn(tdClass, "font-mono")}>
                        {formatBulkImportPricePair(row.sell_price_piece, row.sell_price_meter)}
                      </td>
                      <td className={tdClass}>{row.measure_unit || "—"}</td>
                      <td className={cn(tdClass, "min-w-[160px] whitespace-normal")}>
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
            <p className="shrink-0 text-[11px] leading-snug text-app-muted">
              {t("products.bulkImport.pricePairHint")}
            </p>
          </>
        ) : null}
      </div>

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </Modal>
  );
}
