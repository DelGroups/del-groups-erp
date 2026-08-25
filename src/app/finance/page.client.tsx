"use client";

import React, { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowDownRight, ArrowUpRight, CircleDollarSign } from "lucide-react";

interface FinanceTransaction {
  id: string;
  type: string;
  amount: number;
  category: string;
  notes: string | null;
  created_at: string;
  accounts: { name: string } | null;
}

export default function FinancePage() {
  const { t } = useI18n();
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("transactions")
      .select("id, type, amount, category, notes, created_at, accounts(name)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Transactions fetch error:", error.message);
      setTransactions([]);
    } else {
      setTransactions((data as FinanceTransaction[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = transactions.filter(
    (tx) =>
      (tx.category || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.notes || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.accounts?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.type || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalIn = filtered
    .filter((tx) => tx.type === "Mədaxil")
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const totalOut = filtered
    .filter((tx) => tx.type === "Məxaric")
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

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
              <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.income")}</p>
              <p className="mt-1 font-mono text-xl font-bold text-emerald-600">
                {totalIn.toFixed(2)} AZN
              </p>
            </div>
            <div className="app-card app-card-elevated p-4">
              <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.expense")}</p>
              <p className="mt-1 font-mono text-xl font-bold text-rose-600">
                {totalOut.toFixed(2)} AZN
              </p>
            </div>
            <div className="app-card app-card-elevated p-4">
              <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.netFlow")}</p>
              <p className="mt-1 font-mono text-xl font-bold text-app">
                {(totalIn - totalOut).toFixed(2)} AZN
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
              <div className="p-12 text-center text-xs text-app-muted">
                {t("finance.empty")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                    <tr>
                      <th className="px-4 py-3">{t("common.date")}</th>
                      <th className="px-4 py-3">{t("common.type")}</th>
                      <th className="px-4 py-3">{t("common.category")}</th>
                      <th className="px-4 py-3">{t("common.account")}</th>
                      <th className="px-4 py-3">{t("finance.note")}</th>
                      <th className="px-4 py-3 text-right">{t("common.amount")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filtered.map((tx) => {
                      const isIncome = tx.type === "Mədaxil";
                      return (
                        <tr key={tx.id} className="transition-colors hover:bg-app-card-hover">
                          <td className="px-4 py-3">
                            {tx.created_at?.slice(0, 16).replace("T", " ") || "-"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                                isIncome
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {isIncome ? (
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDownRight className="h-3.5 w-3.5" />
                              )}
                              {tx.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold">{tx.category || "-"}</td>
                          <td className="px-4 py-3">{tx.accounts?.name || "-"}</td>
                          <td className="max-w-xs truncate px-4 py-3 text-app-muted">
                            {tx.notes || "-"}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono font-bold ${
                              isIncome ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {isIncome ? "+" : "-"}
                            {Number(tx.amount || 0).toFixed(2)} AZN
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
      </PageLayout>
  );
}
