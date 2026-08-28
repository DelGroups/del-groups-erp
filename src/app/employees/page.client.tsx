"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import EmployeeFormModal, {
  type EmployeeFormValues,
} from "@/components/hr/EmployeeFormModal";
import PayrollModal from "@/components/hr/PayrollModal";
import {
  createEmployee,
  deleteEmployee,
  fetchAccounts,
  fetchEmployees,
  updateEmployee,
} from "@/lib/hr/employees";
import { processPayrollAction } from "@/lib/actions/payroll";
import { supabase } from "@/lib/supabase";
import type { Employee, PayrollRecord } from "@/types/database.types";
import {
  getDepartmentLabel,
  getEmployeeStatusLabel,
} from "@/types/database.types";
import { DollarSign, Pencil, Trash2, UserCheck } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export default function EmployeesPage() {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string; balance: number }[]>([]);
  const [payrollHistory, setPayrollHistory] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [saving, setSaving] = useState(false);
  const [payrollSaving, setPayrollSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [payrollEmployee, setPayrollEmployee] = useState<Employee | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [emps, accs] = await Promise.all([fetchEmployees(), fetchAccounts()]);
    setEmployees(emps);
    setAccounts(accs);

    const { data: payData } = await supabase
      .from("salary_payments")
      .select("*, employees(full_name), accounts(name)")
      .order("created_at", { ascending: false })
      .limit(20);

    setPayrollHistory((payData as PayrollRecord[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        getDepartmentLabel(e.department).toLowerCase().includes(q)
    );
  }, [employees, searchTerm]);

  const openCreate = () => {
    setEditingEmployee(null);
    setFormOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setFormOpen(true);
  };

  const handleSaveEmployee = async (values: EmployeeFormValues) => {
    setSaving(true);
    const payload = {
      employee_code: values.employee_code,
      full_name: values.full_name,
      role: values.role,
      department: values.department,
      phone: values.phone,
      base_salary: values.base_salary,
      default_commission: values.default_commission,
      status: values.status,
    };

    const result = editingEmployee
      ? await updateEmployee(editingEmployee.id, payload)
      : await createEmployee(payload);

    setSaving(false);
    if (!result.ok) {
      alert(t("employees.errorPrefix") + result.error);
      return;
    }
    setFormOpen(false);
    void loadData();
  };

  const handleDelete = async (emp: Employee) => {
    if (!confirm(t("common.confirmDelete", { name: emp.full_name }))) return;
    const result = await deleteEmployee(emp.id);
    if (!result.ok) alert(t("employees.errorPrefix") + result.error);
    else void loadData();
  };

  const handlePayroll = async (payload: {
    accountId: string;
    monthYear: string;
    baseSalary: number;
    commissionIds: string[];
    commissionTotal: number;
    deductions: number;
    notes: string;
  }) => {
    if (!payrollEmployee) return;
    setPayrollSaving(true);
    const result = await processPayrollAction({
      employeeId: payrollEmployee.id,
      accountId: payload.accountId,
      monthYear: payload.monthYear,
      baseSalary: payload.baseSalary,
      commissionIds: payload.commissionIds,
      commissionTotal: payload.commissionTotal,
      deductions: payload.deductions,
      notes: payload.notes,
    });
    setPayrollSaving(false);

    if (!result.success) {
      alert(t("employees.errorPrefix") + result.error);
      return;
    }

    alert(t("employees.payrollSuccess"));
    setPayrollEmployee(null);
    void loadData();
  };

  return (
    <PageLayout>
        <DocumentPageHeader
          icon={<UserCheck className="h-6 w-6 text-indigo-600" />}
          title={t("employees.pageTitle")}
          description={t("employees.pageDescription")}
          createLabel={t("employees.createLabel")}
          onCreate={openCreate}
        />

        <main className="flex-1 space-y-4 overflow-y-auto p-6">
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
            ) : filtered.length === 0 ? (
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
                      <th className="px-4 py-3 text-right">{t("employees.commissionPercent")}</th>
                      <th className="px-4 py-3 text-center">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-app">
                    {filtered.map((emp) => (
                      <tr key={emp.id} className="hover:bg-app-card-hover">
                        <td className="px-4 py-3 font-mono font-bold">{emp.employee_code}</td>
                        <td className="px-4 py-3 font-semibold text-app">{emp.full_name}</td>
                        <td className="px-4 py-3">{emp.role || "-"}</td>
                        <td className="px-4 py-3">{getDepartmentLabel(emp.department)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              emp.status === "active"
                                ? "bg-emerald-100 text-emerald-800"
                                : emp.status === "on_leave"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-app-card-hover text-app-muted"
                            }`}
                          >
                            {getEmployeeStatusLabel(emp.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold">
                          {emp.base_salary.toFixed(2)} AZN
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-app-accent">
                          %{emp.default_commission.toFixed(1)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              title={t("employees.calculatePayroll")}
                              onClick={() => setPayrollEmployee(emp)}
                              className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-500/10"
                            >
                              <DollarSign className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title={t("employees.editEmployee")}
                              onClick={() => openEdit(emp)}
                              className="rounded-lg p-1.5 text-app-accent hover:bg-[color:var(--app-accent-soft)]"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title={t("common.delete")}
                              onClick={() => void handleDelete(emp)}
                              className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="app-table-wrap">
            <div className="border-b border-app px-5 py-4">
              <h3 className="text-sm font-bold text-app">{t("employees.recentPayroll")}</h3>
            </div>
            {payrollHistory.length === 0 ? (
              <div className="p-8 text-center text-xs text-app-muted">{t("employees.emptyPayroll")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
                    <tr>
                      <th className="px-4 py-2.5">{t("employees.employee")}</th>
                      <th className="px-4 py-2.5">{t("employees.period")}</th>
                      <th className="px-4 py-2.5 text-right">{t("employees.base")}</th>
                      <th className="px-4 py-2.5 text-right">{t("employees.commission")}</th>
                      <th className="px-4 py-2.5 text-right">{t("employees.deduction")}</th>
                      <th className="px-4 py-2.5 text-right">{t("employees.net")}</th>
                      <th className="px-4 py-2.5">{t("common.account")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payrollHistory.map((p) => (
                      <tr key={p.id} className="hover:bg-app-card-hover">
                        <td className="px-4 py-2.5 font-semibold">{p.employees?.full_name || "-"}</td>
                        <td className="px-4 py-2.5">{p.month_year}</td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {Number(p.base_salary || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-emerald-600">
                          {Number(p.commission_total || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-rose-600">
                          {Number(p.deductions || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold">
                          {Number(p.net_amount || p.amount || 0).toFixed(2)} AZN
                        </td>
                        <td className="px-4 py-2.5">{p.accounts?.name || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>

      <EmployeeFormModal
        isOpen={formOpen}
        initial={editingEmployee}
        saving={saving}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSaveEmployee}
      />

      <PayrollModal
        isOpen={!!payrollEmployee}
        employee={payrollEmployee}
        accounts={accounts}
        saving={payrollSaving}
        onClose={() => setPayrollEmployee(null)}
        onSubmit={handlePayroll}
      />
    </PageLayout>
  );
}
