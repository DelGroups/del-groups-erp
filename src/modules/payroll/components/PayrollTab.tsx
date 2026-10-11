"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import type { EmployeesPageTabProps } from "@/modules/hr";
import type { PayrollRun } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { payrollRunToBreakdown } from "@/lib/tax/azPayroll";
import { useTaxPayrollConfig } from "@/hooks/useTaxPayrollConfig";
import { fetchPayrollRuns } from "../lib/payrollRuns";
import { calculateMonthlyPayrollAction, payPayrollRunAction } from "../actions/payroll";
import PayPayrollModal from "./PayPayrollModal";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** "Payroll" tab of the employees screen: monthly payroll drafts and paying them. */
export default function PayrollTab({ accounts, canManageHr, showError, showSuccess }: EmployeesPageTabProps) {
  const { t } = useI18n();
  const { config: taxConfig } = useTaxPayrollConfig();

  const now = new Date();
  const [payrollMonth, setPayrollMonth] = useState(now.getMonth() + 1);
  const [payrollYear, setPayrollYear] = useState(now.getFullYear());
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculatingPayroll, setCalculatingPayroll] = useState(false);
  const [payingPayrollId, setPayingPayrollId] = useState<string | null>(null);
  const [payrollToPay, setPayrollToPay] = useState<PayrollRun | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchPayrollRuns(payrollMonth, payrollYear).then((runs) => {
      if (cancelled) return;
      setPayrollRuns(runs);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [payrollMonth, payrollYear, reloadKey]);

  const loadData = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const payrollTotals = useMemo(() => {
    const draft = payrollRuns.filter((p) => p.status !== "PAID");
    return {
      count: payrollRuns.length,
      draftNet: draft.reduce((s, p) => s + p.net_salary, 0),
      paidCount: payrollRuns.filter((p) => p.status === "PAID").length,
    };
  }, [payrollRuns]);

  const handleCalculatePayroll = async () => {
    setCalculatingPayroll(true);
    const result = await calculateMonthlyPayrollAction(payrollMonth, payrollYear);
    setCalculatingPayroll(false);
    if (!result.success) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("employees.payroll.calculated", { count: result.count ?? 0 }));
    loadData();
  };

  const handlePayPayroll = async (accountId: string) => {
    if (!payrollToPay) return;
    setPayingPayrollId(payrollToPay.id);
    const result = await payPayrollRunAction(payrollToPay.id, accountId);
    setPayingPayrollId(null);
    if (!result.success) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("employees.payrollSuccess"));
    setPayrollToPay(null);
    loadData();
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-app bg-app-card p-4">
          <label className="text-xs font-semibold text-app">
            {t("employees.payroll.month")}
            <select
              value={payrollMonth}
              onChange={(e) => {
                setLoading(true);
                setPayrollMonth(Number(e.target.value));
              }}
              className="app-input mt-1 text-sm"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-app">
            {t("employees.payroll.year")}
            <input
              type="number"
              value={payrollYear}
              onChange={(e) => {
                setLoading(true);
                setPayrollYear(Number(e.target.value));
              }}
              className="mt-1 w-24 rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          {canManageHr && (
            <button
              type="button"
              disabled={calculatingPayroll}
              onClick={() => void handleCalculatePayroll()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Calculator className="h-4 w-4" />
              {calculatingPayroll
                ? t("employees.payroll.calculating")
                : t("employees.payroll.calculate")}
            </button>
          )}
          <button
            type="button"
            onClick={loadData}
            className="rounded-lg border px-4 py-2.5 text-xs font-semibold"
          >
            {t("common.refresh")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryCard label={t("employees.payroll.totalRows")} value={String(payrollTotals.count)} />
          <SummaryCard
            label={t("employees.payroll.draftTotal")}
            value={`${payrollTotals.draftNet.toFixed(2)} ${t("common.currency")}`}
          />
          <SummaryCard label={t("employees.payroll.paidCount")} value={String(payrollTotals.paidCount)} />
        </div>

        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-900">
          {t("employees.payroll.ratesHint", {
            dsmfEmployee: taxConfig.dsmf_employee_rate,
            dsmfEmployer: taxConfig.dsmf_employer_rate,
            its: taxConfig.its_rate,
            limit: taxConfig.non_taxable_salary_limit,
          })}
        </p>

        <div className="app-table-wrap">
          {loading ? (
            <div className="p-12 text-center text-xs text-app-muted">{t("common.loading")}</div>
          ) : payrollRuns.length === 0 ? (
            <div className="p-12 text-center text-xs text-app-muted">{t("employees.payroll.empty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                  <tr>
                    <th className="px-4 py-3">{t("employees.employee")}</th>
                    <th className="px-4 py-3 text-right">{t("employees.payroll.gross")}</th>
                    <th className="px-4 py-3 text-right">{t("employees.payroll.dsmf")}</th>
                    <th className="px-4 py-3 text-right">{t("employees.payroll.its")}</th>
                    <th className="px-4 py-3 text-right">{t("employees.payroll.incomeTax")}</th>
                    <th className="px-4 py-3 text-right">{t("employees.payroll.otherDeductions")}</th>
                    <th className="px-4 py-3 text-right">{t("employees.payroll.netSalary")}</th>
                    <th className="px-4 py-3">{t("common.status")}</th>
                    <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payrollRuns.map((row) => {
                    const tax = payrollRunToBreakdown(row, taxConfig);
                    const other = row.advances_deducted + row.other_deductions;
                    return (
                    <tr key={row.id} className="hover:bg-app-card-hover">
                      <td className="px-4 py-3 font-semibold">{row.employees?.full_name || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono">{tax.grossSalary.toFixed(2)}</td>
                      <td
                        className="px-4 py-3 text-right font-mono text-rose-600"
                        title={`${t("tax.employerNote", {
                          dsmf: tax.dsmfEmployer.toFixed(2),
                          its: tax.itsEmployer.toFixed(2),
                          total: (tax.dsmfEmployer + tax.itsEmployer).toFixed(2),
                        })}`}
                      >
                        −{tax.dsmfEmployee.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-rose-600">
                        −{tax.itsEmployee.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-rose-600">
                        −{tax.incomeTax.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-amber-600">
                        −{other.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {row.net_salary.toFixed(2)} {t("common.currency")}
                      </td>
                      <td className="px-4 py-3">
                        <PayrollStatusBadge status={row.status} t={t} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {canManageHr && row.status !== "PAID" && row.net_salary > 0 && (
                          <button
                            type="button"
                            onClick={() => setPayrollToPay(row)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700"
                          >
                            {t("employees.payroll.confirmPay")}
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <PayPayrollModal
        isOpen={!!payrollToPay}
        payroll={payrollToPay}
        accounts={accounts}
        saving={payingPayrollId === payrollToPay?.id}
        onClose={() => setPayrollToPay(null)}
        onSubmit={handlePayPayroll}
      />
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-app bg-app-card p-4">
      <p className="text-[10px] font-bold uppercase text-app-muted">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-app">{value}</p>
    </div>
  );
}

function PayrollStatusBadge({
  status,
  t,
}: {
  status: PayrollRun["status"];
  t: (key: string) => string;
}) {
  const cls =
    status === "PAID"
      ? "bg-emerald-100 text-emerald-800"
      : status === "APPROVED"
        ? "bg-blue-100 text-blue-800"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {t(`employees.payroll.status${status}`)}
    </span>
  );
}
