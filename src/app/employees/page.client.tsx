"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import EmployeeFormModal, { type EmployeeFormValues } from "@/components/hr/EmployeeFormModal";
import EmployeeDetailModal from "@/components/hr/EmployeeDetailModal";
import AdvanceFormModal from "@/components/hr/AdvanceFormModal";
import LeaveFormModal from "@/components/hr/LeaveFormModal";
import PayPayrollModal from "@/components/hr/PayPayrollModal";
import {
  createEmployee,
  deleteEmployee,
  fetchAccounts,
  fetchEmployees,
  updateEmployee,
} from "@/lib/hr/employees";
import {
  fetchEmployeeAdvances,
  fetchEmployeeLeaves,
  fetchPayrollRuns,
} from "@/lib/hr/payroll";
import {
  calculateMonthlyPayrollAction,
  createEmployeeLeaveAction,
  payEmployeeAdvanceAction,
  payPayrollRunAction,
  updateEmployeeLeaveStatusAction,
} from "@/lib/actions/hr";
import type {
  Employee,
  EmployeeAdvance,
  EmployeeLeave,
  PayrollRun,
} from "@/types/database.types";
import {
  ANNUAL_PAID_LEAVE_DAYS,
  calcRemainingPaidLeave,
  getDepartmentLabel,
  getEmployeeStatusLabel,
} from "@/types/database.types";
import {
  Banknote,
  CalendarDays,
  Calculator,
  Eye,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/components/auth/AuthProvider";

type HrTab = "directory" | "payroll" | "advances" | "leaves";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function EmployeesPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManageHr = can("can_manage_hr");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [activeTab, setActiveTab] = useState<HrTab>("directory");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string; balance: number }[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [advances, setAdvances] = useState<EmployeeAdvance[]>([]);
  const [leaves, setLeaves] = useState<EmployeeLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const [payrollMonth, setPayrollMonth] = useState(now.getMonth() + 1);
  const [payrollYear, setPayrollYear] = useState(now.getFullYear());
  const [calculatingPayroll, setCalculatingPayroll] = useState(false);
  const [payingPayrollId, setPayingPayrollId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [payrollToPay, setPayrollToPay] = useState<PayrollRun | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [emps, accs, runs, adv, lv] = await Promise.all([
      fetchEmployees(),
      fetchAccounts(),
      fetchPayrollRuns(payrollMonth, payrollYear),
      fetchEmployeeAdvances(),
      fetchEmployeeLeaves(),
    ]);
    setEmployees(emps);
    setAccounts(accs);
    setPayrollRuns(runs);
    setAdvances(adv);
    setLeaves(lv);
    setLoading(false);
  }, [payrollMonth, payrollYear]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredEmployees = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        (e.fin_code || "").toLowerCase().includes(q) ||
        getDepartmentLabel(e.department).toLowerCase().includes(q)
    );
  }, [employees, searchTerm]);

  const leaveBalanceByEmployee = useMemo(() => {
    const year = new Date().getFullYear();
    const map = new Map<string, number>();
    for (const leave of leaves) {
      if (leave.leave_type !== "PAID" || leave.status !== "APPROVED") continue;
      if (!leave.start_date.startsWith(String(year))) continue;
      map.set(leave.employee_id, (map.get(leave.employee_id) || 0) + leave.days_count);
    }
    return map;
  }, [leaves]);

  const payrollTotals = useMemo(() => {
    const draft = payrollRuns.filter((p) => p.status !== "PAID");
    return {
      count: payrollRuns.length,
      draftNet: draft.reduce((s, p) => s + p.net_salary, 0),
      paidCount: payrollRuns.filter((p) => p.status === "PAID").length,
    };
  }, [payrollRuns]);

  const openCreate = () => {
    setEditingEmployee(null);
    setFormOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormOpen(true);
    setDetailEmployee(null);
  };

  const handleSaveEmployee = async (values: EmployeeFormValues) => {
    setSaving(true);
    const result = editingEmployee
      ? await updateEmployee(editingEmployee.id, values)
      : await createEmployee(values);
    setSaving(false);
    if (!result.ok) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    setFormOpen(false);
    showSuccess(t("employees.saved"));
    void loadData();
  };

  const handleDelete = async (emp: Employee) => {
    if (!confirm(t("common.confirmDelete", { name: emp.full_name }))) return;
    const result = await deleteEmployee(emp.id);
    if (!result.ok) showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
    else void loadData();
  };

  const handleCalculatePayroll = async () => {
    setCalculatingPayroll(true);
    const result = await calculateMonthlyPayrollAction(payrollMonth, payrollYear);
    setCalculatingPayroll(false);
    if (!result.success) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("employees.payroll.calculated", { count: result.count ?? 0 }));
    void loadData();
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
    void loadData();
  };

  const handlePayAdvance = async (payload: {
    employeeId: string;
    amount: number;
    accountId: string;
    description: string;
    requestDate: string;
  }) => {
    setSaving(true);
    const result = await payEmployeeAdvanceAction(payload);
    setSaving(false);
    if (!result.success) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("employees.advance.success"));
    setAdvanceModalOpen(false);
    void loadData();
  };

  const handleCreateLeave = async (payload: {
    employeeId: string;
    leaveType: EmployeeLeave["leave_type"];
    startDate: string;
    endDate: string;
    notes: string;
  }) => {
    setSaving(true);
    const result = await createEmployeeLeaveAction(payload);
    setSaving(false);
    if (!result.success) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("employees.leaves.created"));
    setLeaveModalOpen(false);
    void loadData();
  };

  const handleLeaveStatus = async (leaveId: string, status: EmployeeLeave["status"]) => {
    const result = await updateEmployeeLeaveStatusAction(leaveId, status);
    if (!result.success) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    void loadData();
  };

  const tabs: { id: HrTab; label: string; icon: React.ReactNode }[] = [
    { id: "directory", label: t("employees.tabs.directory"), icon: <Users className="h-4 w-4" /> },
    { id: "payroll", label: t("employees.tabs.payroll"), icon: <Calculator className="h-4 w-4" /> },
    { id: "advances", label: t("employees.tabs.advances"), icon: <Banknote className="h-4 w-4" /> },
    { id: "leaves", label: t("employees.tabs.leaves"), icon: <CalendarDays className="h-4 w-4" /> },
  ];

  const headerAction =
    activeTab === "directory"
      ? { label: t("employees.createLabel"), onClick: openCreate }
      : activeTab === "advances" && canManageHr
        ? { label: t("employees.advance.newTitle"), onClick: () => setAdvanceModalOpen(true) }
        : activeTab === "leaves" && canManageHr
          ? { label: t("employees.leaves.newTitle"), onClick: () => setLeaveModalOpen(true) }
          : undefined;

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<UserCheck className="h-6 w-6 text-indigo-600" />}
        title={t("employees.pageTitle")}
        description={t("employees.pageDescription")}
        createLabel={headerAction?.label}
        onCreate={headerAction?.onClick}
      />

      <main className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="flex flex-wrap gap-2 border-b border-app pb-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
                activeTab === tab.id
                  ? "bg-[image:var(--app-gradient)] text-white"
                  : "bg-app-card-hover text-app-muted hover:text-app"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "directory" && (
          <>
            <DocumentListSearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={t("employees.searchPlaceholder")}
              onRefresh={() => void loadData()}
              loading={loading}
            />
            <div className="app-table-wrap">
              {loading ? (
                <div className="p-12 text-center text-xs text-app-muted">{t("common.loading")}</div>
              ) : filteredEmployees.length === 0 ? (
                <div className="p-12 text-center text-xs text-app-muted">{t("employees.empty")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                      <tr>
                        <th className="px-4 py-3">{t("common.code")}</th>
                        <th className="px-4 py-3">{t("auth.fullName")}</th>
                        <th className="px-4 py-3">{t("employees.role")}</th>
                        <th className="px-4 py-3">{t("employees.department")}</th>
                        <th className="px-4 py-3">{t("common.status")}</th>
                        <th className="px-4 py-3 text-right">{t("employees.baseSalary")}</th>
                        <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-app">
                      {filteredEmployees.map((emp) => (
                        <tr key={emp.id} className="hover:bg-app-card-hover">
                          <td className="px-4 py-3 font-mono font-bold">{emp.employee_code}</td>
                          <td className="px-4 py-3 font-semibold">{emp.full_name}</td>
                          <td className="px-4 py-3">{emp.role || "—"}</td>
                          <td className="px-4 py-3">{getDepartmentLabel(emp.department)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={emp.status} label={getEmployeeStatusLabel(emp.status)} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold">
                            {emp.base_salary.toFixed(2)} {t("common.currency")}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <IconBtn title={t("employees.viewProfile")} onClick={() => setDetailEmployee(emp)}>
                                <Eye className="h-4 w-4" />
                              </IconBtn>
                              {canManageHr && (
                                <>
                                  <IconBtn title={t("employees.editEmployee")} onClick={() => openEdit(emp)}>
                                    <Pencil className="h-4 w-4 text-app-accent" />
                                  </IconBtn>
                                  <IconBtn title={t("common.delete")} onClick={() => void handleDelete(emp)}>
                                    <Trash2 className="h-4 w-4 text-rose-600" />
                                  </IconBtn>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "payroll" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-app bg-app-card p-4">
              <label className="text-xs font-semibold text-app">
                {t("employees.payroll.month")}
                <select
                  value={payrollMonth}
                  onChange={(e) => setPayrollMonth(Number(e.target.value))}
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
                  onChange={(e) => setPayrollYear(Number(e.target.value))}
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
                onClick={() => void loadData()}
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
                        <th className="px-4 py-3 text-right">{t("employees.base")}</th>
                        <th className="px-4 py-3 text-right">{t("employees.commission")}</th>
                        <th className="px-4 py-3 text-right">{t("employees.advance.deducted")}</th>
                        <th className="px-4 py-3 text-right">{t("employees.deduction")}</th>
                        <th className="px-4 py-3 text-right">{t("employees.net")}</th>
                        <th className="px-4 py-3">{t("common.status")}</th>
                        <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payrollRuns.map((row) => (
                        <tr key={row.id} className="hover:bg-app-card-hover">
                          <td className="px-4 py-3 font-semibold">{row.employees?.full_name || "—"}</td>
                          <td className="px-4 py-3 text-right font-mono">{row.base_salary.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-600">
                            +{row.bonuses_commissions.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-amber-600">
                            −{row.advances_deducted.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-rose-600">
                            −{row.other_deductions.toFixed(2)}
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
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "advances" && (
          <div className="app-table-wrap">
            {canManageHr && (
              <div className="flex justify-end border-b border-app px-4 py-3">
                <button
                  type="button"
                  onClick={() => setAdvanceModalOpen(true)}
                  className="flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-3 py-1.5 text-xs font-bold text-white"
                >
                  <Plus className="h-4 w-4" />
                  {t("employees.advance.newTitle")}
                </button>
              </div>
            )}
            {loading ? (
              <div className="p-12 text-center text-xs text-app-muted">{t("common.loading")}</div>
            ) : advances.length === 0 ? (
              <div className="p-12 text-center text-xs text-app-muted">{t("employees.advance.empty")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                    <tr>
                      <th className="px-4 py-3">{t("employees.employee")}</th>
                      <th className="px-4 py-3">{t("employees.advance.requestDate")}</th>
                      <th className="px-4 py-3 text-right">{t("employees.advance.amount")}</th>
                      <th className="px-4 py-3">{t("common.status")}</th>
                      <th className="px-4 py-3">{t("common.account")}</th>
                      <th className="px-4 py-3">{t("common.notes")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {advances.map((adv) => (
                      <tr key={adv.id} className="hover:bg-app-card-hover">
                        <td className="px-4 py-3 font-semibold">{adv.employees?.full_name || "—"}</td>
                        <td className="px-4 py-3">{adv.request_date}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">
                          {adv.amount.toFixed(2)} {t("common.currency")}
                        </td>
                        <td className="px-4 py-3">
                          <AdvanceStatusBadge status={adv.status} t={t} />
                        </td>
                        <td className="px-4 py-3">{adv.accounts?.name || "—"}</td>
                        <td className="px-4 py-3 text-app-muted">{adv.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "leaves" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {employees
                .filter((e) => e.status === "active")
                .map((emp) => {
                  const used = leaveBalanceByEmployee.get(emp.id) || 0;
                  const remaining = calcRemainingPaidLeave(used);
                  return (
                    <div key={emp.id} className="rounded-xl border border-app bg-app-card p-4">
                      <p className="font-bold text-app">{emp.full_name}</p>
                      <p className="text-[11px] text-app-muted">{emp.role || "—"}</p>
                      <div className="mt-3 flex justify-between text-xs">
                        <span className="text-app-muted">{t("employees.leaves.used")}</span>
                        <span className="font-mono font-bold">{used} / {ANNUAL_PAID_LEAVE_DAYS}</span>
                      </div>
                      <div className="mt-1 flex justify-between text-xs">
                        <span className="text-app-muted">{t("employees.leaves.remaining")}</span>
                        <span className="font-mono font-bold text-emerald-600">{remaining}</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="app-table-wrap">
              {canManageHr && (
                <div className="flex justify-end border-b border-app px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setLeaveModalOpen(true)}
                    className="flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-3 py-1.5 text-xs font-bold text-white"
                  >
                    <Plus className="h-4 w-4" />
                    {t("employees.leaves.newTitle")}
                  </button>
                </div>
              )}
              {loading ? (
                <div className="p-12 text-center text-xs text-app-muted">{t("common.loading")}</div>
              ) : leaves.length === 0 ? (
                <div className="p-12 text-center text-xs text-app-muted">{t("employees.leaves.empty")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
                      <tr>
                        <th className="px-4 py-3">{t("employees.employee")}</th>
                        <th className="px-4 py-3">{t("employees.leaves.type")}</th>
                        <th className="px-4 py-3">{t("employees.leaves.period")}</th>
                        <th className="px-4 py-3">{t("employees.leaves.days")}</th>
                        <th className="px-4 py-3">{t("common.status")}</th>
                        {canManageHr && <th className="px-4 py-3 text-center">{t("common.actions")}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {leaves.map((leave) => (
                        <tr key={leave.id} className="hover:bg-app-card-hover">
                          <td className="px-4 py-3 font-semibold">{leave.employees?.full_name || "—"}</td>
                          <td className="px-4 py-3">{leaveTypeLabel(leave.leave_type, t)}</td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            {leave.start_date} → {leave.end_date}
                          </td>
                          <td className="px-4 py-3 font-mono">{leave.days_count}</td>
                          <td className="px-4 py-3">
                            <LeaveStatusBadge status={leave.status} t={t} />
                          </td>
                          {canManageHr && (
                            <td className="px-4 py-3">
                              {leave.status === "PENDING" && (
                                <div className="flex justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void handleLeaveStatus(leave.id, "APPROVED")}
                                    className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800"
                                  >
                                    {t("employees.leaves.approve")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleLeaveStatus(leave.id, "REJECTED")}
                                    className="rounded bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-800"
                                  >
                                    {t("employees.leaves.reject")}
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <EmployeeFormModal
        isOpen={formOpen}
        initial={editingEmployee}
        saving={saving}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSaveEmployee}
      />

      <EmployeeDetailModal
        employee={detailEmployee}
        onClose={() => setDetailEmployee(null)}
        onEdit={canManageHr ? () => detailEmployee && openEdit(detailEmployee) : undefined}
      />

      <AdvanceFormModal
        isOpen={advanceModalOpen}
        employees={employees}
        accounts={accounts}
        saving={saving}
        onClose={() => setAdvanceModalOpen(false)}
        onSubmit={handlePayAdvance}
      />

      <LeaveFormModal
        isOpen={leaveModalOpen}
        employees={employees}
        saving={saving}
        onClose={() => setLeaveModalOpen(false)}
        onSubmit={handleCreateLeave}
      />

      <PayPayrollModal
        isOpen={!!payrollToPay}
        payroll={payrollToPay}
        accounts={accounts}
        saving={payingPayrollId === payrollToPay?.id}
        onClose={() => setPayrollToPay(null)}
        onSubmit={handlePayPayroll}
      />

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-lg p-1.5 text-app-accent hover:bg-[color:var(--app-accent-soft)]"
    >
      {children}
    </button>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const cls =
    status === "active"
      ? "bg-emerald-100 text-emerald-800"
      : status === "on_leave"
        ? "bg-amber-100 text-amber-800"
        : "bg-app-card-hover text-app-muted";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
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

function AdvanceStatusBadge({
  status,
  t,
}: {
  status: EmployeeAdvance["status"];
  t: (key: string) => string;
}) {
  const cls =
    status === "DEDUCTED"
      ? "bg-slate-100 text-slate-700"
      : status === "PAID"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {t(`employees.advance.status${status}`)}
    </span>
  );
}

function leaveTypeLabel(
  type: EmployeeLeave["leave_type"],
  t: (key: string) => string
): string {
  switch (type) {
    case "PAID":
      return t("employees.leaves.typePaid");
    case "UNPAID":
      return t("employees.leaves.typeUnpaid");
    case "SICK":
      return t("employees.leaves.typeSick");
    default:
      return type;
  }
}

function LeaveStatusBadge({
  status,
  t,
}: {
  status: EmployeeLeave["status"];
  t: (key: string) => string;
}) {
  const cls =
    status === "APPROVED"
      ? "bg-emerald-100 text-emerald-800"
      : status === "REJECTED"
        ? "bg-rose-100 text-rose-800"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {t(`employees.leaves.status${status}`)}
    </span>
  );
}
