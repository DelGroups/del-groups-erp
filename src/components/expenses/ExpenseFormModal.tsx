"use client";

import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import ExpenseCategorySelect from "@/components/finance/ExpenseCategorySelect";
import type { ExpenseFormOptions } from "@/lib/actions/expenses";
import {
  roundMoney,
  splitGross,
  todayIsoDate,
  type ExpenseDocument,
  type ExpenseSaveInput,
} from "@/lib/expenses/expenseDocuments";

const VAT_RATES = [0, 18];

interface Props {
  options: ExpenseFormOptions;
  /** A draft to edit; omitted for a new expense. */
  initial?: ExpenseDocument | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: ExpenseSaveInput) => void;
}

export default function ExpenseFormModal({ options, initial, saving, onClose, onSubmit }: Props) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => ({
    expenseDate: initial?.expense_date || todayIsoDate(),
    categoryId: initial?.category_id || "",
    accountId: initial?.account_id || "",
    supplierId: initial?.supplier_id || "",
    payee: initial?.payee || "",
    referenceNo: initial?.reference_no || "",
    description: initial?.description || "",
    notes: initial?.notes || "",
    departmentId: initial?.department_id || "",
    amount: initial ? String(initial.amount) : "",
    vatRate: initial ? String(initial.vat_rate || 0) : "0",
  }));
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // The amount typed is what was paid (VAT included); net and VAT are derived from it.
  const totals = useMemo(() => {
    const gross = roundMoney(parseFloat(form.amount.replace(",", ".")) || 0);
    const rate = parseFloat(form.vatRate) || 0;
    const { net, vat } = splitGross(gross, rate);
    return { gross, rate, net, vat };
  }, [form.amount, form.vatRate]);

  const selectedAccount = options.accounts.find((a) => a.id === form.accountId);
  const overdraft = selectedAccount ? totals.gross > selectedAccount.balance + 0.0001 : false;

  const submit = (post: boolean) => {
    setError(null);
    if (!form.expenseDate) return setError(t("expenses.doc.errDate"));
    if (post && form.expenseDate > todayIsoDate()) return setError(t("expenses.doc.errFutureDate"));
    if (!form.categoryId) return setError(t("expenses.selectCategoryAlert"));
    if (post && !form.accountId) return setError(t("expenses.selectAccountAlert"));
    if (totals.gross <= 0 || totals.net <= 0) return setError(t("expenses.invalidAmount"));

    onSubmit({
      id: initial?.id,
      expenseDate: form.expenseDate,
      categoryId: form.categoryId,
      accountId: form.accountId,
      supplierId: form.supplierId || undefined,
      payee: form.supplierId ? undefined : form.payee,
      referenceNo: form.referenceNo,
      description: form.description,
      notes: form.notes,
      departmentId: form.departmentId || undefined,
      netAmount: totals.net,
      vatRate: totals.rate,
      vatAmount: totals.vat,
      post,
    });
  };

  const label = "mb-1 block text-xs font-semibold text-app";
  const input = "app-input text-sm focus:ring-rose-500/40";

  return (
    <div className="app-modal-overlay">
      <div className="app-modal w-full max-w-2xl">
        <div className="app-modal-header flex items-center justify-between bg-app-card-hover">
          <h3 className="font-bold text-app">
            {initial ? t("expenses.doc.editTitle", { code: initial.code }) : t("expenses.addModalTitle")}
          </h3>
          <button type="button" onClick={onClose} className="text-app-muted hover:text-app">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(true);
          }}
          className="max-h-[75vh] space-y-4 overflow-y-auto p-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>{t("expenses.doc.dateRequired")}</label>
              <input
                type="date"
                required
                value={form.expenseDate}
                max={todayIsoDate()}
                onChange={(e) => set("expenseDate", e.target.value)}
                className={input}
              />
            </div>
            <div>
              <label className={label}>{t("expenses.categoryRequired")}</label>
              <ExpenseCategorySelect
                categories={options.categories}
                value={form.categoryId}
                onChange={(id) => set("categoryId", id)}
                className={input}
                required
              />
            </div>

            <div>
              <label className={label}>{t("expenses.doc.supplier")}</label>
              <select
                value={form.supplierId}
                onChange={(e) => set("supplierId", e.target.value)}
                className={input}
              >
                <option value="">{t("expenses.doc.noSupplier")}</option>
                {options.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>{t("expenses.doc.payee")}</label>
              <input
                type="text"
                value={form.supplierId ? "" : form.payee}
                disabled={Boolean(form.supplierId)}
                placeholder={t("expenses.doc.payeePlaceholder")}
                onChange={(e) => set("payee", e.target.value)}
                className={input}
              />
            </div>

            <div>
              <label className={label}>{t("expenses.doc.referenceNo")}</label>
              <input
                type="text"
                value={form.referenceNo}
                placeholder={t("expenses.doc.referencePlaceholder")}
                onChange={(e) => set("referenceNo", e.target.value)}
                className={input}
              />
            </div>
            <div>
              <label className={label}>{t("expenses.doc.department")}</label>
              <select
                value={form.departmentId}
                onChange={(e) => set("departmentId", e.target.value)}
                className={input}
              >
                <option value="">—</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>{t("expenses.doc.description")}</label>
            <input
              type="text"
              value={form.description}
              placeholder={t("expenses.notesPlaceholder")}
              onChange={(e) => set("description", e.target.value)}
              className={input}
            />
          </div>

          <div className="rounded-xl border border-app p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className={label}>{t("expenses.doc.amountPaid")}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  inputMode="decimal"
                  value={form.amount}
                  placeholder="0.00"
                  onChange={(e) => set("amount", e.target.value)}
                  className={`${input} font-bold text-rose-600`}
                />
              </div>
              <div>
                <label className={label}>{t("expenses.doc.vatRate")}</label>
                <select
                  value={form.vatRate}
                  onChange={(e) => set("vatRate", e.target.value)}
                  className={input}
                >
                  {VAT_RATES.map((rate) => (
                    <option key={rate} value={String(rate)}>
                      {rate === 0 ? t("expenses.doc.noVat") : `${rate}%`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-app-muted">{t("expenses.doc.net")}</div>
                <div className="font-semibold text-app">{totals.net.toFixed(2)} AZN</div>
              </div>
              <div>
                <div className="text-app-muted">{t("expenses.doc.vat")}</div>
                <div className="font-semibold text-app">{totals.vat.toFixed(2)} AZN</div>
              </div>
              <div>
                <div className="text-app-muted">{t("expenses.doc.total")}</div>
                <div className="font-bold text-rose-600">{totals.gross.toFixed(2)} AZN</div>
              </div>
            </div>
            {totals.rate > 0 && totals.gross > 0 ? (
              <p className="mt-2 text-[11px] text-app-muted">
                {t("expenses.doc.vatIncludedHint")}
              </p>
            ) : null}
          </div>

          <div>
            <label className={label}>{t("expenses.paymentAccountRequired")}</label>
            <select
              value={form.accountId}
              onChange={(e) => set("accountId", e.target.value)}
              className={input}
            >
              <option value="">{t("expenses.selectAccount")}</option>
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {t("expenses.accountBalance", { name: a.name, balance: a.balance.toFixed(2) })}
                </option>
              ))}
            </select>
            {overdraft ? (
              <p className="mt-1 text-xs font-semibold text-rose-600">{t("expenses.doc.overdraft")}</p>
            ) : null}
          </div>

          <div>
            <label className={label}>{t("expenses.doc.internalNotes")}</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              className={input}
            />
          </div>

          {error ? (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => submit(false)}
              className="rounded-lg border border-rose-300 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {t("expenses.doc.saveDraft")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {t("expenses.doc.saveAndPost")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
