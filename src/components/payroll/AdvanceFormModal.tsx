"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Employee } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

interface AdvanceFormModalProps {
  isOpen: boolean;
  employees: Employee[];
  accounts: { id: string; name: string; balance: number }[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    employeeId: string;
    amount: number;
    accountId: string;
    description: string;
    requestDate: string;
  }) => void | Promise<void>;
}

export default function AdvanceFormModal({
  isOpen,
  employees,
  accounts,
  saving,
  onClose,
  onSubmit,
}: AdvanceFormModalProps) {
  const { t } = useI18n();
  const [employeeId, setEmployeeId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [requestDate, setRequestDate] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setEmployeeId(employees[0]?.id || "");
    setAccountId(accounts[0]?.id || "");
    setAmount("");
    setDescription("");
    setRequestDate(new Date().toISOString().slice(0, 10));
  }, [isOpen, employees, accounts]);

  if (!isOpen) return null;

  const amountNum = parseFloat(amount) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl app-card shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="font-bold text-app">{t("employees.advance.newTitle")}</h3>
          <button type="button" onClick={onClose} className="text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit({
              employeeId,
              amount: amountNum,
              accountId,
              description,
              requestDate,
            });
          }}
          className="space-y-4 p-5"
        >
          <label className="block text-xs font-semibold text-app">
            {t("employees.employee")} *
            <select
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="app-input mt-1 text-sm"
            >
              <option value="">{t("common.select")}</option>
              {employees
                .filter((e) => e.status === "active")
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
            </select>
          </label>

          <label className="block text-xs font-semibold text-app">
            {t("employees.advance.amount")} *
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
            />
          </label>

          <label className="block text-xs font-semibold text-app">
            {t("employees.advance.paymentAccount")} *
            <select
              required
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="app-input mt-1 text-sm"
            >
              <option value="">{t("common.select")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.balance.toFixed(2)} {t("common.currency")})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold text-app">
            {t("employees.advance.requestDate")}
            <input
              type="date"
              value={requestDate}
              onChange={(e) => setRequestDate(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs font-semibold text-app">
            {t("common.notes")}
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-xs font-semibold">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !employeeId || !accountId || amountNum <= 0}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? t("employees.advance.paying") : t("employees.advance.pay")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
