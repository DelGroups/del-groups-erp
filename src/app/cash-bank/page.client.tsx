"use client";

import PageLayout from "@/components/layout/PageLayout";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createAccountAction,
  deleteAccountAction,
  fetchAccountLedgerBalancesAction,
  updateAccountAction,
} from "@/lib/actions/finance";
import type { AccountLedgerBalance } from "@/lib/finance/unifiedLedger";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { useToast } from "@/hooks/useToast";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";

export default function CashBankPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountLedgerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountLedgerBalance | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountLedgerBalance | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    type: "Kassa",
    balance: "0.00",
  });
  const { can } = useAuth();
  const canManageFinance = can("can_manage_finance");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await fetchAccountLedgerBalancesAction();
    if (!result.success || !result.data) {
      showError(result.error || t("common.error"));
      setAccounts([]);
    } else {
      setAccounts(result.data.accounts);
    }
    setLoading(false);
  }, [showError, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageFinance) {
      showError(t("cashBank.noPermission"));
      return;
    }

    if (editingAccount) {
      const result = await updateAccountAction({
        accountId: editingAccount.account_id,
        code: formData.code,
        name: formData.name,
        type: formData.type,
      });
      if (!result.success) {
        showError(t("common.errorOccurred", { message: formatRpcError(result.error, t) }));
        return;
      }
      setIsModalOpen(false);
      setEditingAccount(null);
      setFormData({ code: "", name: "", type: "Kassa", balance: "0.00" });
      showSuccess(t("cashBank.updateSuccess"));
      void fetchData();
      return;
    }

    const result = await createAccountAction({
      code: formData.code,
      name: formData.name,
      type: formData.type,
      balance: parseFloat(formData.balance) || 0,
    });

    if (!result.success) {
      showError(t("common.errorOccurred", { message: formatRpcError(result.error, t) }));
      return;
    }

    setIsModalOpen(false);
    setFormData({ code: "", name: "", type: "Kassa", balance: "0.00" });
    void fetchData();
  };

  const openEditAccount = (account: AccountLedgerBalance) => {
    setEditingAccount(account);
    setFormData({
      code: account.code,
      name: account.name,
      type: account.type,
      balance: account.ledger_balance.toFixed(2),
    });
    setIsModalOpen(true);
  };

  const openCreateAccount = () => {
    setEditingAccount(null);
    setFormData({ code: "", name: "", type: "Kassa", balance: "0.00" });
    setIsModalOpen(true);
  };

  const handleDeleteAccount = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteAccountAction(deleteTarget.account_id);
    setDeleting(false);
    if (!result.success) {
      showError(t("common.errorOccurred", { message: formatRpcError(result.error, t) }));
      return;
    }
    setDeleteTarget(null);
    showSuccess(t("cashBank.deleteSuccess"));
    void fetchData();
  };

  const totalCashBalance = accounts
    .filter((a) => a.type === "Kassa")
    .reduce((sum, a) => sum + a.ledger_balance, 0);

  const totalBankBalance = accounts
    .filter((a) => a.type === "Bank")
    .reduce((sum, a) => sum + a.ledger_balance, 0);

  return (
    <PageLayout>
      <header className="flex items-center justify-between border-b border-app app-glass px-6 py-4">
        <div>
          <h2 className="text-xl font-bold text-app">{t("cashBank.pageTitle")}</h2>
          <p className="text-sm text-app-muted">{t("cashBank.pageDescription")}</p>
        </div>
        <button
          onClick={openCreateAccount}
          disabled={!canManageFinance}
          className="btn-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          <span>{t("cashBank.createButton")}</span>
        </button>
      </header>

      <main className="app-page-content flex-1 space-y-4 overflow-y-auto">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="app-card app-card-elevated p-5">
            <span className="text-xs font-semibold uppercase text-app-muted">
              {t("cashBank.totalCash")}
            </span>
            <div className="mt-1 text-2xl font-bold text-emerald-600">
              {totalCashBalance.toFixed(2)} AZN
            </div>
          </div>
          <div className="app-card app-card-elevated p-5">
            <span className="text-xs font-semibold uppercase text-app-muted">
              {t("cashBank.totalBank")}
            </span>
            <div className="mt-1 text-2xl font-bold text-app-accent">
              {totalBankBalance.toFixed(2)} AZN
            </div>
          </div>
          <div className="app-card app-card-elevated p-5">
            <span className="text-xs font-semibold uppercase text-app-muted">
              {t("cashBank.totalFinance")}
            </span>
            <div className="mt-1 text-2xl font-bold text-app">
              {(totalCashBalance + totalBankBalance).toFixed(2)} AZN
            </div>
          </div>
        </div>

        <div className="app-table-wrap">
          <div className="flex items-center justify-between border-b border-app bg-app-card-hover p-4">
            <h3 className="font-bold text-app">{t("cashBank.listTitle")}</h3>
            <button
              onClick={() => void fetchData()}
              className="rounded-lg p-1.5 text-app-muted hover:bg-app-card-hover"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-app-muted">{t("common.loading")}</div>
          ) : accounts.length === 0 ? (
            <div className="p-8 text-center text-sm text-app-muted">{t("cashBank.emptyAccounts")}</div>
          ) : (
            <table className="app-table">
              <thead className="border-b border-app bg-app-card-hover text-xs uppercase text-app-muted">
                <tr>
                  <th className="px-6 py-3">{t("common.code")}</th>
                  <th className="px-6 py-3">{t("cashBank.accountName")}</th>
                  <th className="px-6 py-3">{t("common.type")}</th>
                  <th className="px-6 py-3 text-right">{t("cashBank.currentBalance")}</th>
                  <th className="px-6 py-3 text-right">{t("cashBank.ledgerIncome")}</th>
                  <th className="px-6 py-3 text-right">{t("cashBank.ledgerExpense")}</th>
                  {canManageFinance ? <th className="px-6 py-3">{t("common.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.account_id} className="hover:bg-app-card-hover">
                    <td className="px-6 py-4 font-mono text-xs font-bold text-app">{a.code}</td>
                    <td className="px-6 py-4 font-semibold text-app">{a.name}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          a.type === "Kassa"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {a.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-app">
                      {a.ledger_balance.toFixed(2)} AZN
                    </td>
                    <td className="px-6 py-4 text-right text-emerald-600">
                      +{a.income_total.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right text-rose-600">
                      -{a.expense_total.toFixed(2)}
                    </td>
                    {canManageFinance ? (
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditAccount(a)}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {t("common.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(a)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("common.delete")}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {isModalOpen && (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex items-center justify-between">
              <h3 className="font-bold text-app">
                {editingAccount ? t("cashBank.editModalTitle") : t("cashBank.addModalTitle")}
              </h3>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingAccount(null);
                }}
                className="text-app-muted hover:text-app-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-app">
                  {t("cashBank.accountCode")}
                </label>
                <input
                  type="text"
                  placeholder={t("cashBank.accountCodePlaceholder")}
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-app">
                  {t("cashBank.accountNameRequired")}
                </label>
                <input
                  type="text"
                  required
                  placeholder={t("cashBank.accountNamePlaceholder")}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-app">
                  {t("cashBank.typeRequired")}
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="app-input w-full text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                >
                  <option value="Kassa">{t("cashBank.typeCash")}</option>
                  <option value="Bank">{t("cashBank.typeBank")}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-app">
                  {t("cashBank.initialBalance")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.balance}
                  onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
                  disabled={Boolean(editingAccount)}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)] disabled:bg-app-card-hover disabled:text-app-muted"
                />
                {editingAccount ? (
                  <p className="mt-1 text-[11px] text-app-muted">{t("cashBank.balanceEditHint")}</p>
                ) : null}
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!canManageFinance}
                  className="rounded-lg bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
                >
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        itemName={deleteTarget?.name}
        loading={deleting}
        onConfirm={() => void handleDeleteAccount()}
        onCancel={() => setDeleteTarget(null)}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
