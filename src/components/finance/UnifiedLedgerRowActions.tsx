"use client";

import React, { useEffect, useState } from "react";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import ExpenseCategorySelect from "@/components/finance/ExpenseCategorySelect";
import { useI18n } from "@/i18n/I18nProvider";
import {
  deleteTransactionAction,
  fetchAccountLedgerBalancesAction,
  fetchFinancialCategoriesAction,
  updateTransactionAction,
} from "@/lib/actions/finance";
import type { ExpenseCategoryOption } from "@/lib/finance/financialCategories";
import {
  canDeleteLedgerTransaction,
  canEditLedgerTransaction,
} from "@/lib/finance/ledgerTransactionRules";
import { printLedgerReceipt } from "@/lib/finance/printLedgerReceipt";
import {
  formatReferenceTypeLabel,
  type UnifiedLedgerTransaction,
} from "@/lib/finance/unifiedLedger";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { Eye, Pencil, Printer, Trash2, X } from "lucide-react";

interface AccountOption {
  id: string;
  name: string;
}

interface Props {
  transaction: UnifiedLedgerTransaction;
  canManage: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

function formatTypeLabel(type: string, t: (key: string) => string): string {
  if (type === "INCOME") return t("finance.typeIncome");
  if (type === "EXPENSE") return t("finance.typeExpense");
  if (type === "TRANSFER") return t("finance.typeTransfer");
  return type;
}

function ActionIconButton({
  label,
  onClick,
  disabled,
  tone = "neutral",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "blue" | "rose";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
        : "border-app bg-app-card-hover text-app-muted hover:bg-app-surface";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

export default function UnifiedLedgerRowActions({
  transaction,
  canManage,
  onChanged,
  onError,
  onSuccess,
}: Props) {
  const { t } = useI18n();
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryOption[]>([]);
  const [form, setForm] = useState({
    amount: String(transaction.amount),
    category_id: transaction.category_id || "",
    category: transaction.category,
    description: transaction.description || transaction.notes || "",
    account_id: transaction.account_id || "",
  });

  const editable = canManage && canEditLedgerTransaction(transaction);
  const deletable = canManage && canDeleteLedgerTransaction(transaction);

  useEffect(() => {
    if (!editOpen) return;
    setForm({
      amount: String(transaction.amount),
      category_id: transaction.category_id || "",
      category: transaction.category,
      description: transaction.description || transaction.notes || "",
      account_id: transaction.account_id || "",
    });
    void fetchAccountLedgerBalancesAction().then((result) => {
      if (result.success && result.data) {
        setAccounts(
          result.data.accounts.map((row) => ({
            id: row.account_id,
            name: row.name,
          }))
        );
      }
    });
    if (transaction.type === "EXPENSE") {
      void fetchFinancialCategoriesAction().then((result) => {
        if (!result.success || !result.data?.length) return;
        const options = result.data.map((row) => ({
          id: row.id,
          name: row.name,
          parent_id: row.parent_id,
          parent_name: row.parent_name,
        }));
        setCategories(options);
        if (!transaction.category_id) {
          const match = options.find(
            (row) =>
              row.name === transaction.category ||
              `${row.parent_name || ""} / ${row.name}` === transaction.category
          );
          if (match) {
            setForm((prev) => ({ ...prev, category_id: match.id }));
          }
        }
      });
    }
  }, [editOpen, transaction]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      onError(t("expenses.invalidAmount"));
      return;
    }
    setSaving(true);
    const selectedCategory = categories.find((row) => row.id === form.category_id);
    const categoryLabel = selectedCategory?.parent_name
      ? `${selectedCategory.parent_name} / ${selectedCategory.name}`
      : selectedCategory?.name || form.category;

    const result = await updateTransactionAction({
      transactionId: transaction.id,
      amount,
      category: categoryLabel,
      description: form.description,
      accountId: form.account_id || null,
      notes: form.description,
    });
    setSaving(false);
    if (!result.success) {
      onError(formatRpcError(result.error, t));
      return;
    }
    setEditOpen(false);
    onSuccess(t("finance.updateSuccess"));
    onChanged();
  };

  const handleDelete = async () => {
    setDeleting(true);
    const result = await deleteTransactionAction(transaction.id);
    setDeleting(false);
    if (!result.success) {
      onError(formatRpcError(result.error, t));
      return;
    }
    setDeleteOpen(false);
    onSuccess(t("finance.deleteSuccess"));
    onChanged();
  };

  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        <ActionIconButton label={t("finance.actionView")} onClick={() => setViewOpen(true)}>
          <Eye className="h-4 w-4" />
        </ActionIconButton>
        <ActionIconButton
          label={t("finance.actionEdit")}
          tone="blue"
          disabled={!editable}
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="h-4 w-4" />
        </ActionIconButton>
        <ActionIconButton
          label={t("finance.actionDelete")}
          tone="rose"
          disabled={!deletable}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
        </ActionIconButton>
        <ActionIconButton
          label={t("finance.actionPrint")}
          onClick={() =>
            printLedgerReceipt(transaction, { title: t("finance.receiptTitle") })
          }
        >
          <Printer className="h-4 w-4" />
        </ActionIconButton>
      </div>

      {viewOpen ? (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-lg">
            <div className="app-modal-header flex items-center justify-between">
              <h3 className="font-bold text-app">{t("finance.viewTitle")}</h3>
              <button type="button" onClick={() => setViewOpen(false)} className="text-app-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 p-6 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.columnDate")}</p>
                  <p className="font-medium">
                    {(transaction.transaction_date || transaction.created_at)
                      .slice(0, 16)
                      .replace("T", " ")}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.columnType")}</p>
                  <p className="font-medium">{formatTypeLabel(transaction.type, t)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.columnCategory")}</p>
                  <p className="font-medium">{transaction.category || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.columnAmount")}</p>
                  <p className="font-mono font-bold">
                    {transaction.type === "INCOME" ? "+" : "-"}
                    {transaction.amount.toFixed(2)} AZN
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.columnAccount")}</p>
                  <p className="font-medium">{transaction.account_name || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.columnSource")}</p>
                  <p className="font-medium">
                    {formatReferenceTypeLabel(transaction.reference_type)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.columnDescription")}</p>
                <p className="font-medium">{transaction.description || transaction.notes || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-app-muted">{t("finance.transactionId")}</p>
                <p className="font-mono text-xs text-app-muted">{transaction.id}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex items-center justify-between">
              <h3 className="font-bold text-app">{t("finance.editTitle")}</h3>
              <button type="button" onClick={() => setEditOpen(false)} className="text-app-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4 p-6">
              <label className="block text-sm">
                <span className="text-app-muted">{t("finance.columnCategory")}</span>
                {transaction.type === "EXPENSE" && categories.length > 0 ? (
                  <ExpenseCategorySelect
                    className="input-field mt-1 w-full"
                    categories={categories}
                    value={form.category_id}
                    onChange={(categoryId) => setForm({ ...form, category_id: categoryId })}
                    required
                  />
                ) : (
                  <input
                    className="input-field mt-1 w-full"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    required
                  />
                )}
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">{t("finance.columnAmount")}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="input-field mt-1 w-full"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">{t("finance.columnAccount")}</span>
                <select
                  className="input-field mt-1 w-full"
                  value={form.account_id}
                  onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                >
                  <option value="">{t("expenses.selectAccount")}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">{t("finance.columnDescription")}</span>
                <textarea
                  rows={3}
                  className="input-field mt-1 w-full"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => setEditOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn-primary text-xs" disabled={saving}>
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteModal
        open={deleteOpen}
        loading={deleting}
        message={t("finance.deleteConfirm")}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}
