"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PageHeader from "@/components/ui/page-header";
import { Landmark, Plus, Save, Users, Truck } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { cn } from "@/lib/cn";
import {
  createInitialAccountAction,
  fetchSetupAccountsAction,
  saveInitialBalancesAction,
  type AccountSetupRow,
} from "@/lib/actions/initialSetup";
import {
  fetchCustomerOpeningBalancesAction,
  setCustomerOpeningBalanceAction,
  type CustomerOpeningBalanceRow,
} from "@/lib/actions/customerAr";
import {
  fetchSupplierOpeningBalancesAction,
  setSupplierOpeningBalanceAction,
  type SupplierOpeningBalanceRow,
} from "@/lib/actions/supplierAp";

type TabId = "cash-bank" | "customers" | "suppliers";

function PartnerBalanceTable<T extends { id: string; code: string; name: string; balance: number; opening_balance: number }>({
  rows,
  loading,
  onSave,
}: {
  rows: T[];
  loading: boolean;
  onSave: (id: string, value: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    rows.forEach((row) => {
      next[row.id] = String(row.opening_balance);
    });
    setDrafts(next);
  }, [rows]);

  if (loading) {
    return <p className="p-4 text-xs text-app-muted">{t("common.loading")}</p>;
  }

  return (
    <div className="app-table-wrap">
      <table className="app-table text-xs">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left">{t("initialSetup.importHeaders.sku")}</th>
            <th className="px-3 py-2 text-left">{t("forms.productName")}</th>
            <th className="px-3 py-2 text-right">{t("finance.openingBalances.currentBalance")}</th>
            <th className="px-3 py-2 text-right">{t("finance.openingBalances.openingBalanceCol")}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = drafts[row.id] ?? String(row.opening_balance);
            const dirty = Number(draft) !== row.opening_balance;
            return (
              <tr key={row.id} className="border-t border-app">
                <td className="px-3 py-2 font-mono">{row.code || "—"}</td>
                <td className="px-3 py-2 font-medium text-app">{row.name}</td>
                <td className="px-3 py-2 text-right font-mono text-app-muted">
                  {row.balance.toFixed(2)} AZN
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft}
                    onChange={(event) =>
                      setDrafts((prev) => ({ ...prev, [row.id]: event.target.value }))
                    }
                    className="app-input w-32 text-right text-xs"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    disabled={!dirty || savingId === row.id}
                    onClick={async () => {
                      setSavingId(row.id);
                      await onSave(row.id, Number(draft) || 0);
                      setSavingId(null);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold",
                      dirty
                        ? "border-app-accent text-app-accent hover:bg-app-accent/10"
                        : "border-app text-app-muted opacity-50"
                    )}
                  >
                    <Save className="h-3 w-3" />
                    {savingId === row.id ? t("common.saving") : t("common.save")}
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-app-muted">
                {t("products.empty")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function FinanceOpeningBalancesPageClient() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_settings");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [tab, setTab] = useState<TabId>("cash-bank");

  const [accounts, setAccounts] = useState<AccountSetupRow[]>([]);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [savingBalances, setSavingBalances] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: "", type: "Kassa" as "Kassa" | "Bank", balance: "0" });
  const [creatingAccount, setCreatingAccount] = useState(false);

  const [customers, setCustomers] = useState<CustomerOpeningBalanceRow[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  const [suppliers, setSuppliers] = useState<SupplierOpeningBalanceRow[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);

  const totalCashBankBalance = useMemo(
    () =>
      accounts.reduce((sum, acc) => sum + (Number(balances[acc.id] ?? acc.balance) || 0), 0),
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

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    const result = await fetchCustomerOpeningBalancesAction();
    setCustomers(result.success ? result.data || [] : []);
    setLoadingCustomers(false);
  }, []);

  const loadSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    const result = await fetchSupplierOpeningBalancesAction();
    setSuppliers(result.success ? result.data || [] : []);
    setLoadingSuppliers(false);
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadCustomers();
    void loadSuppliers();
  }, [loadAccounts, loadCustomers, loadSuppliers]);

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
      showError(formatRpcError(result.error, t) || t("common.error"));
      return;
    }
    showSuccess(t("initialSetup.balancesSaved", { count: result.data?.updated ?? 0 }));
    void loadAccounts();
  };

  const handleCreateAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setCreatingAccount(true);
    const result = await createInitialAccountAction({
      name: newAccount.name,
      type: newAccount.type,
      balance: Number(newAccount.balance) || 0,
    });
    setCreatingAccount(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t) || t("common.error"));
      return;
    }
    setNewAccount({ name: "", type: "Kassa", balance: "0" });
    void loadAccounts();
  };

  const handleSaveCustomer = async (id: string, value: number) => {
    const result = await setCustomerOpeningBalanceAction(id, value);
    if (!result.success) {
      showError(formatRpcError(result.error, t) || t("common.error"));
      return;
    }
    showSuccess(t("finance.openingBalances.saved"));
    void loadCustomers();
  };

  const handleSaveSupplier = async (id: string, value: number) => {
    const result = await setSupplierOpeningBalanceAction(id, value);
    if (!result.success) {
      showError(formatRpcError(result.error, t) || t("common.error"));
      return;
    }
    showSuccess(t("finance.openingBalances.saved"));
    void loadSuppliers();
  };

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "cash-bank", label: t("finance.openingBalances.tabCashBank"), icon: <Landmark className="h-4 w-4" /> },
    { id: "customers", label: t("finance.openingBalances.tabCustomers"), icon: <Users className="h-4 w-4" /> },
    { id: "suppliers", label: t("finance.openingBalances.tabSuppliers"), icon: <Truck className="h-4 w-4" /> },
  ];

  return (
    <PageLayout>
      <PageHeader title={t("finance.openingBalances.title")} subtitle={t("finance.openingBalances.description")} />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold",
              tab === tabItem.id
                ? "border-app-accent bg-app-accent/10 text-app-accent"
                : "border-app text-app-muted hover:bg-app-card-hover"
            )}
          >
            {tabItem.icon}
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === "cash-bank" ? (
        <section className="app-card app-card-elevated p-6">
          <p className="mb-4 text-xs text-app-muted">{t("initialSetup.cashBankDesc")}</p>

          {loadingAccounts ? (
            <p className="text-xs text-app-muted">{t("common.loading")}</p>
          ) : accounts.length === 0 ? (
            <p className="mb-4 text-xs text-amber-500">{t("initialSetup.noAccounts")}</p>
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
                      onChange={(event) =>
                        setBalances((prev) => ({ ...prev, [acc.id]: event.target.value }))
                      }
                      className="app-input w-36 text-right text-sm"
                    />
                    <span className="text-xs text-app-muted">AZN</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-xl border border-app-accent/20 bg-app-accent/5 px-4 py-3">
                <span className="text-xs font-semibold text-app-accent">
                  {t("initialSetup.totalOpeningBalance")}
                </span>
                <span className="font-mono text-sm font-bold text-app-accent">
                  {totalCashBankBalance.toFixed(2)} AZN
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
            onSubmit={(event) => void handleCreateAccount(event)}
            className="mt-6 grid gap-3 border-t border-app pt-6 md:grid-cols-4"
          >
            <input
              required
              disabled={!canManage}
              placeholder={t("initialSetup.accountNamePlaceholder")}
              value={newAccount.name}
              onChange={(event) => setNewAccount((prev) => ({ ...prev, name: event.target.value }))}
              className="app-input text-xs md:col-span-2"
            />
            <select
              disabled={!canManage}
              value={newAccount.type}
              onChange={(event) =>
                setNewAccount((prev) => ({ ...prev, type: event.target.value as "Kassa" | "Bank" }))
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
                onChange={(event) => setNewAccount((prev) => ({ ...prev, balance: event.target.value }))}
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
      ) : null}

      {tab === "customers" ? (
        <section className="app-card app-card-elevated p-6">
          <p className="mb-4 text-xs text-app-muted">{t("finance.openingBalances.customersDesc")}</p>
          <PartnerBalanceTable rows={customers} loading={loadingCustomers} onSave={handleSaveCustomer} />
        </section>
      ) : null}

      {tab === "suppliers" ? (
        <section className="app-card app-card-elevated p-6">
          <p className="mb-4 text-xs text-app-muted">{t("finance.openingBalances.suppliersDesc")}</p>
          <PartnerBalanceTable rows={suppliers} loading={loadingSuppliers} onSave={handleSaveSupplier} />
        </section>
      ) : null}

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
