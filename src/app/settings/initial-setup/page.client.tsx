"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import FileDropzone from "@/components/settings/FileDropzone";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createInitialAccountAction,
  fetchSetupAccountsAction,
  importProductsAction,
  saveInitialBalancesAction,
  type AccountSetupRow,
} from "@/lib/actions/initialSetup";
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
import {
  Download,
  FileSpreadsheet,
  Landmark,
  Package,
  Plus,
  Save,
  Upload,
} from "lucide-react";

export default function InitialSetupPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");

  const [accounts, setAccounts] = useState<AccountSetupRow[]>([]);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [savingBalances, setSavingBalances] = useState(false);
  const [importPreview, setImportPreview] = useState<ProductImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const [newAccount, setNewAccount] = useState({
    name: "",
    type: "Kassa" as "Kassa" | "Bank",
    balance: "0",
  });
  const [creatingAccount, setCreatingAccount] = useState(false);
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const totalBalance = useMemo(
    () =>
      accounts.reduce((sum, acc) => {
        const val = balances[acc.id] ?? String(acc.balance);
        return sum + (Number(val) || 0);
      }, 0),
    [accounts, balances]
  );

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    const result = await fetchSetupAccountsAction();
    if (result.success && result.data) {
      setAccounts(result.data);
      const next: Record<string, string> = {};
      result.data.forEach((acc) => {
        next[acc.id] = String(acc.balance);
      });
      setBalances(next);
    }
    setLoadingAccounts(false);
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

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

  const handleSaveBalances = async () => {
    if (!canManage) return;
    setSavingBalances(true);
    const payload = accounts.map((acc) => ({
      accountId: acc.id,
      balance: Number(balances[acc.id] ?? acc.balance) || 0,
    }));
    const result = await saveInitialBalancesAction(payload);
    setSavingBalances(false);
    if (!result.success) {
      showError(t("common.errorOccurred", { message: formatRpcError(result.error, t) }));
      return;
    }
    showSuccess(t("initialSetup.balancesSaved", { count: result.data?.updated ?? 0 }));
    void loadAccounts();
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setCreatingAccount(true);
    const result = await createInitialAccountAction({
      name: newAccount.name,
      type: newAccount.type,
      balance: Number(newAccount.balance) || 0,
    });
    setCreatingAccount(false);
    if (!result.success) {
      showError(t("common.errorOccurred", { message: formatRpcError(result.error, t) }));
      return;
    }
    setNewAccount({ name: "", type: "Kassa", balance: "0" });
    void loadAccounts();
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

            {/* Cash & Bank */}
            <section className="app-card app-card-elevated p-6">
              <div className="mb-4 flex items-center gap-2">
                <Landmark className="h-5 w-5 text-blue-400" />
                <h2 className="text-sm font-bold text-app">{t("initialSetup.cashBankTitle")}</h2>
              </div>
              <p className="mb-4 text-xs text-app-muted">{t("initialSetup.cashBankDesc")}</p>

              {loadingAccounts ? (
                <p className="text-xs text-app-muted">{t("common.loading")}</p>
              ) : accounts.length === 0 ? (
                <p className="mb-4 text-xs text-amber-400">{t("initialSetup.noAccounts")}</p>
              ) : (
                <div className="space-y-3">
                  {accounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-app bg-app-card-hover px-4 py-3"
                    >
                      <div className="min-w-[140px] flex-1">
                        <p className="text-xs font-semibold text-app">{acc.name}</p>
                        <p className="text-[10px] uppercase tracking-wide text-app-muted">
                          {acc.type} · {acc.code}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={!canManage}
                          value={balances[acc.id] ?? ""}
                          onChange={(e) =>
                            setBalances((prev) => ({ ...prev, [acc.id]: e.target.value }))
                          }
                          className="app-input w-36 text-right text-sm"
                        />
                        <span className="text-xs text-app-muted">AZN</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-xl border border-blue-500/20 bg-[color:var(--app-accent-soft)]0/10 px-4 py-3">
                    <span className="text-xs font-semibold text-blue-200">
                      {t("initialSetup.totalOpeningBalance")}
                    </span>
                    <span className="font-mono text-sm font-bold text-blue-300">
                      {totalBalance.toFixed(2)} AZN
                    </span>
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={!canManage || savingBalances || accounts.length === 0}
                onClick={() => void handleSaveBalances()}
                className="btn-primary mt-4 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {savingBalances ? t("common.saving") : t("initialSetup.saveBalances")}
              </button>

              <form
                onSubmit={(e) => void handleCreateAccount(e)}
                className="mt-6 grid gap-3 border-t border-app pt-6 md:grid-cols-4"
              >
                <input
                  required
                  disabled={!canManage}
                  placeholder={t("initialSetup.accountNamePlaceholder")}
                  value={newAccount.name}
                  onChange={(e) => setNewAccount((p) => ({ ...p, name: e.target.value }))}
                  className="app-input text-xs md:col-span-2"
                />
                <select
                  disabled={!canManage}
                  value={newAccount.type}
                  onChange={(e) =>
                    setNewAccount((p) => ({
                      ...p,
                      type: e.target.value as "Kassa" | "Bank",
                    }))
                  }
                  className="app-input text-xs"
                >
                  <option value="Kassa">{t("initialSetup.accountTypeCash")}</option>
                  <option value="Bank">{t("initialSetup.accountTypeBank")}</option>
                </select>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canManage}
                    value={newAccount.balance}
                    onChange={(e) =>
                      setNewAccount((p) => ({ ...p, balance: e.target.value }))
                    }
                    className="app-input px-3 py-2 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={!canManage || creatingAccount}
                    className="btn-ghost shrink-0 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("common.add")}
                  </button>
                </div>
              </form>
            </section>

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
