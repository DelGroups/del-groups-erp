"use client";
import PageLayout from "@/components/layout/PageLayout";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { createExpenseAction } from "@/lib/actions/finance";
import {
  RefreshCw,
  Plus,
  X,
} from "lucide-react";

interface Account {
  id: string;
  name: string;
  balance: number;
}

interface Expense {
  id: string;
  code: string;
  category: string;
  amount: number;
  notes: string;
  created_at: string;
  accounts: { name: string } | null;
}

export default function ExpensesPage() {
  const { t } = useI18n();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    category: "İcarə",
    amount: "0.00",
    account_id: "",
    notes: "",
  });
  const { can } = useAuth();
  const canManageExpenses = can("can_manage_expenses");

  useEffect(() => {
    fetchExpensesAndAccounts();
  }, []);

  const fetchExpensesAndAccounts = async () => {
    setLoading(true);
    const { data: expData } = await supabase
      .from("expenses")
      .select("*, accounts(name)")
      .order("created_at", { ascending: false });

    const { data: accData } = await supabase.from("accounts").select("*");

    setExpenses((expData || []) as Expense[]);
    setAccounts((accData || []) as unknown as Account[]);
    setLoading(false);
  };

  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageExpenses) {
      alert(t("expenses.noPermission"));
      return;
    }
    if (!formData.account_id) {
      alert(t("expenses.selectAccountAlert"));
      return;
    }

    const numericAmount = parseFloat(formData.amount) || 0;
    if (numericAmount <= 0) {
      alert(t("expenses.invalidAmount"));
      return;
    }

    const result = await createExpenseAction({
      category: formData.category,
      amount: numericAmount,
      accountId: formData.account_id,
      notes: formData.notes,
    });

    if (!result.success) {
      alert(t("common.error") + ": " + result.error);
      return;
    }

    alert(t("expenses.successRecorded"));
    setIsModalOpen(false);
    setFormData({ category: "İcarə", amount: "0.00", account_id: "", notes: "" });
    fetchExpensesAndAccounts();
  };

  const totalExpenseSum = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <PageLayout>
        <header className="flex items-center justify-between border-b border-app bg-app-surface px-6 py-4 backdrop-blur-md">
          <div>
            <h2 className="text-xl font-bold text-app">{t("expenses.pageTitle")}</h2>
            <p className="text-sm text-app-muted">{t("expenses.pageDescription")}</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={!canManageExpenses}
            className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center space-x-2 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{t("expenses.createButton")}</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="app-card app-card-elevated p-5 flex justify-between items-center">
            <div>
              <span className="text-xs font-semibold text-app-muted uppercase">{t("expenses.totalRecorded")}</span>
              <div className="text-2xl font-bold text-rose-600 mt-1">{totalExpenseSum.toFixed(2)} AZN</div>
            </div>
            <button onClick={fetchExpensesAndAccounts} className="p-2 border rounded-lg hover:bg-app-card-hover">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="app-table-wrap">
            {loading ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("common.loading")}</div>
            ) : expenses.length === 0 ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("expenses.emptyRecords")}</div>
            ) : (
              <table className="app-table">
                <thead className="bg-app-card-hover text-xs text-app-muted uppercase border-b border-app">
                  <tr>
                    <th className="px-6 py-3">{t("common.code")}</th>
                    <th className="px-6 py-3">{t("common.category")}</th>
                    <th className="px-6 py-3">{t("expenses.paidAccount")}</th>
                    <th className="px-6 py-3">{t("expenses.noteDescription")}</th>
                    <th className="px-6 py-3 text-right">{t("common.amount")}</th>
                    <th className="px-6 py-3 text-right">{t("common.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-app-card-hover">
                      <td className="px-6 py-4 font-mono text-xs font-bold text-app">{e.code}</td>
                      <td className="px-6 py-4 font-semibold text-app">{e.category}</td>
                      <td className="px-6 py-4 text-app-muted">{e.accounts?.name || "-"}</td>
                      <td className="px-6 py-4 text-app-muted">{e.notes || "-"}</td>
                      <td className="px-6 py-4 text-right font-bold text-rose-600">-{e.amount.toFixed(2)} AZN</td>
                      <td className="px-6 py-4 text-right text-xs text-app-muted">
                        {new Date(e.created_at).toLocaleDateString("az-AZ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>

      {/* Modal Add Expense */}
      {isModalOpen && (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex justify-between items-center bg-app-card-hover">
              <h3 className="font-bold text-app">{t("expenses.addModalTitle")}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-app-muted hover:text-app-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitExpense} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-app mb-1">{t("expenses.categoryRequired")}</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="app-input text-sm focus:ring-rose-500/40"
                >
                  <option value="İcarə">{t("expenses.categories.rent")}</option>
                  <option value="Elektrik">{t("expenses.categories.utilities")}</option>
                  <option value="Yanacaq">{t("expenses.categories.fuel")}</option>
                  <option value="İnternet">{t("expenses.categories.internet")}</option>
                  <option value="Reklam">{t("expenses.categories.marketing")}</option>
                  <option value="Təmir">{t("expenses.categories.repair")}</option>
                  <option value="Maaş">{t("expenses.categories.salary")}</option>
                  <option value="Digər">{t("expenses.categories.other")}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-app mb-1">{t("expenses.paymentAccountRequired")}</label>
                <select
                  required
                  value={formData.account_id}
                  onChange={(e) => setFormData({ ...formData, account_id: e.target.value })}
                  className="app-input text-sm focus:ring-rose-500/40"
                >
                  <option value="">{t("expenses.selectAccount")}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {t("expenses.accountBalance", { name: a.name, balance: a.balance.toFixed(2) })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-app mb-1">{t("expenses.amountRequired")}</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-rose-500 font-bold text-rose-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-app mb-1">{t("expenses.noteDescription")}</label>
                <textarea
                  rows={2}
                  placeholder={t("expenses.notesPlaceholder")}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-xs font-semibold text-app"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!canManageExpenses}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  {t("expenses.confirmExpense")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
