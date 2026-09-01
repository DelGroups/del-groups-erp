"use client";
import PageLayout from "@/components/layout/PageLayout";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { createAccountAction } from "@/lib/actions/finance";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import {
  RefreshCw,
  Plus,
  X,
  Wallet,
} from "lucide-react";

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  category: string;
  notes: string;
  created_at: string;
  accounts: { name: string } | null;
}

export default function CashBankPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    type: "Kassa",
    balance: "0.00",
  });
  const { can } = useAuth();
  const canManageFinance = can("can_manage_finance");
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: accData } = await supabase.from("accounts").select("*").order("created_at", { ascending: true });
    const { data: txData } = await supabase
      .from("transactions")
      .select("*, accounts(name)")
      .order("created_at", { ascending: false })
      .limit(20);

    setAccounts((accData || []) as unknown as Account[]);
    setTransactions((txData || []) as unknown as Transaction[]);
    setLoading(false);
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageFinance) {
      showError(t("cashBank.noPermission"));
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
    fetchData();
  };

  const totalCashBalance = accounts
    .filter((a) => a.type === "Kassa")
    .reduce((sum, a) => sum + a.balance, 0);

  const totalBankBalance = accounts
    .filter((a) => a.type === "Bank")
    .reduce((sum, a) => sum + a.balance, 0);

  return (
    <PageLayout>
        <header className="flex items-center justify-between border-b border-app app-glass px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-app">{t("cashBank.pageTitle")}</h2>
            <p className="text-sm text-app-muted">{t("cashBank.pageDescription")}</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={!canManageFinance}
            className="btn-primary disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{t("cashBank.createButton")}</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="app-card app-card-elevated p-5">
              <span className="text-xs font-semibold text-app-muted uppercase">{t("cashBank.totalCash")}</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{totalCashBalance.toFixed(2)} AZN</div>
            </div>
            <div className="app-card app-card-elevated p-5">
              <span className="text-xs font-semibold text-app-muted uppercase">{t("cashBank.totalBank")}</span>
              <div className="text-2xl font-bold text-app-accent mt-1">{totalBankBalance.toFixed(2)} AZN</div>
            </div>
            <div className="app-card app-card-elevated p-5">
              <span className="text-xs font-semibold text-app-muted uppercase">{t("cashBank.totalFinance")}</span>
              <div className="text-2xl font-bold text-app mt-1">{(totalCashBalance + totalBankBalance).toFixed(2)} AZN</div>
            </div>
          </div>

          <div className="app-table-wrap">
            <div className="p-4 border-b border-app flex justify-between items-center bg-app-card-hover">
              <h3 className="font-bold text-app">{t("cashBank.listTitle")}</h3>
              <button onClick={fetchData} className="p-1.5 hover:bg-app-card-hover rounded-lg text-app-muted">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {loading ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("common.loading")}</div>
            ) : accounts.length === 0 ? (
              <div className="p-8 text-center text-app-muted text-sm">{t("cashBank.emptyAccounts")}</div>
            ) : (
              <table className="app-table">
                <thead className="bg-app-card-hover text-xs text-app-muted uppercase border-b border-app">
                  <tr>
                    <th className="px-6 py-3">{t("common.code")}</th>
                    <th className="px-6 py-3">{t("cashBank.accountName")}</th>
                    <th className="px-6 py-3">{t("common.type")}</th>
                    <th className="px-6 py-3 text-right">{t("cashBank.currentBalance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="hover:bg-app-card-hover">
                      <td className="px-6 py-4 font-mono text-xs font-bold text-app">{a.code}</td>
                      <td className="px-6 py-4 font-semibold text-app">{a.name}</td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                          a.type === "Kassa" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                        }`}>
                          {a.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-app">{a.balance.toFixed(2)} AZN</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>

      {/* Modal Add Account */}
      {isModalOpen && (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex justify-between items-center">
              <h3 className="font-bold text-app">{t("cashBank.addModalTitle")}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-app-muted hover:text-app-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("cashBank.accountCode")}</label>
                <input
                  type="text"
                  placeholder={t("cashBank.accountCodePlaceholder")}
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("cashBank.accountNameRequired")}</label>
                <input
                  type="text"
                  required
                  placeholder={t("cashBank.accountNamePlaceholder")}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-app mb-1">{t("cashBank.typeRequired")}</label>
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
                <label className="block text-xs font-medium text-app mb-1">{t("cashBank.initialBalance")}</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.balance}
                  onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[color:var(--app-accent-ring)]"
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
                  disabled={!canManageFinance}
                  className="px-4 py-2 bg-[image:var(--app-gradient)] text-white rounded-lg text-xs font-semibold hover:brightness-110 disabled:opacity-50"
                >
                  {t("common.save")}
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
