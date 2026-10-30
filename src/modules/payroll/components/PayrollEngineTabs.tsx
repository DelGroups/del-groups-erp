"use client";

import React, { useId, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Calculator, Plus } from "lucide-react";
import { useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { useTaxPayrollConfig } from "@/hooks/useTaxPayrollConfig";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { payrollRunToBreakdown } from "@/lib/tax/azPayroll";
import type { PayrollRun } from "@/types/database.types";
import type { EmployeesPageTabProps } from "@/modules/hr";
import { EngineScreen, FormView, invalidateModel, useFormatter, useViewAccess, type FormAction, type ViewData } from "@/views";
import { calculateMonthlyPayrollAction, payEmployeeAdvanceAction, payPayrollRunAction } from "../actions/payroll";
import { fetchEmployeeAdvances, fetchPayrollRuns } from "../lib/payrollRuns";
import { advanceKpis, advancesDefinition, ADVANCES_VIEW_KEY, canPayRun, payrollDefinition, payrollKpis, PAYROLL_VIEW_KEY, payrollToRecord, type PayrollRecord } from "../views/payroll";
import AdvanceFormModal from "./AdvanceFormModal";
import PayPayrollModal from "./PayPayrollModal";
import PayrollTaxBreakdown from "./PayrollTaxBreakdown";
import { dateFormat } from "@/lib/dates/localeDate";

const PAYROLL = payrollDefinition({});
const ADVANCES = advancesDefinition({ fetchAll: async () => (await fetchEmployeeAdvances()) as unknown as Record<string, unknown>[] });

/** A month's payroll on the view engine (new UI): calculate, review taxes per employee, pay. */
export function PayrollEngineTab({ accounts, canManageHr, header }: EmployeesPageTabProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const { config: taxConfig } = useTaxPayrollConfig();
  const access = useViewAccess(PAYROLL);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [calculating, setCalculating] = useState(false);
  const [paying, setPaying] = useState<PayrollRun | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const monthId = useId();
  const yearId = useId();
  // The month's runs, read like the classic tab (one period at a time).
  const runs = useQuery({ queryKey: ["views", PAYROLL_VIEW_KEY, "rows", year, month], queryFn: () => fetchPayrollRuns(month, year), enabled: access.ready && access.read });
  const records = useMemo(() => (runs.data ?? []).map((r) => payrollToRecord(r as unknown as Record<string, unknown>)), [runs.data]);
  const data: ViewData<PayrollRecord> = {
    status: !access.ready ? "loading" : !access.read ? "forbidden" : runs.isError ? "error" : runs.data ? "ready" : "loading",
    definition: PAYROLL,
    records,
    capped: false,
    canWrite: access.write,
    error: runs.error ? runs.error.message : null,
    refetch: () => void runs.refetch(),
  };
  const reload = () => invalidateModel(client, PAYROLL_VIEW_KEY);

  const calculate = async () => {
    setCalculating(true);
    const result = await calculateMonthlyPayrollAction(month, year);
    setCalculating(false);
    if (!result.success) {
      toast(t("common.error"), t("employees.errorPrefix") + formatRpcError(result.error, t), "error");
      return;
    }
    toast(t("employees.payroll.calculated", { count: result.count ?? 0 }), undefined, "success");
    await reload();
  };
  const pay = async (accountId: string) => {
    if (!paying) return;
    setPayBusy(true);
    const result = await payPayrollRunAction(paying.id, accountId);
    setPayBusy(false);
    if (!result.success) {
      toast(t("common.error"), t("employees.errorPrefix") + formatRpcError(result.error, t), "error");
      return;
    }
    toast(t("employees.payrollSuccess"), undefined, "success");
    setPaying(null);
    await reload();
  };

  return (
    <>
      <EngineScreen
        definition={PAYROLL}
        data={data}
        title={t("employees.tabs.payroll")}
        header={
          <>
            {header}
            <p className="rounded-[var(--ds-radius-md)] p-3 text-[length:var(--ds-text-xs)]" style={{ background: "var(--ds-warning-soft)" }}>
              {t("employees.payroll.ratesHint", { dsmfEmployee: taxConfig.dsmf_employee_rate, dsmfEmployer: taxConfig.dsmf_employer_rate, its: taxConfig.its_rate, limit: taxConfig.non_taxable_salary_limit })}
            </p>
          </>
        }
        kpis={(rows, fmt) => payrollKpis(rows, fmt)}
        actions={
          <>
            <span className="flex items-center gap-2">
              <label htmlFor={monthId} className="ds-label">
                {t("employees.payroll.month")}
              </label>
              <select id={monthId} className="ds-input w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {dateFormat(undefined, { month: "long" }).format(new Date(2000, i, 1))}
                  </option>
                ))}
              </select>
            </span>
            <span className="flex items-center gap-2">
              <label htmlFor={yearId} className="ds-label">
                {t("employees.payroll.year")}
              </label>
              <input id={yearId} type="number" className="ds-input w-24" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} />
            </span>
            {canManageHr ? (
              <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={calculating} onClick={() => void calculate()}>
                <Calculator className="h-4 w-4" aria-hidden />
                {calculating ? t("employees.payroll.calculating") : t("employees.payroll.calculate")}
              </button>
            ) : null}
          </>
        }
        recordTitle={(r) => r.employee_name ?? ""}
        renderRecord={(r, { close }) => (
          <PayrollRecordView
            record={r}
            run={(runs.data ?? []).find((x) => x.id === r.id) ?? null}
            taxConfig={taxConfig}
            canPay={canManageHr}
            onPay={(run) => {
              close();
              setPaying(run);
            }}
          />
        )}
      />
      <PayPayrollModal isOpen={!!paying} payroll={paying} accounts={accounts} saving={payBusy} onClose={() => setPaying(null)} onSubmit={pay} />
    </>
  );
}

function PayrollRecordView({ record, run, taxConfig, canPay, onPay }: { record: PayrollRecord; run: PayrollRun | null; taxConfig: ReturnType<typeof useTaxPayrollConfig>["config"]; canPay: boolean; onPay: (run: PayrollRun) => void }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const actions: FormAction[] = run && canPay && canPayRun(record) ? [{ key: "pay", label: t("employees.payroll.confirmPay"), primary: true, icon: <Banknote className="h-4 w-4" aria-hidden />, onClick: () => onPay(run) }] : [];
  return (
    <FormView
      definition={PAYROLL}
      record={record}
      canWrite={false}
      fmt={fmt}
      actions={actions}
      extraTabs={
        run
          ? [{ key: "tax", label: t("payroll.engine.taxBreakdown"), content: <PayrollTaxBreakdown breakdown={payrollRunToBreakdown(run, taxConfig)} advancesDeducted={run.advances_deducted} otherDeductions={run.other_deductions} /> }]
          : []
      }
    />
  );
}

/** Salary advances on the view engine (new UI): new advances are paid out with the classic dialog. */
export function AdvancesEngineTab({ employees, accounts, canManageHr, createOpen, setCreateOpen, header }: EmployeesPageTabProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const fmt = useFormatter();
  const payAdvance = async (payload: { employeeId: string; amount: number; accountId: string; description: string; requestDate: string }) => {
    setSaving(true);
    const result = await payEmployeeAdvanceAction(payload);
    setSaving(false);
    if (!result.success) {
      toast(t("common.error"), t("employees.errorPrefix") + formatRpcError(result.error, t), "error");
      return;
    }
    toast(t("employees.advance.success"), undefined, "success");
    setCreateOpen(false);
    await invalidateModel(client, ADVANCES_VIEW_KEY);
  };
  return (
    <>
      <EngineScreen
        definition={ADVANCES}
        title={t("employees.tabs.advances")}
        header={header}
        kpis={(rows, f) => advanceKpis(rows, f)}
        actions={
          canManageHr ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("employees.advance.newTitle")}
            </button>
          ) : null
        }
        recordTitle={(r) => r.employee_name ?? ""}
        renderRecord={(r) => <FormView definition={ADVANCES} record={r} canWrite={false} fmt={fmt} />}
      />
      <AdvanceFormModal isOpen={createOpen} employees={employees} accounts={accounts} saving={saving} onClose={() => setCreateOpen(false)} onSubmit={payAdvance} />
    </>
  );
}
