"use client";

import PageLayout from "@/components/layout/PageLayout";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createExpenseAction,
  fetchAccountLedgerBalancesAction,
  fetchFinancialCategoriesAction,
  fetchUnifiedLedgerAction,
} from "@/lib/actions/finance";
import { formatReferenceTypeLabel } from "@/lib/finance/unifiedLedger";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import UnifiedLedgerRowActions from "@/components/finance/UnifiedLedgerRowActions";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { Plus, RefreshCw, X } from "lucide-react";
import type { UnifiedLedgerTransaction } from "@/lib/finance/unifiedLedger";

interface AccountOption {
  id: string;
  name: string;
  ledger_balance: number;
}

export default function ExpensesPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [totalExpense, setTotalExpense] = useState(0);
  const [expenseRows, setExpenseRows] = useState<UnifiedLedgerTransaction[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);

  const [formData, setFormData] = useState({
    category: "",
    amount: "0.00",
    account_id: "",
    notes: "",
  });
  const { can } = useAuth();
  const canManageExpenses = can("can_manage_expenses");
  const canManageFinance = can("can_manage_finance");
  const canManage = canManageExpenses || canManageFinance;
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const fetchExpensesAndAccounts = useCallback(async () => {
    setLoading(true);
    const [ledgerRes, accountsRes, categoriesRes] = await Promise.all([
      fetchUnifiedLedgerAction({ type: "EXPENSE" }),
      fetchAccountLedgerBalancesAction(),
      fetchFinancialCategoriesAction(),
    ]);

    if (ledgerRes.success && ledgerRes.data) {
      setTotalExpense(ledgerRes.data.summary.totalExpense);
      setExpenseRows(ledgerRes.data.transactions);
    } else {
      showError(ledgerRes.error || t("common.error"));
      setExpenseRows([]);
      setTotalExpense(0);
    }

    if (accountsRes.success && accountsRes.data) {
      setAccounts(
        accountsRes.data.accounts.map((a) => ({
          id: a.account_id,
          name: a.name,
          ledger_balance: a.ledger_balance,
        }))
      );
    }

    if (categoriesRes.success && categoriesRes.data?.length) {
      const expenseCats = categoriesRes.data.filter((c) => c.type === "EXPENSE");
      setCategories(expenseCats.map((c) => ({ id: c.id, name: c.name })));
      setFormData((prev) => ({
        ...prev,
        category: prev.category || expenseCats[0]?.name || "",
      }));
    }

    setLoading(false);
  }, [showError, t]);

  useEffect(() => {
    void fetchExpensesAndAccounts();
  }, [fetchExpensesAndAccounts]);

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageExpenses) {
      showError(t("expenses.noPermission"));
      return;
    }
    if (!formData.account_id) {
      showError(t("expenses.selectAccountAlert"));
      return;
    }

    const numericAmount = parseFloat(formData.amount) || 0;
    if (numericAmount <= 0) {
      showError(t("expenses.invalidAmount"));
      return;
    }

    const result = await createExpenseAction({
      category: formData.category,
      amount: numericAmount,
      accountId: formData.account_id,
      notes: formData.notes,
    });

    if (!result.success) {
      showError(t("common.error") + ": " + formatRpcError(result.error, t));
      return;
    }

    showSuccess(t("expenses.successRecorded"));
    setIsModalOpen(false);
    setFormData({
      category: categories[0]?.name || "",
      amount: "0.00",
      account_id: "",
      notes: "",
    });
    void fetchExpensesAndAccounts();
  };

  return (
    <PageLayout>
      <header className="flex items-center justify-between border-b border-app app-glass px-6 py-4">
        <div>
          <h2 className="text-xl font-bold text-app">{t("expenses.pageTitle")}</h2>
          <p className="text-sm text-app-muted">{t("expenses.pageDescription")}</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          disabled={!canManageExpenses}
          className="flex items-center space-x-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          <span>{t("expenses.createButton")}</span>
        </button>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto p-6">
        <div className="app-card app-card-elevated flex items-center justify-between p-5">
          <div>
            <span className="text-xs font-semibold uppercase text-app-muted">
              {t("expenses.totalRecorded")}
            </span>
            <div className="mt-1 text-2xl font-bold text-rose-600">{totalExpense.toFixed(2)} AZN</div>
          </div>
          <button
            onClick={() => void fetchExpensesAndAccounts()}
            className="rounded-lg border p-2 hover:bg-app-card-hover"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="app-table-wrap">
          {loading ? (
            <div className="p-8 text-center text-sm text-app-muted">{t("common.loading")}</div>
          ) : expenseRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-app-muted">{t("expenses.emptyRecords")}</div>
          ) : (
            <table className="app-table">
              <thead className="border-b border-app bg-app-card-hover text-xs uppercase text-app-muted">
                <tr>
                  <th className="px-6 py-3">{t("common.category")}</th>
                  <th className="px-6 py-3">{t("expenses.paidAccount")}</th>
                  <th className="px-6 py-3">{t("expenses.noteDescription")}</th>
                  <th className="px-6 py-3">{t("finance.columnSource")}</th>
                  <th className="px-6 py-3 text-right">{t("common.amount")}</th>
                  <th className="px-6 py-3 text-right">{t("common.date")}</th>
                  <th className="px-6 py-3 text-right">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {expenseRows.map((e) => (
                  <tr key={e.id} className="hover:bg-app-card-hover">
                    <td className="px-6 py-4 font-semibold text-app">{e.category}</td>
                    <td className="px-6 py-4 text-app-muted">{e.account_name || "—"}</td>
                    <td className="px-6 py-4 text-app-muted">{e.description || e.notes || "—"}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex rounded-full bg-app-card-hover px-2 py-0.5 text-[10px] font-semibold text-app-muted">
                        {formatReferenceTypeLabel(e.reference_type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-rose-600">
                      -{e.amount.toFixed(2)} AZN
                    </td>
                    <td className="px-6 py-4 text-right text-xs text-app-muted">
                      {new Date(e.transaction_date || e.created_at).toLocaleDateString("az-AZ")}
                    </td>
                    <td className="px-6 py-4">
                      <UnifiedLedgerRowActions
                        transaction={e}
                        canManage={canManage}
                        onChanged={() => void fetchExpensesAndAccounts()}
                        onError={showError}
                        onSuccess={showSuccess}
                      />
                    </td>
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
            <div className="app-modal-header flex items-center justify-between bg-app-card-hover">
              <h3 className="font-bold text-app">{t("expenses.addModalTitle")}</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-app-muted hover:text-app-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitExpense} className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-xs font-semibold text-app">
                  {t("expenses.categoryRequired")}
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="app-input text-sm focus:ring-rose-500/40"
                >
                  {categories.length === 0 ? (
                    <>
                      <option value="İcarə">{t("expenses.categories.rent")}</option>
                      <option value="Elektrik">{t("expenses.categories.utilities")}</option>
                      <option value="Yanacaq">{t("expenses.categories.fuel")}</option>
                      <option value="İnternet">{t("expenses.categories.internet")}</option>
                      <option value="Reklam">{t("expenses.categories.marketing")}</option>
                      <option value="Təmir">{t("expenses.categories.repair")}</option>
                      <option value="Maaş">{t("expenses.categories.salary")}</option>
                      <option value="Digər">{t("expenses.categories.other")}</option>
                    </>
                  ) : (
                    categories.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-app">
                  {t("expenses.paymentAccountRequired")}
                </label>
                <select
                  required
                  value={formData.account_id}
                  onChange={(e) => setFormData({ ...formData, account_id: e.target.value })}
                  className="app-input text-sm focus:ring-rose-500/40"
                >
                  <option value="">{t("expenses.selectAccount")}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {t("expenses.accountBalance", {
                        name: a.name,
                        balance: a.ledger_balance.toFixed(2),
                      })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-app">
                  {t("expenses.amountRequired")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm font-bold text-rose-600 focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-app">
                  {t("expenses.noteDescription")}
                </label>
                <textarea
                  rows={2}
                  placeholder={t("expenses.notesPlaceholder")}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500"
                />
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
                  disabled={!canManageExpenses}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {t("expenses.confirmExpense")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
