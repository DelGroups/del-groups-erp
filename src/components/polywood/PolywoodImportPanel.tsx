"use client";

import React, { useState } from "react";
import FileDropzone from "@/components/settings/FileDropzone";
import { importPolywoodStockAction } from "@/lib/actions/polywood";
import { readSpreadsheetRows, downloadTextFile } from "@/lib/csv/csvUtils";
import {
  buildPolywoodImportTemplateCsv,
  downloadPolywoodImportTemplateXlsx,
  formatGroupedStock,
  parsePolywoodImportRows,
  validPolywoodImportRows,
  type PolywoodImportRow,
} from "@/lib/polywood/import";
import { useI18n } from "@/i18n/I18nProvider";
import { Download, Upload } from "lucide-react";

interface PolywoodImportPanelProps {
  onImported?: () => void;
  initialProductId?: string | null;
}

export default function PolywoodImportPanel({ onImported, initialProductId }: PolywoodImportPanelProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<PolywoodImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setMessage(null);
    const spreadsheetRows = await readSpreadsheetRows(file);
    const parsed = parsePolywoodImportRows(spreadsheetRows);
    setRows(parsed);
  };

  const handleDownloadTemplateXlsx = async () => {
    await downloadPolywoodImportTemplateXlsx();
  };

  const handleDownloadTemplateCsv = () => {
    downloadTextFile("Polywood_Import_Sablonu.csv", buildPolywoodImportTemplateCsv());
  };

  const handleImport = async () => {
    const validRows = validPolywoodImportRows(rows);
    if (validRows.length === 0) {
      setMessage(t("polywood.import.noValidRows"));
      return;
    }

    setImporting(true);
    setMessage(null);
    const result = await importPolywoodStockAction(validRows);
    setImporting(false);

    if (!result.success) {
      setMessage(result.error || t("common.error"));
      return;
    }

    setMessage(
      t("polywood.import.success", {
        imported: result.data?.imported ?? 0,
        skipped: result.data?.skipped ?? 0,
      })
    );
    setRows([]);
    onImported?.();
  };

  const validCount = validPolywoodImportRows(rows).length;
  const errorCount = rows.filter((row) => row.errors.length > 0).length;

  return (
    <div className="space-y-4">
      {initialProductId ? (
        <p className="rounded-lg border border-app bg-app-card-hover px-3 py-2 text-sm text-app-muted">
          Seçilmiş məhsul üçün idxal: <span className="font-mono text-app">{initialProductId}</span>
        </p>
      ) : null}
      <div className="app-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-app">{t("polywood.import.title")}</h3>
            <p className="text-sm text-app-muted">{t("polywood.import.description")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleDownloadTemplateXlsx} className="btn-primary">
              <Download className="h-4 w-4" />
              {t("polywood.import.downloadTemplateXlsx")}
            </button>
            <button type="button" onClick={handleDownloadTemplateCsv} className="btn-secondary">
              <Download className="h-4 w-4" />
              {t("polywood.import.downloadTemplateCsv")}
            </button>
          </div>
        </div>

        <FileDropzone
          accept=".csv,.xlsx,.xls"
          onFile={handleFile}
          label={t("polywood.import.dropLabel")}
        />

        <div className="mt-4 rounded-lg bg-app-card-hover p-3 text-xs text-app-muted">
          <p className="font-semibold text-app">{t("polywood.import.columnsTitle")}</p>
          <p className="mt-1">
            code, name, category, sub_category, buy_price, sell_price, barcode, full_sheet_length_m,
            piece_lengths
          </p>
          <p className="mt-2">{t("polywood.import.lengthsHint")}</p>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="app-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-app px-4 py-3">
            <p className="text-sm font-semibold text-app">
              {t("polywood.import.preview")} ({validCount} {t("polywood.import.valid")},{" "}
              {errorCount} {t("polywood.import.errors")})
            </p>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || validCount === 0}
              className="btn-primary"
            >
              <Upload className="h-4 w-4" />
              {importing ? t("common.loading") : t("polywood.import.submit")}
            </button>
          </div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-app-card-hover font-bold uppercase text-app">
                <tr>
                  <th className="p-2">#</th>
                  <th className="p-2">{t("polywood.table.code")}</th>
                  <th className="p-2">{t("polywood.table.product")}</th>
                  <th className="p-2">{t("polywood.import.category")}</th>
                  <th className="p-2">{t("polywood.import.subCategory")}</th>
                  <th className="p-2">{t("polywood.import.groupedStock")}</th>
                  <th className="p-2">{t("common.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {rows.map((row) => (
                  <tr key={row.rowNumber} className={row.errors.length ? "bg-red-50/50" : ""}>
                    <td className="p-2">{row.rowNumber}</td>
                    <td className="p-2 font-mono">{row.code || "—"}</td>
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{row.category || "—"}</td>
                    <td className="p-2">{row.subCategory || "—"}</td>
                    <td className="p-2 font-mono">
                      {formatGroupedStock(row.groupedStock) || row.parsedLengths.join("; ") || "—"}
                    </td>
                    <td className="p-2">
                      {row.errors.length > 0 ? (
                        <span className="text-red-600">{row.errors.join("; ")}</span>
                      ) : (
                        <span className="text-emerald-600">{t("polywood.import.rowOk")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="rounded-lg border border-app bg-app-card px-4 py-3 text-sm text-app">
          {message}
        </div>
      ) : null}
    </div>
  );
}
