"use client";

import React, { useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import FileDropzone from "@/components/settings/FileDropzone";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { importProductsAction } from "@/lib/actions/initialSetup";
import {
  buildProductImportTemplateCsv,
  getProductImportHeaderLabels,
  getProductImportSampleRow,
  parseProductImportRows,
} from "@/lib/initial-setup/productImport";
import type { ProductImportRow } from "@/lib/initial-setup/types";
import { downloadTextFile, readSpreadsheetRows } from "@/lib/csv/csvUtils";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { ArrowRight, Download, FileSpreadsheet, Landmark, Package, Upload } from "lucide-react";

export default function InitialSetupPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");

  const [importPreview, setImportPreview] = useState<ProductImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  const handleDownloadTemplate = () => {
    const headers = getProductImportHeaderLabels(t);
    const sample = getProductImportSampleRow(t);
    downloadTextFile(
      "Məhsul_İdxal_Şablonu.csv",
      buildProductImportTemplateCsv(headers, sample)
    );
  };

  const handleParseFile = async (file: File) => {
    setImportResult(null);
    try {
      const rows = await readSpreadsheetRows(file);
      const { items, errors } = parseProductImportRows(rows);
      setImportPreview(items);
      setImportErrors(
        errors.map((e) =>
          t(`initialSetup.importErrors.${e.message}`, { row: e.row })
        )
      );
    } catch (err) {
      setImportPreview([]);
      setImportErrors([
        err instanceof Error ? err.message : t("initialSetup.parseFailed"),
      ]);
    }
  };

  const handleImportProducts = async () => {
    if (!canManage || importPreview.length === 0) return;
    setImporting(true);
    const result = await importProductsAction(importPreview);
    setImporting(false);
    if (!result.success) {
      showError(t("common.errorOccurred", { message: formatRpcError(result.error, t) }));
      return;
    }
    const { inserted, skipped, errors } = result.data!;
    setImportResult(
      t("initialSetup.importSuccess", { inserted, skipped, errors: errors.length })
    );
    if (errors.length) {
      setImportErrors(errors.slice(0, 10));
    }
    setImportPreview([]);
  };

  return (
    <PageLayout>
      <PermissionGuard permission="can_view_settings">
        <SettingsTabs activeTab="initial-setup" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <header>
              <h1 className="text-xl font-bold text-app">{t("initialSetup.title")}</h1>
              <p className="mt-1 text-sm text-app-muted">{t("initialSetup.description")}</p>
            </header>

            <a
              href="/finance/opening-balances"
              className="app-card flex items-center justify-between gap-3 rounded-xl border border-app p-4 hover:bg-app-card-hover"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-app">
                <Landmark className="h-4 w-4 text-app-accent" />
                {t("finance.openingBalances.title")}
              </span>
              <ArrowRight className="h-4 w-4 text-app-muted" />
            </a>

            {/* Product Import */}
            <section className="app-card app-card-elevated p-6">
              <div className="mb-4 flex items-center gap-2">
                <Package className="h-5 w-5 text-amber-400" />
                <h2 className="text-sm font-bold text-app">{t("initialSetup.productImportTitle")}</h2>
              </div>
              <p className="mb-4 text-xs text-app-muted">{t("initialSetup.productImportDesc")}</p>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="btn-ghost"
                >
                  <Download className="h-4 w-4 text-blue-400" />
                  {t("initialSetup.downloadTemplate")}
                </button>
              </div>

              <FileDropzone
                disabled={!canManage || importing}
                onFile={handleParseFile}
                accept=".csv,.xlsx,.xls"
              />

              {importErrors.length > 0 && (
                <ul className="mt-4 space-y-1 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] text-rose-300">
                  {importErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              )}

              {importPreview.length > 0 && (
                <div className="app-table-wrap mt-4">
                  <div className="flex items-center justify-between border-b border-app bg-app-card-hover px-4 py-2">
                    <span className="flex items-center gap-2 text-xs font-semibold text-app">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                      {t("initialSetup.previewCount", { count: importPreview.length })}
                    </span>
                    <button
                      type="button"
                      disabled={!canManage || importing}
                      onClick={() => void handleImportProducts()}
                      className="badge-success gap-1 px-3 py-1.5 text-[11px] disabled:opacity-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {importing ? t("initialSetup.importing") : t("initialSetup.confirmImport")}
                    </button>
                  </div>
                  <div className="max-h-48 overflow-auto">
                    <table className="app-table text-[11px]">
                      <thead>
                        <tr>
                          <th className="px-3 py-2">{t("initialSetup.importHeaders.barcode")}</th>
                          <th className="px-3 py-2">{t("initialSetup.importHeaders.sku")}</th>
                          <th className="px-3 py-2">{t("initialSetup.importHeaders.name")}</th>
                          <th className="px-3 py-2">{t("initialSetup.importHeaders.retailPrice")}</th>
                          <th className="px-3 py-2">{t("initialSetup.importHeaders.initialStock")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.slice(0, 8).map((row, i) => (
                          <tr key={`${row.sku}-${row.barcode}-${i}`} className="border-t border-app">
                            <td className="px-3 py-2 font-mono">{row.barcode || "—"}</td>
                            <td className="px-3 py-2 font-mono">{row.sku || "—"}</td>
                            <td className="px-3 py-2">{row.name}</td>
                            <td className="px-3 py-2">{row.retailPrice.toFixed(2)}</td>
                            <td className="px-3 py-2">{row.initialStock}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {importResult && (
                <p className="mt-3 text-xs font-semibold text-emerald-400">{importResult}</p>
              )}
            </section>
          </div>
        </div>
      </PermissionGuard>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
