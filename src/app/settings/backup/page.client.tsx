"use client";

import React, { useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import FileDropzone from "@/components/settings/FileDropzone";
import ConfirmRestoreModal from "@/components/settings/ConfirmRestoreModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createFullBackupAction,
  exportCustomersCsvAction,
  exportExpensesPayrollCsvAction,
  exportInvoicesCsvAction,
  exportProductsCsvAction,
  restoreFullBackupAction,
} from "@/lib/actions/backup";
import type { SystemBackupPayload } from "@/lib/backup/manifest";
import { downloadJsonFile, downloadTextFile } from "@/lib/csv/csvUtils";
import {
  AlertTriangle,
  Database,
  Download,
  FileSpreadsheet,
  Upload,
  Users,
  Package,
  Receipt,
  Wallet,
} from "lucide-react";

export default function BackupSettingsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");

  const [backingUp, setBackingUp] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<{ name: string; payload: SystemBackupPayload } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const handleFullBackup = async () => {
    if (!canManage) return;
    setBackingUp(true);
    setStatusMsg(null);
    setStatusError(null);
    const result = await createFullBackupAction();
    setBackingUp(false);
    if (!result.success) {
      setStatusError(result.error);
      return;
    }
    downloadJsonFile(result.data.filename, result.data.payload);
    setStatusMsg(t("backup.backupCreated", { filename: result.data.filename }));
  };

  const handleRestoreFile = async (file: File) => {
    setStatusMsg(null);
    setStatusError(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as SystemBackupPayload;
      setRestoreFile({ name: file.name, payload });
    } catch {
      setStatusError(t("backup.invalidBackupFile"));
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreFile || !canManage) return;
    setRestoring(true);
    const result = await restoreFullBackupAction(restoreFile.payload);
    setRestoring(false);
    setRestoreFile(null);
    if (!result.success) {
      setStatusError(result.error);
      return;
    }
    const { restoredTables, warnings } = result.data;
    setStatusMsg(
      t("backup.restoreComplete", {
        count: restoredTables,
        warnings: warnings.length,
      })
    );
    if (warnings.length) {
      setStatusError(warnings.slice(0, 5).join("\n"));
    }
  };

  const runExport = async (
    key: string,
    action: () => Promise<
      | { success: true; data: { filename: string; content: string } }
      | { success: false; error: string }
    >
  ) => {
    if (!canManage) return;
    setExporting(key);
    setStatusMsg(null);
    setStatusError(null);
    const result = await action();
    setExporting(null);
    if (!result.success) {
      setStatusError(result.error);
      return;
    }
    downloadTextFile(result.data.filename, result.data.content);
    setStatusMsg(t("backup.exportDone", { filename: result.data.filename }));
  };

  const exportModules = [
    {
      id: "customers",
      icon: Users,
      titleKey: "backup.exportCustomersTitle",
      descKey: "backup.exportCustomersDesc",
      filename: "Musteri_Siyahisi.csv",
      action: exportCustomersCsvAction,
    },
    {
      id: "products",
      icon: Package,
      titleKey: "backup.exportProductsTitle",
      descKey: "backup.exportProductsDesc",
      filename: "Mahsullar_ve_Stok.csv",
      action: exportProductsCsvAction,
    },
    {
      id: "invoices",
      icon: Receipt,
      titleKey: "backup.exportInvoicesTitle",
      descKey: "backup.exportInvoicesDesc",
      filename: "Satisi_ve_Alis_Fakturalari.csv",
      action: exportInvoicesCsvAction,
    },
    {
      id: "expenses",
      icon: Wallet,
      titleKey: "backup.exportExpensesTitle",
      descKey: "backup.exportExpensesDesc",
      filename: "Xercler_ve_Emekhaqqi.csv",
      action: exportExpensesPayrollCsvAction,
    },
  ] as const;

  return (
    <PageLayout>
      <PermissionGuard permission="can_view_settings">
        <SettingsTabs activeTab="backup" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-5xl space-y-6">
            <header>
              <h1 className="text-xl font-bold text-app">{t("backup.title")}</h1>
              <p className="mt-1 text-sm text-app-muted">{t("backup.description")}</p>
            </header>

            {(statusMsg || statusError) && (
              <div
                className={`rounded-xl border px-4 py-3 text-xs ${
                  statusError
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                {statusError || statusMsg}
              </div>
            )}

            {/* Full backup */}
            <section className="app-card app-card-elevated p-6">
              <div className="mb-4 flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-400" />
                <h2 className="text-sm font-bold text-app">{t("backup.fullBackupTitle")}</h2>
              </div>
              <p className="mb-4 text-xs text-app-muted">{t("backup.fullBackupDesc")}</p>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!canManage || backingUp}
                  onClick={() => void handleFullBackup()}
                  className="btn-primary disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {backingUp ? t("backup.creatingBackup") : t("backup.createBackup")}
                </button>
              </div>

              <div className="mt-6 border-t border-app pt-6">
                <div className="mb-3 flex items-center gap-2 text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs font-semibold">{t("backup.restoreSectionTitle")}</span>
                </div>
                <p className="mb-4 text-xs text-app-muted">{t("backup.restoreSectionDesc")}</p>
                <FileDropzone
                  accept=".json"
                  disabled={!canManage || restoring}
                  label={t("backup.restoreDropzone")}
                  hint={t("backup.restoreDropzoneHint")}
                  onFile={handleRestoreFile}
                />
              </div>
            </section>

            {/* Modular exports */}
            <section className="app-card app-card-elevated p-6">
              <div className="mb-4 flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                <h2 className="text-sm font-bold text-app">{t("backup.modularExportTitle")}</h2>
              </div>
              <p className="mb-4 text-xs text-app-muted">{t("backup.modularExportDesc")}</p>

              <div className="grid gap-4 md:grid-cols-2">
                {exportModules.map((mod) => {
                  const Icon = mod.icon;
                  return (
                    <div
                      key={mod.id}
                      className="app-card rounded-xl p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-app-card-hover p-2">
                          <Icon className="h-4 w-4 text-blue-400" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-xs font-bold text-app">{t(mod.titleKey)}</h3>
                          <p className="mt-1 text-[11px] text-app-muted">{t(mod.descKey)}</p>
                          <p className="mt-1 font-mono text-[10px] text-app-muted">{mod.filename}</p>
                          <button
                            type="button"
                            disabled={!canManage || exporting === mod.id}
                            onClick={() => void runExport(mod.id, mod.action)}
                            className="btn-ghost mt-3 disabled:opacity-50"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {exporting === mod.id ? t("common.loading") : t("backup.downloadCsv")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>

        <ConfirmRestoreModal
          open={!!restoreFile}
          filename={restoreFile?.name ?? ""}
          loading={restoring}
          onCancel={() => setRestoreFile(null)}
          onConfirm={() => void handleConfirmRestore()}
        />
      </PermissionGuard>
    </PageLayout>
  );
}
