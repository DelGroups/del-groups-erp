"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { PayrollRun } from "@/types/database.types";
import { payrollRunToBreakdown } from "@/lib/tax/azPayroll";
import PayrollTaxBreakdown from "./PayrollTaxBreakdown";
import { useI18n } from "@/i18n/I18nProvider";
import { EntityLookup } from "@/components/lookups";
import { useUiStandard } from "@/design-system/components";
import { PaymentDialog } from "@/components/payments/PaymentDialog";

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
  // UI_STANDARD (UI-2 lookups): lookups through EntityLookup with quick-create.
  const uiStandard = useUiStandard();
  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setAccountId(accounts[0]?.id || "");
  }, [isOpen, accounts]);

  if (!isOpen || !payroll) return null;

  // IMP-5 (UI_STANDARD): the one payment dialog. pay_payroll_run_atomic takes one account, so the
  // salary is paid from one account here (the net salary, fixed).
  if (uiStandard) {
    return (
      <PaymentDialog
        open
        onClose={onClose}
        direction="out"
        title={t("employees.payroll.payTitle")}
        counterpartyLabel={t("paymentDialog.employee")}
        counterpartyName={payroll.employees?.full_name || "—"}
        counterpartyCode={null}
        openBalance={payroll.net_salary}
        fixedAmount={payroll.net_salary}
        maxLines={1}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance }))}
        extraFields={
          <PayrollTaxBreakdown compact breakdown={payrollRunToBreakdown(payroll)} advancesDeducted={payroll.advances_deducted} otherDeductions={payroll.other_deductions} />
        }
        submitLabel={t("employees.payroll.confirmPay")}
        onSubmit={async (p) => {
          const accountId = p.lines[0]?.account_id;
          if (!accountId) return { success: false };
          await onSubmit(accountId);
          return { success: true };
        }}
      />
    );
  }

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
            {uiStandard ? (
              <div className="mt-1">
                <EntityLookup
                  entity="account"
                  value={accountId}
                  selectedLabel={accounts.find((a) => a.id === accountId)?.name}
                  required
                  aria-label={t("lookup.entities.account")}
                  onChange={(id) => setAccountId(id ?? "")}
                />
              </div>
            ) : (
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
            )}
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
