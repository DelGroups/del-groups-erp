"use client";

import React, { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import UnifiedLedgerRowActions from "@/components/finance/UnifiedLedgerRowActions";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { fetchUnifiedLedgerAction } from "@/lib/actions/finance";
import { formatReferenceTypeLabel, type UnifiedLedgerTransaction } from "@/lib/finance/unifiedLedger";
import { ArrowDownRight, ArrowUpRight, CircleDollarSign } from "lucide-react";

function formatTypeLabel(type: string, t: (key: string) => string): string {
  if (type === "INCOME") return t("finance.typeIncome");
  if (type === "EXPENSE") return t("finance.typeExpense");
  if (type === "TRANSFER") return t("finance.typeTransfer");
  return type;
}

export default function FinancePage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManageFinance = can("can_manage_finance");
  const canManageExpenses = can("can_manage_expenses");
  const canManage = canManageFinance || canManageExpenses;
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [transactions, setTransactions] = useState<UnifiedLedgerTransaction[]>([]);
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, netBalance: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchUnifiedLedgerAction();
    if (!result.success || !result.data) {
      showError(result.error || t("common.error"));
      setTransactions([]);
      setSummary({ totalIncome: 0, totalExpense: 0, netBalance: 0 });
    } else {
      setTransactions(result.data.transactions);
      setSummary(result.data.summary);
    }
    setLoading(false);
  }, [showError, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = transactions.filter((tx) => {
    const haystack = [
      tx.category,
      tx.description,
      tx.notes,
      tx.reference_type,
      tx.account_name,
      tx.type,
      tx.legacy_type,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<CircleDollarSign className="h-6 w-6 text-amber-500" />}
        title={t("finance.title")}
        description={t("finance.pageDescription")}
        createLabel={t("common.refresh")}
        onCreate={() => void loadData()}
      />

      <main className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="app-card app-card-elevated p-4">
            <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.totalIncome")}</p>
            <p className="mt-1 font-mono text-xl font-bold text-emerald-600">
              {summary.totalIncome.toFixed(2)} AZN
            </p>
          </div>
          <div className="app-card app-card-elevated p-4">
            <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.totalExpense")}</p>
            <p className="mt-1 font-mono text-xl font-bold text-rose-600">
              {summary.totalExpense.toFixed(2)} AZN
            </p>
          </div>
          <div className="app-card app-card-elevated p-4">
            <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.netBalance")}</p>
            <p className="mt-1 font-mono text-xl font-bold text-app">
              {summary.netBalance.toFixed(2)} AZN
            </p>
          </div>
        </div>

        <DocumentListSearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={t("finance.searchPlaceholder")}
          onRefresh={() => void loadData()}
          loading={loading}
        />

        <div className="app-table-wrap">
          {loading ? (
            <div className="p-12 text-center text-xs text-app-muted">{t("finance.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-xs text-app-muted">{t("finance.empty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                  <tr>
                    <th className="px-4 py-3">{t("finance.columnDate")}</th>
                    <th className="px-4 py-3">{t("finance.columnType")}</th>
                    <th className="px-4 py-3">{t("finance.columnCategory")}</th>
                    <th className="px-4 py-3 text-right">{t("finance.columnAmount")}</th>
                    <th className="px-4 py-3">{t("finance.columnAccount")}</th>
                    <th className="px-4 py-3">{t("finance.columnDescription")}</th>
                    <th className="px-4 py-3">{t("finance.columnSource")}</th>
                    <th className="px-4 py-3 text-right">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-app">
                  {filtered.map((tx) => {
                    const isIncome = tx.type === "INCOME";
                    const isTransfer = tx.type === "TRANSFER";
                    return (
                      <tr key={tx.id} className="transition-colors hover:bg-app-card-hover">
                        <td className="px-4 py-3">
                          {(tx.transaction_date || tx.created_at).slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                              isIncome
                                ? "bg-[color:var(--app-success-soft)] text-[color:var(--app-success-text)]"
                                : isTransfer
                                  ? "bg-sky-500/10 text-sky-400"
                                  : "bg-rose-500/10 text-rose-400"
                            }`}
                          >
                            {isIncome ? (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDownRight className="h-3.5 w-3.5" />
                            )}
                            {formatTypeLabel(tx.type, t)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold">{tx.category || "—"}</td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-bold ${
                            isIncome ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {isIncome ? "+" : "-"}
                          {tx.amount.toFixed(2)} AZN
                        </td>
                        <td className="px-4 py-3">{tx.account_name || "—"}</td>
                        <td className="max-w-xs truncate px-4 py-3 text-app-muted">
                          {tx.description || tx.notes || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-app-card-hover px-2 py-0.5 text-[10px] font-semibold text-app-muted">
                            {formatReferenceTypeLabel(tx.reference_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <UnifiedLedgerRowActions
                            transaction={tx}
                            canManage={canManage}
                            onChanged={() => void loadData()}
                            onError={showError}
                            onSuccess={showSuccess}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
