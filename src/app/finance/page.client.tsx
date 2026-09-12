"use client";

import React, { useCallback, useEffect, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import UnifiedLedgerRowActions from "@/components/finance/UnifiedLedgerRowActions";
import Button from "@/components/ui/button";
import Card, { CardMeta } from "@/components/ui/card";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Th, Td } from "@/components/ui/table";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { fetchUnifiedLedgerAction } from "@/lib/actions/finance";
import { useTaxPayrollConfig } from "@/hooks/useTaxPayrollConfig";
import { formatReferenceTypeLabel, type UnifiedLedgerTransaction } from "@/lib/finance/unifiedLedger";
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, RefreshCw } from "lucide-react";

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
  const { config: taxConfig } = useTaxPayrollConfig();
  const taxRateParams = {
    dsmfEmployee: taxConfig.dsmf_employee_rate,
    dsmfEmployer: taxConfig.dsmf_employer_rate,
    its: taxConfig.its_rate,
    limit: taxConfig.non_taxable_salary_limit,
  };
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
        extraActions={
          <Button type="button" variant="secondary" onClick={() => void loadData()} loading={loading}>
            {loading ? null : <RefreshCw className="h-4 w-4" />}
            {t("common.refresh")}
          </Button>
        }
      />

      <main className="app-page-content flex-1 space-y-3 overflow-y-auto md:space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardMeta>{t("finance.totalIncome")}</CardMeta>
            <p className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-600">
              {summary.totalIncome.toFixed(2)} AZN
            </p>
          </Card>
          <Card>
            <CardMeta>{t("finance.totalExpense")}</CardMeta>
            <p className="mt-1 font-mono text-xl font-bold tabular-nums text-rose-600">
              {summary.totalExpense.toFixed(2)} AZN
            </p>
          </Card>
          <Card>
            <CardMeta>{t("finance.netBalance")}</CardMeta>
            <p className="mt-1 font-mono text-xl font-bold tabular-nums text-app">
              {summary.netBalance.toFixed(2)} AZN
            </p>
          </Card>
          <Card className="md:col-span-3">
            <CardMeta>{t("finance.taxEngineTitle")}</CardMeta>
            <p className="mt-1 text-xs text-app">{t("finance.taxEngineHint")}</p>
            <ul className="mt-2 space-y-1 font-mono text-[11px] tabular-nums text-app-muted">
              <li>{t("tax.dsmfRate", taxRateParams)}</li>
              <li>{t("tax.itsRate", taxRateParams)}</li>
              <li>{t("tax.pitRate", taxRateParams)}</li>
            </ul>
          </Card>
        </div>

        <DocumentListSearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={t("finance.searchPlaceholder")}
          onRefresh={() => void loadData()}
          loading={loading}
        />

        <Card padding={false}>
          {loading ? (
            <div className="p-12 text-center text-xs text-app-muted">{t("finance.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-xs text-app-muted">{t("finance.empty")}</div>
          ) : (
            <TableWrap>
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <tr>
                      <Th>{t("finance.columnDate")}</Th>
                      <Th>{t("finance.columnType")}</Th>
                      <Th>{t("finance.columnCategory")}</Th>
                      <Th numeric>{t("finance.columnAmount")}</Th>
                      <Th>{t("finance.columnAccount")}</Th>
                      <Th>{t("finance.columnDescription")}</Th>
                      <Th>{t("finance.columnSource")}</Th>
                      <ActionsTh>{t("common.actions")}</ActionsTh>
                    </tr>
                  </THead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filtered.map((tx) => {
                      const isIncome = tx.type === "INCOME";
                      const isTransfer = tx.type === "TRANSFER";
                      return (
                        <tr key={tx.id} className="transition-colors hover:bg-app-card-hover">
                          <Td>
                            {(tx.transaction_date || tx.created_at).slice(0, 16).replace("T", " ")}
                          </Td>
                          <Td>
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
                          </Td>
                          <Td className="font-semibold">{tx.category || "—"}</Td>
                          <Td
                            numeric
                            className={`font-bold ${isIncome ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {isIncome ? "+" : "-"}
                            {tx.amount.toFixed(2)} AZN
                          </Td>
                          <Td>{tx.account_name || "—"}</Td>
                          <Td className="max-w-xs truncate text-app-muted">
                            {tx.description || tx.notes || "—"}
                          </Td>
                          <Td>
                            <span className="inline-flex rounded-full bg-app-card-hover px-2 py-0.5 text-[10px] font-semibold text-app-muted">
                              {formatReferenceTypeLabel(tx.reference_type)}
                            </span>
                          </Td>
                          <ActionsTd>
                            <UnifiedLedgerRowActions
                              transaction={tx}
                              canManage={canManage}
                              onChanged={() => void loadData()}
                              onError={showError}
                              onSuccess={showSuccess}
                            />
                          </ActionsTd>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </TableWrap>
          )}
        </Card>
      </main>

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
