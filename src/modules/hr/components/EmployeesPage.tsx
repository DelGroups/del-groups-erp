"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import DocumentListSearchBar from "@/components/documents/DocumentListSearchBar";
import EmployeeFormModal, { type EmployeeFormValues } from "./EmployeeFormModal";
import EmployeeDetailModal from "./EmployeeDetailModal";
import LeaveFormModal from "./LeaveFormModal";
import { fetchAccounts, fetchEmployees } from "../lib/employees";
import {
  fetchEmployeeDepartments,
  type EmployeeDepartmentRow,
} from "../lib/employeeDepartments";
import { fetchEmployeeLeaves } from "../lib/leaves";
import {
  createEmployeeAction,
  createEmployeeLeaveAction,
  deleteEmployeeAction,
  updateEmployeeAction,
  updateEmployeeLeaveStatusAction,
} from "../actions/hr";
import EmployeeDepartmentManagerModal from "./EmployeeDepartmentManagerModal";
import type { EmployeesPageTab } from "../lib/employeesPageTabs";
import type { Employee, EmployeeLeave } from "@/types/database.types";
import {
  ANNUAL_PAID_LEAVE_DAYS,
  calcRemainingPaidLeave,
  getDepartmentLabel,
  getEmployeeStatusLabel,
} from "@/types/database.types";
import {
  CalendarDays,
  Eye,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  Users,
  Building2,
} from "lucide-react";
import Button from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/components/auth/AuthProvider";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { ActionsTd, ActionsTh, Table, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";

/** Tabs of HR itself; modules that build on HR add theirs through `extraTabs` (after the directory). */
type HrTab = "directory" | "leaves";

export default function EmployeesPage({ extraTabs = [] }: { extraTabs?: EmployeesPageTab[] }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManageHr = can("can_manage_hr");
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [activeTab, setActiveTab] = useState<string>("directory");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<EmployeeDepartmentRow[]>([]);
  const [departmentsModalOpen, setDepartmentsModalOpen] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; name: string; balance: number }[]>([]);
  const [leaves, setLeaves] = useState<EmployeeLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  /** The "create" form of the open extra tab (see EmployeesPageTabProps). */
  const [extraCreateOpen, setExtraCreateOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [emps, depts, accs, lv] = await Promise.all([
      fetchEmployees(),
      fetchEmployeeDepartments(false),
      fetchAccounts(),
      fetchEmployeeLeaves(),
    ]);
    setEmployees(emps);
    setDepartments(depts);
    setAccounts(accs);
    setLeaves(lv);
    setLoading(false);
  }, []);

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
        getDepartmentLabel(e.department, departments).toLowerCase().includes(q)
    );
  }, [employees, searchTerm, departments]);

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
      ? await updateEmployeeAction(editingEmployee.id, values)
      : await createEmployeeAction(values);
    setSaving(false);
    if (!result.success) {
      showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
      return;
    }
    setFormOpen(false);
    showSuccess(t("employees.saved"));
    void loadData();
  };

  const handleDelete = async (emp: Employee) => {
    if (!confirm(t("common.confirmDelete", { name: emp.full_name }))) return;
    const result = await deleteEmployeeAction(emp.id);
    if (!result.success) showError(t("employees.errorPrefix") + formatRpcError(result.error, t));
    else void loadData();
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

  const tabs: { id: string; label: string; icon: React.ReactNode }[] = [
    { id: "directory" satisfies HrTab, label: t("employees.tabs.directory"), icon: <Users className="h-4 w-4" /> },
    ...extraTabs.map((tab) => ({ id: tab.id, label: t(tab.labelKey), icon: tab.icon })),
    { id: "leaves" satisfies HrTab, label: t("employees.tabs.leaves"), icon: <CalendarDays className="h-4 w-4" /> },
  ];
  const activeExtraTab = extraTabs.find((tab) => tab.id === activeTab);

  const selectTab = (id: string) => {
    setActiveTab(id);
    setExtraCreateOpen(false);
  };

  const headerAction =
    activeTab === "directory"
      ? { label: t("employees.createLabel"), onClick: openCreate }
      : activeExtraTab?.createLabelKey && canManageHr
        ? { label: t(activeExtraTab.createLabelKey), onClick: () => setExtraCreateOpen(true) }
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
        extraActions={
          canManageHr && activeTab === "directory" ? (
            <Button appearance="outline" onClick={() => setDepartmentsModalOpen(true)}>
              <Building2 className="h-4 w-4" />
              {t("employees.departments.manage")}
            </Button>
          ) : undefined
        }
      />

      <main className="app-page-content flex-1 space-y-3 overflow-y-auto md:space-y-4">
        <div className="flex flex-wrap gap-2 border-b border-app pb-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectTab(tab.id)}
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
                <TableWrap className="rounded-none border-0 shadow-none">
                  <Table>
                    <THead>
                      <tr>
                        <Th>{t("common.code")}</Th>
                        <Th>{t("auth.fullName")}</Th>
                        <Th>{t("employees.role")}</Th>
                        <Th>{t("employees.department")}</Th>
                        <Th>{t("common.status")}</Th>
                        <Th className="text-right">{t("employees.baseSalary")}</Th>
                        <ActionsTh>{t("common.actions")}</ActionsTh>
                      </tr>
                    </THead>
                    <tbody className="divide-y divide-slate-100 text-app">
                      {filteredEmployees.map((emp) => (
                        <Tr key={emp.id}>
                          <Td className="font-mono font-bold">{emp.employee_code}</Td>
                          <Td className="font-semibold">{emp.full_name}</Td>
                          <Td>{emp.role || "—"}</Td>
                          <Td>{getDepartmentLabel(emp.department, departments)}</Td>
                          <Td>
                            <StatusBadge status={emp.status} label={getEmployeeStatusLabel(emp.status)} />
                          </Td>
                          <Td numeric className="font-mono font-bold">
                            {emp.base_salary.toFixed(2)} {t("common.currency")}
                          </Td>
                          <ActionsTd>
                            <TableRowActionsMenu
                              items={[
                                {
                                  key: "view",
                                  label: t("employees.viewProfile"),
                                  icon: <Eye className="h-4 w-4" />,
                                  onClick: () => setDetailEmployee(emp),
                                },
                                ...(canManageHr
                                  ? [
                                      {
                                        key: "edit",
                                        label: t("employees.editEmployee"),
                                        icon: <Pencil className="h-4 w-4" />,
                                        onClick: () => openEdit(emp),
                                      },
                                      {
                                        key: "delete",
                                        label: t("common.delete"),
                                        icon: <Trash2 className="h-4 w-4" />,
                                        onClick: () => void handleDelete(emp),
                                        variant: "destructive" as const,
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          </ActionsTd>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </div>
          </>
        )}

        {activeExtraTab && (
          <activeExtraTab.Component
            employees={employees}
            accounts={accounts}
            canManageHr={canManageHr}
            createOpen={extraCreateOpen}
            setCreateOpen={setExtraCreateOpen}
            showError={showError}
            showSuccess={showSuccess}
          />
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
        departments={departments}
        saving={saving}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSaveEmployee}
      />

      <EmployeeDepartmentManagerModal
        isOpen={departmentsModalOpen}
        departments={departments}
        onClose={() => setDepartmentsModalOpen(false)}
        onUpdated={() => void loadData()}
      />

      <EmployeeDetailModal
        employee={detailEmployee}
        departments={departments}
        onClose={() => setDetailEmployee(null)}
        onEdit={canManageHr ? () => detailEmployee && openEdit(detailEmployee) : undefined}
      />

      <LeaveFormModal
        isOpen={leaveModalOpen}
        employees={employees}
        saving={saving}
        onClose={() => setLeaveModalOpen(false)}
        onSubmit={handleCreateLeave}
      />

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
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
