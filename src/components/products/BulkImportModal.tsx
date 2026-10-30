"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import Button from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import ToastMessage from "@/components/ui/ToastMessage";
import { SameNameProductLink } from "@/components/products/DuplicateNameWarning";
import {
  bulkImportRowToApiPayload,
  downloadBulkImportTemplate,
  formatBulkImportDimensions,
  formatBulkImportPricePair,
  parseBulkImportCsv,
  type BulkImportRow,
} from "@/lib/products/bulkImport";
import { checkImportNames, rowsToImport, type NameCheckProduct } from "@/lib/products/duplicateNames";
import { cn } from "@/lib/cn";

const thClass =
  "px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-[color:var(--erp-text-main)]";
const tdClass =
  "px-3 py-2 text-xs text-[color:var(--erp-text-main)] border-b border-[color:var(--erp-border-default)]/70 whitespace-nowrap";

const NO_PRODUCTS: NameCheckProduct[] = [];

interface BulkImportModalProps {
  open: boolean;
  /** The catalog, for the duplicate-name checks of the preview (fix F4). */
  products?: readonly NameCheckProduct[];
  onClose: () => void;
  onImported?: () => void;
}

export default function BulkImportModal({ open, products = NO_PRODUCTS, onClose, onImported }: BulkImportModalProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkImportRow[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Row numbers the user chose not to import (fix F4: flagged names). */
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(() => new Set());

  // Fix F4: same name as an existing product or another row, or a code that looks like a name.
  const nameChecks = useMemo(() => checkImportNames(rows, products), [rows, products]);
  const flaggedRows = useMemo(
    () => rows.filter((row) => row.isValid && nameChecks.has(row.rowNumber)).map((row) => row.rowNumber),
    [rows, nameChecks]
  );
  const importCount = rowsToImport(rows, skipped).length;
  const allFlaggedSkipped = flaggedRows.length > 0 && flaggedRows.every((number) => skipped.has(number));

  const toggleSkip = (rowNumber: number, skip: boolean) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (skip) next.add(rowNumber);
      else next.delete(rowNumber);
      return next;
    });

  const resetState = useCallback(() => {
    setDragActive(false);
    setFileName(null);
    setRows([]);
    setInvalidCount(0);
    setParseError(null);
    setUploading(false);
    setSkipped(new Set());
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
      setInvalidCount(0);
      setFileName(file.name);
      return;
    }

    setParseError(null);
    setSkipped(new Set());
    setRows(result.rows);
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
    const validRows = rowsToImport(rows, skipped);
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
            disabled={uploading || importCount === 0}
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
                  {skipped.size > 0 ? ` · ${t("products.bulkImport.skippedCount", { count: skipped.size })}` : null}
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

        {hasParsedPreview && flaggedRows.length > 0 ? (
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--erp-color-warning)]/30 bg-[color:var(--erp-color-warning)]/10 px-3 py-2 text-sm text-app"
          >
            <p className="flex min-w-0 flex-1 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--erp-color-warning)]" aria-hidden />
              {t("products.bulkImport.nameWarningSummary", { count: flaggedRows.length })}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSkipped(allFlaggedSkipped ? new Set() : new Set(flaggedRows))}
            >
              {allFlaggedSkipped
                ? t("products.bulkImport.importFlagged")
                : t("products.bulkImport.skipFlagged", { count: flaggedRows.length })}
            </Button>
          </div>
        ) : null}

        {hasParsedPreview ? (
          <>
            <div
              className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-[color:var(--erp-border-default)] shadow-inner"
            >
              <table className="w-full min-w-[1700px] border-collapse text-left">
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
                    <th className={cn(thClass, "min-w-[260px]")}>{t("products.bulkImport.status")}</th>
                    <th className={cn(thClass, "min-w-[80px]")}>{t("products.bulkImport.colSkip")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const check = nameChecks.get(row.rowNumber);
                    const isSkipped = skipped.has(row.rowNumber);
                    return (
                    <tr
                      key={`${row.rowNumber}-${row.code}`}
                      className={cn(
                        !row.isValid
                          ? "bg-rose-50/70"
                          : check
                            ? "bg-[color:var(--erp-color-warning)]/10"
                            : "bg-emerald-50/30",
                        isSkipped && "opacity-60"
                      )}
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
                      <td className={cn(tdClass, "min-w-[260px] whitespace-normal")}>
                        {!row.isValid ? (
                          <span className="text-rose-700">{row.errors.join("; ") || "—"}</span>
                        ) : isSkipped ? (
                          <span className="font-semibold text-app-muted">{t("products.bulkImport.skipped")}</span>
                        ) : (
                          <span className="font-semibold text-emerald-700">
                            {t("products.bulkImport.valid")}
                          </span>
                        )}
                        {check ? (
                          <ul className="mt-1 space-y-1 text-[color:var(--erp-text-main)]">
                            {check.existing.length > 0 ? (
                              <li>
                                <span className="font-semibold">{t("products.bulkImport.nameExists")}</span>
                                {check.existing.map((product) => (
                                  <SameNameProductLink key={product.id} product={product} className="ms-2 flex" />
                                ))}
                              </li>
                            ) : null}
                            {check.fileRows.length > 0 ? (
                              <li className="font-semibold">
                                {t("products.bulkImport.nameInFile", { rows: check.fileRows.join(", ") })}
                              </li>
                            ) : null}
                            {check.codeLooksLikeName ? (
                              <li className="font-semibold">{t("products.bulkImport.codeLooksLikeName")}</li>
                            ) : null}
                          </ul>
                        ) : null}
                      </td>
                      <td className={tdClass}>
                        {row.isValid && check ? (
                          <label className="inline-flex cursor-pointer items-center gap-1.5 py-1">
                            <input
                              type="checkbox"
                              checked={isSkipped}
                              onChange={(event) => toggleSkip(row.rowNumber, event.target.checked)}
                              className="h-4 w-4 accent-[color:var(--erp-color-primary)]"
                            />
                            {t("products.bulkImport.skip")}
                          </label>
                        ) : null}
                      </td>
                    </tr>
                    );
                  })}
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
