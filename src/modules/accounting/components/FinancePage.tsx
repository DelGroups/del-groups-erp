"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import UnifiedLedgerRowActions from "./UnifiedLedgerRowActions";
import Button from "@/components/ui/button";
import Card, { CardMeta } from "@/components/ui/card";
import { ActionsTd, ActionsTh, Table, TableWrap, THead } from "@/components/ui/table";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { fetchUnifiedLedgerAction } from "@/lib/actions/finance";
import { useTaxPayrollConfig } from "@/hooks/useTaxPayrollConfig";
import { formatReferenceTypeLabel, type UnifiedLedgerTransaction } from "@/lib/finance/unifiedLedger";
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, FileSpreadsheet, RefreshCw } from "lucide-react";
import { ListBodyCells, ListHeadCells, dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { useProfileNames } from "@/components/lists/useProfileNames";
import { exportXlsx, xlsxFileName } from "@/lib/export/exportXlsx";
import { profileName } from "@/lib/profiles/displayNames";
import { ListGrid } from "@/components/lists/ListGrid";

/** Column choice key of this list (prompt 24c). */
const LEDGER_LIST_KEY = "accounting.ledger";

function formatTypeLabel(type: string, t: (key: string) => string): string {
  if (type === "INCOME") return t("finance.typeIncome");
  if (type === "EXPENSE") return t("finance.typeExpense");
  if (type === "TRANSFER") return t("finance.typeTransfer");
  return type;
}

export default function FinancePage() {
  const { t, formatDateTime } = useI18n();
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

  // Columns of the list (prompt 24c); ledger lines have no salesperson.
  const names = useProfileNames(useMemo(() => transactions.map((tx) => tx.created_by), [transactions]));
  const columnDefs = useMemo<TableColumn<UnifiedLedgerTransaction>[]>(
    () => [
      { key: "date", labelKey: "listColumns.documentDate", offLabelKey: "finance.columnDate", defaultVisible: true, required: true, exportType: "date", exportValue: (tx) => (tx.transaction_date || tx.created_at).slice(0, 10), cell: (tx) => (tx.transaction_date || tx.created_at).slice(0, 16).replace("T", " ") },
      {
        key: "type",
        labelKey: "finance.columnType",
        defaultVisible: true,
        exportValue: (tx) => formatTypeLabel(tx.type, t),
        cell: (tx) => {
          const isIncome = tx.type === "INCOME";
          const isTransfer = tx.type === "TRANSFER";
          return (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                isIncome
                  ? "bg-[color:var(--app-success-soft)] text-[color:var(--app-success-text)]"
                  : isTransfer
                    ? "bg-sky-500/10 text-sky-400"
                    : "bg-rose-500/10 text-rose-400"
              }`}
            >
              {isIncome ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {formatTypeLabel(tx.type, t)}
            </span>
          );
        },
      },
      { key: "category", labelKey: "finance.columnCategory", defaultVisible: true, tdClassName: "font-semibold", cell: (tx) => tx.category || "—" },
      {
        key: "amount",
        labelKey: "finance.columnAmount",
        defaultVisible: true,
        numeric: true,
        // Excel: signed like the list (income +, everything else -).
        exportValue: (tx) => (tx.type === "INCOME" ? tx.amount : -tx.amount),
        tdClassName: "font-bold",
        cell: (tx) => (
          <span className={tx.type === "INCOME" ? "text-emerald-600" : "text-rose-600"}>
            {tx.type === "INCOME" ? "+" : "-"}
            {tx.amount.toFixed(2)} AZN
          </span>
        ),
      },
      { key: "account", labelKey: "finance.columnAccount", defaultVisible: true, cell: (tx) => tx.account_name || "—" },
      { key: "description", labelKey: "finance.columnDescription", defaultVisible: true, tdClassName: "max-w-xs truncate text-app-muted", cell: (tx) => tx.description || tx.notes || "—" },
      {
        key: "source",
        labelKey: "finance.columnSource",
        defaultVisible: true,
        exportValue: (tx) => formatReferenceTypeLabel(tx.reference_type),
        cell: (tx) => (
          <span className="inline-flex rounded-full bg-app-card-hover px-2 py-0.5 text-[10px] font-semibold text-app-muted">
            {formatReferenceTypeLabel(tx.reference_type)}
          </span>
        ),
      },
      { key: "created_at", labelKey: "listColumns.issuedAt", defaultVisible: true, standard: true, tdClassName: "whitespace-nowrap text-app-muted", exportType: "datetime", exportValue: (tx) => tx.created_at || null, cell: (tx) => (tx.created_at ? formatDateTime(tx.created_at) : "—") },
      { key: "created_by", labelKey: "listColumns.createdBy", defaultVisible: true, standard: true, cell: (tx) => dash(profileName(names, tx.created_by)) },
      { key: "notes", labelKey: "finance.note", defaultVisible: false, tdClassName: "max-w-xs truncate", cell: (tx) => dash(tx.notes) },
    ],
    [t, formatDateTime, names]
  );
  const columns = useTableColumns(LEDGER_LIST_KEY, columnDefs);
  const handleExport = () => {
    if (!filtered.length) return;
    void exportXlsx(xlsxFileName(t("finance.title"), new Date()), { sheetName: t("finance.title"), columns: columns.exportColumns, rows: filtered });
  };

  const rowActions = (tx: UnifiedLedgerTransaction) => {
    return (
      <>
        <UnifiedLedgerRowActions
          transaction={tx}
          canManage={canManage}
          onChanged={() => void loadData()}
          onError={showError}
          onSuccess={showSuccess}
        />
      </>
    );
  };

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<CircleDollarSign className="h-6 w-6 text-amber-500" />}
        title={t("finance.title")}
        description={t("finance.pageDescription")}
        extraActions={
          <>
            <Button type="button" variant="secondary" onClick={() => void loadData()} loading={loading}>
              {loading ? null : <RefreshCw className="h-4 w-4" />}
              {t("common.refresh")}
            </Button>
            {/* Excel comes with LIST_COLUMNS (prompt 24c): this list had no export. */}
            {columns.enabled && !columns.grid ? (
              <Button type="button" variant="secondary" onClick={handleExport}>
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                {t("common.excelDownload")}
              </Button>
            ) : null}
          </>
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
        {columns.picker ? <div className="flex justify-end">{columns.picker}</div> : null}

        {columns.grid ? (
          <ListGrid
            columns={columns}
            rows={filtered}
            rowKey={(tx) => tx.id}
            label={t("finance.title")}
            loading={loading}
            empty={<p className="text-xs ds-muted">{t("finance.empty")}</p>}
            rowActions={rowActions}
            onExport={columns.enabled ? handleExport : undefined}
          />
        ) : (
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
                      <ListHeadCells columns={columns.visible} />
                      <ActionsTh>{t("common.actions")}</ActionsTh>
                    </tr>
                  </THead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filtered.map((tx) => {
                      return (
                        <tr key={tx.id} className="transition-colors hover:bg-app-card-hover">
                          <ListBodyCells columns={columns.visible} row={tx} />
                          <ActionsTd>{rowActions(tx)}</ActionsTd>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </TableWrap>
          )}
        </Card>
        )}
      </main>

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
