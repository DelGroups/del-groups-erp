"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createEmptyDocumentExpense,
  type DocumentAdditionalExpense,
} from "@/lib/forms/documentExpenses";
import { useI18n } from "@/i18n/I18nProvider";

interface AccountOption {
  id: string;
  name: string;
}

interface DocumentAdditionalExpensesSectionProps {
  expenses: DocumentAdditionalExpense[];
  onChange: (expenses: DocumentAdditionalExpense[]) => void;
  accounts: AccountOption[];
  disabled?: boolean;
  className?: string;
}

const FIELD_INPUT =
  "h-9 w-full rounded-lg border border-app bg-app-card px-3 text-xs font-medium text-app focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-[color:var(--app-accent-ring)] disabled:opacity-60";
const FIELD_LABEL = "mb-1 block text-xs font-medium text-app";

export default function DocumentAdditionalExpensesSection({
  expenses,
  onChange,
  accounts,
  disabled = false,
  className = "",
}: DocumentAdditionalExpensesSectionProps) {
  const { t } = useI18n();

  const updateRow = (id: string, patch: Partial<DocumentAdditionalExpense>) => {
    onChange(expenses.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    onChange([...expenses, createEmptyDocumentExpense()]);
  };

  const removeRow = (id: string) => {
    onChange(expenses.filter((row) => row.id !== id));
  };

  return (
    <section
      className={`app-card flex h-full flex-col gap-3 rounded-xl p-4 ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-app pb-2">
        <h3 className="text-sm font-bold text-app">{t("forms.additionalExpenses")}</h3>
        <button
          type="button"
          className="btn-secondary flex shrink-0 items-center gap-1 text-xs"
          disabled={disabled}
          onClick={addRow}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("common.add")}
        </button>
      </div>

      {expenses.length === 0 ? (
        <p className="text-xs text-app-muted">{t("forms.additionalExpensesEmpty")}</p>
      ) : (
        <div className="space-y-3">
          <div
            className="hidden gap-3 px-1 text-[10px] font-semibold uppercase tracking-wide text-app-muted lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,5.5rem)_minmax(0,1.5fr)_2rem]"
          >
            <span>{t("forms.expenseLabel")}</span>
            <span>{t("common.amount")}</span>
            <span className="text-center">{t("forms.paidImmediatelyShort")}</span>
            <span>{t("forms.paymentAccount")}</span>
            <span className="sr-only">{t("common.delete")}</span>
          </div>

          {expenses.map((row) => (
            <div
              key={row.id}
              className="grid gap-3 rounded-xl border border-app bg-app-card-hover p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,5.5rem)_minmax(0,1.5fr)_2rem] lg:items-end"
            >
              <label className="min-w-0">
                <span className={`${FIELD_LABEL} lg:hidden`}>{t("forms.expenseLabel")}</span>
                <input
                  type="text"
                  className={FIELD_INPUT}
                  value={row.label}
                  disabled={disabled}
                  placeholder={t("forms.expenseLabelPlaceholder")}
                  onChange={(e) => updateRow(row.id, { label: e.target.value })}
                />
              </label>

              <label className="min-w-0">
                <span className={`${FIELD_LABEL} lg:hidden`}>{t("common.amount")}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={FIELD_INPUT}
                  value={row.amount || ""}
                  disabled={disabled}
                  onChange={(e) => updateRow(row.id, { amount: Number(e.target.value) || 0 })}
                />
              </label>

              <label
                className="flex h-9 items-center justify-start gap-2 rounded-lg border border-transparent px-1 lg:justify-center"
                title={t("forms.paidImmediately")}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={row.paid_immediately}
                  disabled={disabled}
                  onChange={(e) =>
                    updateRow(row.id, {
                      paid_immediately: e.target.checked,
                      account_id: e.target.checked ? row.account_id : "",
                    })
                  }
                />
                <span className="text-xs font-medium text-app lg:hidden">
                  {t("forms.paidImmediately")}
                </span>
              </label>

              <label className="min-w-0">
                <span className={`${FIELD_LABEL} lg:hidden`}>{t("forms.paymentAccount")}</span>
                <select
                  className={FIELD_INPUT}
                  value={row.account_id}
                  disabled={disabled || !row.paid_immediately}
                  onChange={(e) => updateRow(row.id, { account_id: e.target.value })}
                >
                  <option value="">{t("forms.selectPaymentAccount")}</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center justify-end lg:h-9">
                <button
                  type="button"
                  className="rounded-lg p-2 text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                  disabled={disabled}
                  aria-label={t("common.delete")}
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
