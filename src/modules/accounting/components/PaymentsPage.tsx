"use client";

import { useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import PaymentFormModal from "@/components/payments/PaymentFormModal";
import { fetchPartnerPayments } from "@/lib/payments/fetchPayments";
import type { PartnerPaymentRecord } from "@/lib/payments/types";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { FileSpreadsheet, Plus, RefreshCw, Search, Wallet } from "lucide-react";
import { dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import { exportXlsx, xlsxFileName } from "@/lib/export/exportXlsx";
import { formatGridDateTime, toDateValue } from "@/lib/dates/localeDate";
import { ListGrid } from "@/components/lists/ListGrid";

/** Column choice key of this list (prompt 24c). */
const PAYMENTS_LIST_KEY = "accounting.payments";

function formatMoney(value: number): string {
  return `${value.toFixed(2)} AZN`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  return toDateValue(value) ? formatGridDateTime(value) : value;
}

export default function PaymentsPage() {
  const { t, formatDateTime } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_finance");

  const [rows, setRows] = useState<PartnerPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await fetchPartnerPayments();
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [row.partner_name, row.reference_note, row.cash_account_name, row.payment_type, row.payment_method]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [rows, search]);

  // Columns of the list (prompt 24c); payments have no salesperson.
  const columnDefs = useMemo<TableColumn<PartnerPaymentRecord>[]>(
    () => [
      { key: "payment_date", labelKey: "listColumns.documentDate", offLabelKey: "common.date", defaultVisible: true, required: true, exportType: "date", exportValue: (r) => r.payment_date?.slice(0, 10) || null, cell: (r) => formatDate(r.payment_date) },
      { key: "partner", labelKey: "payments.partner", defaultVisible: true, tdClassName: "font-semibold", cell: (r) => r.partner_name },
      {
        key: "type",
        labelKey: "payments.type",
        defaultVisible: true,
        exportValue: (r) => (r.payment_type === "in" ? t("payments.typeIn") : t("payments.typeOut")),
        cell: (r) => (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${r.payment_type === "in" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {r.payment_type === "in" ? t("payments.typeIn") : t("payments.typeOut")}
          </span>
        ),
      },
      { key: "method", labelKey: "payments.method", defaultVisible: true, cell: (r) => (r.payment_method === "bank" ? t("payments.methodBank") : t("payments.methodCash")) },
      { key: "amount", labelKey: "payments.amount", defaultVisible: true, numeric: true, tdClassName: "font-mono font-semibold", exportValue: (r) => r.amount, cell: (r) => formatMoney(r.amount) },
      { key: "created_at", labelKey: "listColumns.issuedAt", defaultVisible: true, standard: true, tdClassName: "whitespace-nowrap text-app-muted", exportType: "datetime", exportValue: (r) => r.created_at, cell: (r) => (r.created_at ? formatDateTime(r.created_at) : "—") },
      { key: "created_by", labelKey: "listColumns.createdBy", defaultVisible: true, standard: true, cell: (r) => dash(r.created_by_name) },
      { key: "cash_account", labelKey: "payments.cashAccount", defaultVisible: false, cell: (r) => dash(r.cash_account_name) },
      { key: "reference", labelKey: "payments.reference", defaultVisible: false, cell: (r) => dash(r.reference_note) },
    ],
    [t, formatDateTime]
  );
  const columns = useTableColumns(PAYMENTS_LIST_KEY, columnDefs);
  const handleExport = () => {
    if (!filtered.length) return;
    void exportXlsx(xlsxFileName(t("payments.pageTitle"), new Date()), { sheetName: t("payments.pageTitle"), columns: columns.exportColumns, rows: filtered });
  };

  return (
    <PageLayout>
      <header className="app-glass flex flex-wrap items-center justify-between gap-4 border-b border-app px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-app">
            <Wallet className="h-6 w-6 text-app-accent" />
            {t("payments.pageTitle")}
          </h2>
          <p className="text-sm text-app-muted">{t("payments.pageDescription")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <button type="button" onClick={() => setFormOpen(true)} className="btn-primary">
              <Plus className="h-4 w-4" />
              {t("payments.newPayment")}
            </button>
          ) : null}
          <button type="button" onClick={() => void load()} className="btn-secondary">
            <RefreshCw className="h-4 w-4" />
            {t("common.refresh")}
          </button>
          {/* Excel and the column picker come with LIST_COLUMNS (prompt 24c). */}
          {columns.enabled && !columns.grid ? (
            <button type="button" onClick={handleExport} className="btn-secondary">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              {t("common.excelDownload")}
            </button>
          ) : null}
          {columns.picker}
        </div>
      </header>

      <div className="space-y-4 p-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.search")}
            className="app-input w-full pl-9"
          />
        </div>

        {columns.grid ? (
          <ListGrid
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            label={t("payments.pageTitle")}
            loading={loading}
            empty={<p className="text-sm ds-muted">{t("payments.empty")}</p>}
            onExport={columns.enabled ? handleExport : undefined}
          />
        ) : (
        <div className="app-card overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-app-card-hover text-xs font-bold uppercase text-app-muted">
              <tr>
                {columns.visible.map((c) => (
                  <th key={c.key} className={c.numeric ? "p-3 text-right" : "p-3"}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-app">
              {loading ? (
                <tr>
                  <td colSpan={columns.visible.length} className="p-6 text-center text-app-muted">{t("common.loading")}</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns.visible.length} className="p-6 text-center text-app-muted">{t("payments.empty")}</td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-app-card-hover/60">
                    {columns.visible.map((c) => (
                      <td key={c.key} className={["p-3", c.numeric ? "text-right" : "", c.tdClassName ?? ""].join(" ").trim()}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <PaymentFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load()}
      />
    </PageLayout>
  );
}
