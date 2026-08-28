"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Calculator, X } from "lucide-react";
import type { Employee, SalesCommission } from "@/types/database.types";
import { calcPayrollNet } from "@/types/database.types";
import { fetchPendingCommissionsForEmployee } from "@/lib/commissions/api";
import { useI18n } from "@/i18n/I18nProvider";

interface PayrollModalProps {
  isOpen: boolean;
  employee: Employee | null;
  accounts: { id: string; name: string; balance: number }[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    accountId: string;
    monthYear: string;
    baseSalary: number;
    commissionIds: string[];
    commissionTotal: number;
    deductions: number;
    notes: string;
  }) => void | Promise<void>;
}

export default function PayrollModal({
  isOpen,
  employee,
  accounts,
  saving,
  onClose,
  onSubmit,
}: PayrollModalProps) {
  const { t, intlTag } = useI18n();
  const [pending, setPending] = useState<SalesCommission[]>([]);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [monthYear, setMonthYear] = useState("");
  const [deductions, setDeductions] = useState("0");
  const [notes, setNotes] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen || !employee) return;
    setAccountId(accounts[0]?.id || "");
    setMonthYear(
      new Date().toLocaleDateString(intlTag, { month: "long", year: "numeric" })
    );
    setDeductions("0");
    setNotes("");
    setLoadingCommissions(true);
    void fetchPendingCommissionsForEmployee(employee.id).then((rows) => {
      setPending(rows);
      setSelectedIds(new Set(rows.map((r) => r.id)));
      setLoadingCommissions(false);
    });
  }, [isOpen, employee, accounts, intlTag]);

  const baseSalary = employee?.base_salary || 0;
  const commissionTotal = useMemo(
    () =>
      pending
        .filter((c) => selectedIds.has(c.id))
        .reduce((s, c) => s + c.commission_amount, 0),
    [pending, selectedIds]
  );
  const deductionNum = parseFloat(deductions) || 0;
  const netPay = calcPayrollNet(baseSalary, commissionTotal, deductionNum);

  if (!isOpen || !employee) return null;

  const toggleCommission = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto app-scrim p-4">
      <div className="app-modal my-6 w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-app bg-app-card-hover px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 font-bold text-app">
              <Calculator className="h-5 w-5 text-emerald-600" />
              {t("modals.payroll.title", { name: employee.full_name })}
            </h3>
            <p className="text-[11px] text-app-muted">{t("modals.payroll.subtitle")}</p>
          </div>
          <button type="button" onClick={onClose} className="text-app-muted hover:text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-app bg-app-card-hover p-3">
              <p className="text-[10px] font-bold uppercase text-app-muted">{t("employees.baseSalary")}</p>
              <p className="font-mono text-sm font-bold">{baseSalary.toFixed(2)} {t("common.currency")}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[10px] font-bold uppercase text-emerald-700">{t("employees.commission")}</p>
              <p className="font-mono text-sm font-bold text-emerald-700">
                +{commissionTotal.toFixed(2)} {t("common.currency")}
              </p>
            </div>
            <div className="rounded-xl alert-danger rounded-xl p-3">
              <p className="text-[10px] font-bold uppercase text-rose-700">{t("employees.deduction")}</p>
              <p className="font-mono text-sm font-bold text-rose-700">
                −{deductionNum.toFixed(2)} {t("common.currency")}
              </p>
            </div>
            <div className="rounded-xl border border-app app-toolbar p-3">
              <p className="text-[10px] font-bold uppercase opacity-70">{t("modals.payroll.netPay")}</p>
              <p className="font-mono text-sm font-bold">{netPay.toFixed(2)} {t("common.currency")}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-xs font-semibold text-app">
              {t("modals.payroll.paymentAccount")}
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
              {t("modals.payroll.period")}
              <input
                value={monthYear}
                onChange={(e) => setMonthYear(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("modals.payroll.deductions")}
              <input
                type="number"
                step="0.01"
                min="0"
                value={deductions}
                onChange={(e) => setDeductions(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("common.notes")}
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="overflow-hidden rounded-xl border border-app">
            <div className="border-b border-app bg-app-card-hover px-4 py-2.5">
              <p className="text-xs font-bold text-app">{t("modals.payroll.pendingCommissions")}</p>
            </div>
            {loadingCommissions ? (
              <p className="p-4 text-center text-xs text-app-muted">{t("common.loading")}</p>
            ) : pending.length === 0 ? (
              <p className="p-4 text-center text-xs text-app-muted">{t("modals.payroll.noPending")}</p>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-app-card font-bold uppercase text-app-muted">
                    <tr>
                      <th className="px-3 py-2">{t("modals.payroll.selectCol")}</th>
                      <th className="px-3 py-2">{t("modals.payroll.invoiceCol")}</th>
                      <th className="px-3 py-2">{t("modals.payroll.categoryCol")}</th>
                      <th className="px-3 py-2 text-right">{t("commissions.commissionCol")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pending.map((c) => (
                      <tr key={c.id} className="hover:bg-app-card-hover">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => toggleCommission(c.id)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono">{c.sale_doc_no || "-"}</td>
                        <td className="px-3 py-2">{c.product_category}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold">
                          {c.commission_amount.toFixed(2)} {t("common.currency")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={saving || !accountId || netPay <= 0}
              onClick={() =>
                void onSubmit({
                  accountId,
                  monthYear,
                  baseSalary,
                  commissionIds: pending.filter((c) => selectedIds.has(c.id)).map((c) => c.id),
                  commissionTotal,
                  deductions: deductionNum,
                  notes,
                })
              }
              className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? t("modals.payroll.paying") : t("modals.payroll.confirmPay")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
