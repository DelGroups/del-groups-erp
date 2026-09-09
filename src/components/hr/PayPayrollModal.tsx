"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { PayrollRun } from "@/types/database.types";
import { payrollRunToBreakdown } from "@/lib/tax/azPayroll";
import PayrollTaxBreakdown from "@/components/hr/PayrollTaxBreakdown";
import { useI18n } from "@/i18n/I18nProvider";

interface PayPayrollModalProps {
  isOpen: boolean;
  payroll: PayrollRun | null;
  accounts: { id: string; name: string; balance: number }[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (accountId: string) => void | Promise<void>;
}

export default function PayPayrollModal({
  isOpen,
  payroll,
  accounts,
  saving,
  onClose,
  onSubmit,
}: PayPayrollModalProps) {
  const { t } = useI18n();
  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setAccountId(accounts[0]?.id || "");
  }, [isOpen, accounts]);

  if (!isOpen || !payroll) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl app-card shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="font-bold text-app">{t("employees.payroll.payTitle")}</h3>
          <button type="button" onClick={onClose} className="text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm font-semibold text-app">
            {payroll.employees?.full_name || "—"}
          </p>
          <PayrollTaxBreakdown
            compact
            breakdown={payrollRunToBreakdown(payroll)}
            advancesDeducted={payroll.advances_deducted}
            otherDeductions={payroll.other_deductions}
          />

          <label className="block text-xs font-semibold text-app">
            {t("employees.payroll.paymentAccount")} *
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

          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-xs font-semibold">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={saving || !accountId || payroll.net_salary <= 0}
              onClick={() => void onSubmit(accountId)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? t("employees.payroll.paying") : t("employees.payroll.confirmPay")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
