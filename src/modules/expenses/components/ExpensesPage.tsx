"use client";

import PageLayout from "@/components/layout/PageLayout";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  cancelExpenseAction,
  fetchExpenseFormOptionsAction,
  fetchExpensesAction,
  approveExpenseAction,
  postExpenseAction,
  reimburseExpenseAction,
  rejectExpenseAction,
  submitExpenseAction,
  saveExpenseAction,
  type ExpenseFormOptions,
} from "../actions/expenses";
import {
  EXPENSE_STATUSES,
  firstDayOfMonthIsoDate,
  isOwedToEmployee,
  todayIsoDate,
  type ExpenseDocument,
  type ExpenseFilters,
  type ExpenseSaveInput,
  type ExpenseStatus,
  type ExpenseSummary,
} from "../lib/expenseDocuments";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { exportXlsx, xlsxFileName, type XlsxColumn } from "@/lib/export/exportXlsx";
import { ListBodyCells, ListHeadCells, dash, useTableColumns, type TableColumn } from "@/components/lists/listTable";
import ExpenseCategoriesManager from "@/components/finance/ExpenseCategoriesManager";
import ExpenseCategorySelect from "@/components/finance/ExpenseCategorySelect";
import ExpenseFormModal from "./ExpenseFormModal";
import ExpenseAttachmentsModal from "./ExpenseAttachmentsModal";
import ExpenseMonthlyReport from "./ExpenseMonthlyReport";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Tr } from "@/components/ui/table";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import StatusBadge, { type StatusTone } from "@/components/ui/status-badge";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import {
  Ban,
  CheckCircle2,
  Download,
  FolderTree,
  HandCoins,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  X,
} from "lucide-react";

type ExpensesTab = "records" | "report" | "categories";

const EMPTY_OPTIONS: ExpenseFormOptions = {
  accounts: [],
  categories: [],
  suppliers: [],
  departments: [],
  employees: [],
};

const EMPTY_SUMMARY: ExpenseSummary = {
  count: 0,
  net: 0,
  vat: 0,
  total: 0,
  pendingCount: 0,
  pendingTotal: 0,
  owedCount: 0,
  owedTotal: 0,
  byCategory: [],
};

const STATUS_TONE: Record<ExpenseStatus, StatusTone> = {
  draft: "draft",
  submitted: "warning",
  approved: "success",
  posted: "posted",
  cancelled: "cancelled",
};

function shiftMonth(iso: string, delta: number): { from: string; to: string } {
  const [y, m] = iso.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 + delta, 1));
  const end = new Date(Date.UTC(y, m + delta, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** Column choice key of this list (prompt 24c). */
const EXPENSES_LIST_KEY = "expenses.documents";

function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export default function ExpensesPage() {
  const { t, formatDateTime } = useI18n();
  const { can } = useAuth();
  const canManageExpenses = can("can_manage_expenses");
  const canManageFinance = can("can_manage_finance");
  const canManage = canManageExpenses || canManageFinance;
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [activeTab, setActiveTab] = useState<ExpensesTab>("records");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExpenseDocument[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary>(EMPTY_SUMMARY);
  const [truncated, setTruncated] = useState(false);
  const [options, setOptions] = useState<ExpenseFormOptions>(EMPTY_OPTIONS);
  const [filters, setFilters] = useState<ExpenseFilters>(() => ({
    from: firstDayOfMonthIsoDate(),
    to: todayIsoDate(),
    categoryId: "",
    accountId: "",
    supplierId: "",
    departmentId: "",
    status: "",
    search: "",
  }));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ExpenseDocument | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ExpenseDocument | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reimburseTarget, setReimburseTarget] = useState<ExpenseDocument | null>(null);
  const [reimburseAccountId, setReimburseAccountId] = useState("");
  const [reimburseDate, setReimburseDate] = useState(todayIsoDate());
  const [attachTarget, setAttachTarget] = useState<ExpenseDocument | null>(null);

  const loadOptions = useCallback(async () => {
    const res = await fetchExpenseFormOptionsAction();
    if (res.success && res.data) setOptions(res.data);
    else if (!res.success) showError(res.error || t("common.error"));
  }, [showError, t]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const res = await fetchExpensesAction(filters);
    if (res.success && res.data) {
      setRows(res.data.rows);
      setSummary(res.data.summary);
      setTruncated(res.data.truncated);
    } else {
      showError(res.success ? t("common.error") : res.error || t("common.error"));
      setRows([]);
      setSummary(EMPTY_SUMMARY);
    }
    setLoading(false);
  }, [filters, showError, t]);

  useEffect(() => {
    const timer = setTimeout(() => void loadOptions(), 0);
    return () => clearTimeout(timer);
  }, [loadOptions]);

  useEffect(() => {
    const timer = setTimeout(() => void loadRows(), filters.search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadRows, filters.search]);

  const setFilter = <K extends keyof ExpenseFilters>(key: K, value: ExpenseFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const quickRanges = useMemo(() => {
    const today = todayIsoDate();
    return [
      { key: "thisMonth", label: t("expenses.doc.rangeThisMonth"), from: firstDayOfMonthIsoDate(), to: today },
      { key: "lastMonth", label: t("expenses.doc.rangeLastMonth"), ...shiftMonth(today, -1) },
      { key: "thisYear", label: t("expenses.doc.rangeThisYear"), from: `${today.slice(0, 4)}-01-01`, to: today },
      { key: "all", label: t("common.all"), from: "", to: "" },
    ];
  }, [t]);

  const refreshAll = () => {
    void loadRows();
    void loadOptions();
  };

  const handleSave = async (input: ExpenseSaveInput) => {
    setSaving(true);
    const res = await saveExpenseAction(input);
    setSaving(false);
    if (!res.success || !res.data) {
      showError(t("common.error") + ": " + formatRpcError(res.success ? undefined : res.error, t));
      return;
    }
    showSuccess(
      res.data.status === "posted"
        ? t("expenses.doc.postedToast", { code: res.data.code })
        : t("expenses.doc.draftToast", { code: res.data.code })
    );
    setFormOpen(false);
    setEditing(null);
    refreshAll();
  };

  const runRowAction = async (
    row: ExpenseDocument,
    action: () => Promise<{ success: boolean; error?: string }>,
    successKey: string
  ): Promise<boolean> => {
    setBusyId(row.id);
    const res = await action();
    setBusyId(null);
    if (!res.success) {
      showError(t("common.error") + ": " + formatRpcError(res.error, t));
      return false;
    }
    showSuccess(t(successKey, { code: row.code }));
    refreshAll();
    return true;
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    const ok = await runRowAction(
      rejectTarget,
      () => rejectExpenseAction(rejectTarget.id, rejectReason),
      "expenses.doc.rejectedToast"
    );
    if (ok) setRejectTarget(null);
  };

  const handleReimburse = async () => {
    if (!reimburseTarget) return;
    if (!reimburseAccountId) {
      showError(t("expenses.selectAccountAlert"));
      return;
    }
    const ok = await runRowAction(
      reimburseTarget,
      () => reimburseExpenseAction(reimburseTarget.id, reimburseAccountId, reimburseDate),
      "expenses.doc.reimbursedToast"
    );
    if (ok) setReimburseTarget(null);
  };

  const handlePost = async (row: ExpenseDocument) => {
    setBusyId(row.id);
    const res = await postExpenseAction(row.id);
    setBusyId(null);
    if (!res.success) {
      showError(t("common.error") + ": " + formatRpcError(res.error, t));
      return;
    }
    showSuccess(t("expenses.doc.postedToast", { code: row.code }));
    refreshAll();
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id);
    const res = await cancelExpenseAction(cancelTarget.id, cancelReason);
    setBusyId(null);
    if (!res.success) {
      showError(t("common.error") + ": " + formatRpcError(res.error, t));
      return;
    }
    showSuccess(t("expenses.doc.cancelledToast", { code: cancelTarget.code }));
    setCancelTarget(null);
    setCancelReason("");
    refreshAll();
  };

  const statusLabel = (status: ExpenseStatus) => t(`expenses.doc.status_${status}`);
  const rowStatusLabel = (row: ExpenseDocument) =>
    isOwedToEmployee(row) ? t("expenses.doc.status_owed") : statusLabel(row.status);

  // Columns of the list (prompt 24c); expenses have no salesperson.
  const columnDefs = useMemo<TableColumn<ExpenseDocument>[]>(() => {
    const docStatusText = (r: ExpenseDocument) => (isOwedToEmployee(r) ? t("expenses.doc.status_owed") : t(`expenses.doc.status_${r.status}`));
    return [
      { key: "date", labelKey: "listColumns.documentDate", offLabelKey: "common.date", defaultVisible: true, tdClassName: "whitespace-nowrap text-xs text-app-muted", exportType: "date", exportValue: (r) => r.expense_date, cell: (r) => formatDate(r.expense_date) },
      {
        key: "code",
        labelKey: "expenses.doc.code",
        defaultVisible: true,
        required: true,
        tdClassName: "whitespace-nowrap font-mono text-xs",
        exportValue: (r) => r.code,
        cell: (r) => (
          <>
            {r.code}
            {r.attachment_count > 0 ? (
              <button
                type="button"
                onClick={() => setAttachTarget(r)}
                className="ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[11px] text-sky-600 hover:bg-sky-50"
                title={t("expenses.doc.attachments")}
              >
                <Paperclip className="h-3 w-3" />
                {r.attachment_count}
              </button>
            ) : null}
          </>
        ),
      },
      {
        key: "category",
        labelKey: "common.category",
        defaultVisible: true,
        tdClassName: "font-semibold text-app",
        exportValue: (r) => r.category,
        cell: (r) => (
          <>
            {r.category}
            {r.department_name ? <div className="text-[11px] font-normal text-app-muted">{r.department_name}</div> : null}
          </>
        ),
      },
      {
        key: "supplier",
        labelKey: "expenses.doc.supplier",
        defaultVisible: true,
        tdClassName: "text-app-muted",
        exportValue: (r) => r.supplier_name || r.payee || null,
        cell: (r) => (
          <>
            {r.supplier_name || r.payee || (r.payment_mode === "employee" ? "" : "—")}
            {r.payment_mode === "employee" ? (
              <div className="text-[11px] font-semibold text-orange-600">{t("expenses.doc.paidByEmployee", { name: r.employee_name || "—" })}</div>
            ) : null}
            {r.reference_no ? <div className="text-[11px]">№ {r.reference_no}</div> : null}
          </>
        ),
      },
      { key: "description", labelKey: "expenses.doc.description", defaultVisible: true, tdClassName: "max-w-xs truncate text-app-muted", exportValue: (r) => r.description || r.notes || null, cell: (r) => <span title={r.cancel_reason || r.notes || undefined}>{r.description || r.notes || "—"}</span> },
      {
        key: "account",
        labelKey: "expenses.paidAccount",
        defaultVisible: true,
        tdClassName: "text-app-muted",
        exportValue: (r) => r.account_name,
        cell: (r) => (
          <>
            {r.account_name || "—"}
            {r.vat_account_name ? <div className="text-[11px]">{t("expenses.doc.vatPaidFrom", { name: r.vat_account_name })}</div> : null}
          </>
        ),
      },
      { key: "vat", labelKey: "expenses.doc.vat", defaultVisible: true, numeric: true, tdClassName: "text-xs text-app-muted", exportValue: (r) => r.vat_amount, cell: (r) => (r.vat_amount > 0 ? r.vat_amount.toFixed(2) : "—") },
      {
        key: "total",
        labelKey: "expenses.doc.total",
        defaultVisible: true,
        numeric: true,
        exportValue: (r) => r.amount,
        cell: (r) => <span className={`font-bold ${r.status === "cancelled" ? "line-through text-app-muted" : "text-rose-600"}`}>{r.amount.toFixed(2)} AZN</span>,
      },
      {
        key: "status",
        labelKey: "common.status",
        defaultVisible: true,
        exportValue: (r) => docStatusText(r),
        cell: (r) => (
          <>
            <StatusBadge tone={isOwedToEmployee(r) ? "warning" : STATUS_TONE[r.status]}>{docStatusText(r)}</StatusBadge>
            {r.status === "draft" && r.rejected_reason ? (
              <div className="mt-1 max-w-[10rem] truncate text-[11px] text-amber-700" title={r.rejected_reason}>
                {r.rejected_reason}
              </div>
            ) : null}
          </>
        ),
      },
      { key: "created_at", labelKey: "listColumns.issuedAt", defaultVisible: true, standard: true, tdClassName: "whitespace-nowrap text-xs text-app-muted", exportType: "datetime", exportValue: (r) => r.created_at, cell: (r) => (r.created_at ? formatDateTime(r.created_at) : "—") },
      { key: "created_by", labelKey: "listColumns.createdBy", defaultVisible: true, standard: true, cell: (r) => dash(r.created_by_name) },
      { key: "net", labelKey: "expenses.doc.net", defaultVisible: false, numeric: true, exportValue: (r) => r.net_amount, cell: (r) => r.net_amount.toFixed(2) },
      { key: "reference_no", labelKey: "expenses.doc.referenceNo", defaultVisible: false, cell: (r) => dash(r.reference_no) },
      { key: "department", labelKey: "expenses.doc.department", defaultVisible: false, cell: (r) => dash(r.department_name) },
      { key: "employee", labelKey: "expenses.engine.paidBy", defaultVisible: false, cell: (r) => (r.payment_mode === "employee" ? dash(r.employee_name) : t("expenses.engine.paidByCompany")) },
    ];
  }, [t, formatDateTime]);
  const columns = useTableColumns(EXPENSES_LIST_KEY, columnDefs);

  // Excel (prompt 24c, without the flag): today's export columns while LIST_COLUMNS is off,
  // the columns the user sees while it is on. All loaded rows of the filter.
  const legacyExportColumns: XlsxColumn<ExpenseDocument>[] = [
    { header: t("common.date"), type: "date", value: (r) => r.expense_date },
    { header: t("expenses.doc.code"), value: (r) => r.code },
    { header: t("common.category"), value: (r) => r.category },
    { header: t("expenses.doc.supplier"), value: (r) => r.supplier_name || r.payee || null },
    { header: t("expenses.doc.referenceNo"), value: (r) => r.reference_no },
    { header: t("expenses.doc.description"), value: (r) => r.description || r.notes || null },
    { header: t("expenses.paidAccount"), value: (r) => r.account_name },
    { header: t("expenses.doc.department"), value: (r) => r.department_name },
    { header: t("expenses.doc.net"), type: "money", value: (r) => r.net_amount },
    { header: t("expenses.doc.vat"), type: "money", value: (r) => r.vat_amount },
    { header: t("expenses.doc.total"), type: "money", value: (r) => r.amount },
    { header: t("common.status"), value: (r) => rowStatusLabel(r) },
  ];
  const exportExcel = () => {
    const name = xlsxFileName(`xercler_${filters.from || "all"}_${filters.to || todayIsoDate()}`, new Date());
    void exportXlsx(name, {
      sheetName: t("expenses.pageTitle"),
      columns: columns.enabled ? columns.exportColumns : legacyExportColumns,
      rows,
    });
  };

  const maxCategory = summary.byCategory[0]?.amount || 0;

  return (
    <PageLayout>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-app app-glass px-6 py-4">
        <div>
          <h2 className="text-xl font-bold text-app">{t("expenses.pageTitle")}</h2>
          <p className="text-sm text-app-muted">{t("expenses.pageDescription")}</p>
        </div>
        {activeTab === "records" ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportExcel}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {t("expenses.doc.exportExcel")}
            </button>
            {columns.picker}
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              disabled={!canManageExpenses}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {t("expenses.createButton")}
            </button>
          </div>
        ) : null}
      </header>

      <div className="border-b border-app px-6">
        <div className="flex gap-2 py-3">
          <button
            type="button"
            onClick={() => setActiveTab("records")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              activeTab === "records" ? "bg-rose-600 text-white" : "bg-app-card-hover text-app-muted hover:text-app"
            }`}
          >
            {t("expenses.tabRecords")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("report")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
              activeTab === "report" ? "bg-rose-600 text-white" : "bg-app-card-hover text-app-muted hover:text-app"
            }`}
          >
            <TrendingUp className="h-4 w-4" />
            {t("expenses.doc.reportTab")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("categories")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
              activeTab === "categories"
                ? "bg-rose-600 text-white"
                : "bg-app-card-hover text-app-muted hover:text-app"
            }`}
          >
            <FolderTree className="h-4 w-4" />
            {t("expenses.tabCategories")}
          </button>
        </div>
      </div>

      <main className="app-page-content flex-1 space-y-4 overflow-y-auto">
        {activeTab !== "categories" ? (
          <>
            <section className="app-card space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {quickRanges.map((range) => {
                  const active = filters.from === range.from && filters.to === range.to;
                  return (
                    <button
                      key={range.key}
                      type="button"
                      onClick={() => setFilters((prev) => ({ ...prev, from: range.from, to: range.to }))}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        active ? "bg-rose-600 text-white" : "bg-app-card-hover text-app-muted hover:text-app"
                      }`}
                    >
                      {range.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={refreshAll}
                  className="ml-auto rounded-lg border p-2 hover:bg-app-card-hover"
                  aria-label={t("common.refresh")}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                <input
                  type="date"
                  value={filters.from || ""}
                  onChange={(e) => setFilter("from", e.target.value)}
                  className="app-input text-sm"
                  aria-label={t("expenses.doc.dateFrom")}
                  title={t("expenses.doc.dateFrom")}
                />
                <input
                  type="date"
                  value={filters.to || ""}
                  onChange={(e) => setFilter("to", e.target.value)}
                  className="app-input text-sm"
                  aria-label={t("expenses.doc.dateTo")}
                  title={t("expenses.doc.dateTo")}
                />
                <ExpenseCategorySelect
                  categories={options.categories}
                  value={filters.categoryId || ""}
                  onChange={(id) => setFilter("categoryId", id)}
                  placeholder={t("expenses.doc.allCategories")}
                />
                <select
                  value={filters.accountId || ""}
                  onChange={(e) => setFilter("accountId", e.target.value)}
                  className="app-input text-sm"
                >
                  <option value="">{t("expenses.doc.allAccounts")}</option>
                  {options.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.supplierId || ""}
                  onChange={(e) => setFilter("supplierId", e.target.value)}
                  className="app-input text-sm"
                >
                  <option value="">{t("expenses.doc.allSuppliers")}</option>
                  {options.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.departmentId || ""}
                  onChange={(e) => setFilter("departmentId", e.target.value)}
                  className="app-input text-sm"
                >
                  <option value="">{t("expenses.doc.allDepartments")}</option>
                  {options.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={filters.status || ""}
                  onChange={(e) => setFilter("status", e.target.value as ExpenseStatus | "")}
                  className="app-input text-sm"
                >
                  <option value="">{t("expenses.doc.allStatuses")}</option>
                  {EXPENSE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
                <input
                  type="search"
                  value={filters.search || ""}
                  onChange={(e) => setFilter("search", e.target.value)}
                  placeholder={t("common.search")}
                  className="app-input text-sm"
                />
              </div>
            </section>

            {activeTab === "report" ? (
              <ExpenseMonthlyReport
                rows={rows}
                loading={loading}
                rangeLabel={`${filters.from || "all"}_${filters.to || todayIsoDate()}`}
              />
            ) : (
            <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="app-card app-card-elevated p-4">
                <div className="text-xs font-semibold uppercase text-app-muted">{t("expenses.totalRecorded")}</div>
                <div className="mt-1 text-2xl font-bold text-rose-600">{summary.total.toFixed(2)} AZN</div>
                <div className="text-xs text-app-muted">{t("expenses.doc.documentsCount", { count: summary.count })}</div>
              </div>
              <div className="app-card p-4">
                <div className="text-xs font-semibold uppercase text-app-muted">{t("expenses.doc.net")}</div>
                <div className="mt-1 text-xl font-bold text-app">{summary.net.toFixed(2)} AZN</div>
              </div>
              <div className="app-card p-4">
                <div className="text-xs font-semibold uppercase text-app-muted">{t("expenses.doc.vat")}</div>
                <div className="mt-1 text-xl font-bold text-app">{summary.vat.toFixed(2)} AZN</div>
              </div>
              <div className="app-card p-4">
                <div className="text-xs font-semibold uppercase text-app-muted">{t("expenses.doc.pending")}</div>
                <div className="mt-1 text-xl font-bold text-amber-600">{summary.pendingTotal.toFixed(2)} AZN</div>
                <div className="text-xs text-app-muted">{t("expenses.doc.documentsCount", { count: summary.pendingCount })}</div>
              </div>
              {summary.owedCount > 0 ? (
                <div className="app-card p-4">
                  <div className="text-xs font-semibold uppercase text-app-muted">{t("expenses.doc.owedToEmployees")}</div>
                  <div className="mt-1 text-xl font-bold text-orange-600">{summary.owedTotal.toFixed(2)} AZN</div>
                  <div className="text-xs text-app-muted">{t("expenses.doc.documentsCount", { count: summary.owedCount })}</div>
                </div>
              ) : null}
            </section>

            {summary.byCategory.length > 0 ? (
              <section className="app-card p-4">
                <h3 className="mb-3 text-sm font-bold text-app">{t("expenses.doc.byCategory")}</h3>
                <div className="space-y-2">
                  {summary.byCategory.slice(0, 10).map((item) => (
                    <div key={item.category} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="flex justify-between gap-2">
                          <span className="truncate text-app">{item.category}</span>
                          <span className="text-xs text-app-muted">{item.count}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-app-card-hover">
                          <div
                            className="h-1.5 rounded-full bg-rose-500"
                            style={{ width: `${maxCategory ? Math.max(2, (item.amount / maxCategory) * 100) : 0}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-28 text-right font-semibold tabular-nums text-app">
                        {item.amount.toFixed(2)} AZN
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="app-table-wrap">
              {loading && rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-app-muted">{t("common.loading")}</div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-app-muted">{t("expenses.emptyRecords")}</div>
              ) : (
                <TableWrap className="rounded-none border-0 shadow-none">
                  <Table>
                    <THead>
                      <tr>
                        <ListHeadCells columns={columns.visible} />
                        <ActionsTh>{t("common.actions")}</ActionsTh>
                      </tr>
                    </THead>
                    <tbody>
                      {rows.map((r) => {
                        const isOpen = r.status === "draft" || r.status === "submitted";
                        const byEmployee = r.payment_mode === "employee";
                        const cancelled = r.status === "cancelled";
                        return (
                          <Tr key={r.id} className={cancelled ? "opacity-60" : undefined}>
                            <ListBodyCells columns={columns.visible} row={r} />
                            <ActionsTd>
                              <TableRowActionsMenu
                                items={[
                                  {
                                    key: "edit",
                                    label: t("common.edit"),
                                    icon: <Pencil className="h-4 w-4" />,
                                    hidden: !isOpen,
                                    disabled: !canManageExpenses,
                                    onClick: () => {
                                      setEditing(r);
                                      setFormOpen(true);
                                    },
                                  },
                                  {
                                    key: "attachments",
                                    label: t("expenses.doc.attachmentsAction", { count: r.attachment_count }),
                                    icon: <Paperclip className="h-4 w-4" />,
                                    onClick: () => setAttachTarget(r),
                                  },
                                  {
                                    key: "submit",
                                    label: t("expenses.doc.sendForApproval"),
                                    icon: <Send className="h-4 w-4" />,
                                    hidden: r.status !== "draft",
                                    disabled: !canManageExpenses || busyId === r.id,
                                    onClick: () =>
                                      void runRowAction(r, () => submitExpenseAction(r.id), "expenses.doc.submittedToast"),
                                  },
                                  {
                                    key: "post",
                                    label: t("expenses.doc.post"),
                                    icon: <CheckCircle2 className="h-4 w-4" />,
                                    hidden: r.status !== "draft" || byEmployee,
                                    disabled: !canManageExpenses || busyId === r.id,
                                    onClick: () => void handlePost(r),
                                  },
                                  {
                                    key: "approve",
                                    label: byEmployee ? t("expenses.doc.approve") : t("expenses.doc.approveAndPay"),
                                    icon: <ThumbsUp className="h-4 w-4" />,
                                    hidden: r.status !== "submitted",
                                    disabled: !canManageFinance || busyId === r.id,
                                    onClick: () =>
                                      void runRowAction(r, () => approveExpenseAction(r.id), "expenses.doc.approvedToast"),
                                  },
                                  {
                                    key: "reject",
                                    label: t("expenses.doc.reject"),
                                    icon: <ThumbsDown className="h-4 w-4" />,
                                    hidden: r.status !== "submitted",
                                    disabled: !canManageFinance || busyId === r.id,
                                    onClick: () => {
                                      setRejectReason("");
                                      setRejectTarget(r);
                                    },
                                  },
                                  {
                                    key: "reimburse",
                                    label: t("expenses.doc.reimburse"),
                                    icon: <HandCoins className="h-4 w-4" />,
                                    hidden: !isOwedToEmployee(r),
                                    disabled: !canManageFinance || busyId === r.id,
                                    onClick: () => {
                                      setReimburseAccountId("");
                                      setReimburseDate(todayIsoDate());
                                      setReimburseTarget(r);
                                    },
                                  },
                                  {
                                    key: "cancel",
                                    label: t("expenses.doc.cancelExpense"),
                                    icon: <Ban className="h-4 w-4" />,
                                    hidden: cancelled || r.is_production,
                                    disabled:
                                      !canManageExpenses ||
                                      busyId === r.id ||
                                      ((r.status === "approved" || (r.status === "posted" && byEmployee)) &&
                                        !canManageFinance),
                                    variant: "destructive",
                                    onClick: () => {
                                      setCancelReason("");
                                      setCancelTarget(r);
                                    },
                                  },
                                ]}
                              />
                            </ActionsTd>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
              {truncated ? (
                <div className="border-t border-app p-3 text-center text-xs text-app-muted">
                  {t("expenses.doc.truncated")}
                </div>
              ) : null}
            </div>
            </>
            )}
          </>
        ) : (
          <ExpenseCategoriesManager
            canManage={canManage}
            onChanged={() => void loadOptions()}
            onError={showError}
            onSuccess={showSuccess}
          />
        )}
      </main>

      {formOpen ? (
        <ExpenseFormModal
          options={options}
          initial={editing}
          saving={saving}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSubmit={(input) => void handleSave(input)}
        />
      ) : null}

      {attachTarget ? (
        <ExpenseAttachmentsModal
          expense={attachTarget}
          canUpload={canManageExpenses}
          canDeleteBooked={canManageFinance}
          onClose={() => setAttachTarget(null)}
          onChanged={(count) =>
            setRows((prev) => prev.map((row) => (row.id === attachTarget.id ? { ...row, attachment_count: count } : row)))
          }
        />
      ) : null}

      {cancelTarget ? (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex items-center justify-between bg-app-card-hover">
              <h3 className="font-bold text-app">
                {t("expenses.doc.cancelTitle", { code: cancelTarget.code })}
              </h3>
              <button type="button" onClick={() => setCancelTarget(null)} className="text-app-muted hover:text-app">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-6">
              <p className="text-sm text-app-muted">
                {cancelTarget.status === "posted"
                  ? t("expenses.doc.cancelPostedHint", { amount: cancelTarget.amount.toFixed(2) })
                  : cancelTarget.status === "approved"
                    ? t("expenses.doc.cancelOwedHint")
                    : t("expenses.doc.cancelDraftHint")}
              </p>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t("expenses.doc.cancelReason")}
                className="app-input text-sm"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={busyId === cancelTarget.id}
                  onClick={() => void handleCancel()}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {t("expenses.doc.cancelConfirm")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {rejectTarget ? (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex items-center justify-between bg-app-card-hover">
              <h3 className="font-bold text-app">{t("expenses.doc.rejectTitle", { code: rejectTarget.code })}</h3>
              <button type="button" onClick={() => setRejectTarget(null)} className="text-app-muted hover:text-app">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-6">
              <p className="text-sm text-app-muted">{t("expenses.doc.rejectHint")}</p>
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t("expenses.doc.rejectReason")}
                className="app-input text-sm"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={busyId === rejectTarget.id}
                  onClick={() => void handleReject()}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {t("expenses.doc.reject")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {reimburseTarget ? (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex items-center justify-between bg-app-card-hover">
              <h3 className="font-bold text-app">
                {t("expenses.doc.reimburseTitle", { code: reimburseTarget.code })}
              </h3>
              <button type="button" onClick={() => setReimburseTarget(null)} className="text-app-muted hover:text-app">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-6">
              <p className="text-sm text-app-muted">
                {t("expenses.doc.reimburseHint", {
                  amount: reimburseTarget.amount.toFixed(2),
                  name: reimburseTarget.employee_name || "—",
                })}
              </p>
              <div>
                <label className="mb-1 block text-xs font-semibold text-app">
                  {t("expenses.paymentAccountRequired")}
                </label>
                <select
                  value={reimburseAccountId}
                  onChange={(e) => setReimburseAccountId(e.target.value)}
                  className="app-input text-sm"
                >
                  <option value="">{t("expenses.selectAccount")}</option>
                  {options.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {t("expenses.accountBalance", { name: a.name, balance: a.balance.toFixed(2) })}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-app">{t("expenses.doc.payDate")}</label>
                <input
                  type="date"
                  value={reimburseDate}
                  min={reimburseTarget.expense_date}
                  max={todayIsoDate()}
                  onChange={(e) => setReimburseDate(e.target.value)}
                  className="app-input text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReimburseTarget(null)}
                  className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={busyId === reimburseTarget.id}
                  onClick={() => void handleReimburse()}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {t("expenses.doc.reimburse")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
