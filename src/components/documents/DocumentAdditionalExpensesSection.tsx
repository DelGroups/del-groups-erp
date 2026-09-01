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
    <section className={`app-card flex h-full flex-col space-y-3 p-4 ${className}`.trim()}>
      <div className="flex items-center justify-between border-b border-app pb-2">
        <h3 className="text-sm font-bold text-app">{t("forms.additionalExpenses")}</h3>
        <button
          type="button"
          className="btn-secondary flex items-center gap-1 text-xs"
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
        <div className="space-y-2">
          {expenses.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 rounded-lg border border-app p-3 md:grid-cols-12"
            >
              <label className="space-y-1 text-xs md:col-span-3">
                <span className="font-semibold text-app">{t("forms.expenseLabel")}</span>
                <input
                  type="text"
                  className="app-input w-full"
                  value={row.label}
                  disabled={disabled}
                  placeholder={t("forms.expenseLabelPlaceholder")}
                  onChange={(e) => updateRow(row.id, { label: e.target.value })}
                />
              </label>
              <label className="space-y-1 text-xs md:col-span-2">
                <span className="font-semibold text-app">{t("common.amount")}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="app-input w-full"
                  value={row.amount || ""}
                  disabled={disabled}
                  onChange={(e) => updateRow(row.id, { amount: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="flex items-end gap-2 text-xs md:col-span-2">
                <input
                  type="checkbox"
                  checked={row.paid_immediately}
                  disabled={disabled}
                  onChange={(e) =>
                    updateRow(row.id, {
                      paid_immediately: e.target.checked,
                      account_id: e.target.checked ? row.account_id : "",
                    })
                  }
                />
                <span className="pb-2 font-semibold text-app">{t("forms.paidImmediately")}</span>
              </label>
              <label className="space-y-1 text-xs md:col-span-4">
                <span className="font-semibold text-app">{t("modals.payment.account")}</span>
                <select
                  className="app-input w-full"
                  value={row.account_id}
                  disabled={disabled || !row.paid_immediately}
                  onChange={(e) => updateRow(row.id, { account_id: e.target.value })}
                >
                  <option value="">{t("modals.payment.selectAccount")}</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end justify-end md:col-span-1">
                <button
                  type="button"
                  className="rounded-lg p-2 text-red-500 hover:bg-red-500/10"
                  disabled={disabled}
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
