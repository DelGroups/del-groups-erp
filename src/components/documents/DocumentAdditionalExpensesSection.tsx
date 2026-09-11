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
  "h-9 w-full rounded-md border border-slate-200 bg-app-card px-2 text-sm text-app focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 disabled:opacity-60";

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
      className={`app-card flex flex-col gap-3 rounded-xl p-4 ${className}`.trim()}
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[20%]" />
              <col className="w-[15%]" />
              <col className="w-[20%]" />
              <col className="w-[5%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs font-medium text-slate-700">
                <th className="px-2 pb-2 font-medium">{t("forms.expenseLabel")}</th>
                <th className="px-2 pb-2 font-medium">{t("common.amount")}</th>
                <th className="px-2 pb-2 font-medium">{t("forms.payImmediately")}</th>
                <th className="px-2 pb-2 font-medium">{t("forms.paymentAccount")}</th>
                <th className="px-1 pb-2">
                  <span className="sr-only">{t("common.delete")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((row) => (
                <tr key={row.id} className="align-middle">
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className={FIELD_INPUT}
                      value={row.label}
                      disabled={disabled}
                      placeholder={t("forms.expenseLabelPlaceholder")}
                      onChange={(e) => updateRow(row.id, { label: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={FIELD_INPUT}
                      value={row.amount || ""}
                      disabled={disabled}
                      onChange={(e) => updateRow(row.id, { amount: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <label
                      className="flex h-9 items-center gap-2 whitespace-nowrap"
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
                      <span className="text-xs font-medium text-slate-700">
                        {t("forms.payImmediately")}
                      </span>
                    </label>
                  </td>
                  <td className="px-2 py-1.5">
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
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                      disabled={disabled}
                      aria-label={t("common.delete")}
                      onClick={() => removeRow(row.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
