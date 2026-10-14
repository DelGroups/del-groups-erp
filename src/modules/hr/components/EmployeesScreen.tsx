"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, PencilLine, Plus, Trash2, XCircle } from "lucide-react";
import { TypeToConfirmDialog, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { getDepartmentLabel, type Employee, type EmployeeLeave } from "@/types/database.types";
import { EngineScreen, FormView, invalidateModel, useFormatter, ViewScope, type FormAction } from "@/views";
import { createEmployeeAction, createEmployeeLeaveAction, deleteEmployeeAction, updateEmployeeAction, updateEmployeeLeaveStatusAction } from "../actions/hr";
import { fetchAccounts, fetchEmployees } from "../lib/employees";
import { fetchEmployeeDepartments } from "../lib/employeeDepartments";
import { fetchEmployeeLeaves } from "../lib/leaves";
import type { EmployeesPageTab } from "../lib/employeesPageTabs";
import { employeeKpis, employeesDefinition, EMPLOYEES_VIEW_KEY, employeeToRecord, leaveKpis, leavesDefinition, LEAVES_VIEW_KEY, paidLeaveUsed, type EmployeeRecord, type LeaveRecord } from "../views/hr";
import EmployeeDepartmentManagerModal from "./EmployeeDepartmentManagerModal";
import EmployeeFormModal, { type EmployeeFormValues } from "./EmployeeFormModal";
import LeaveFormModal from "./LeaveFormModal";

type Row = Record<string, unknown>;
const fetchEmployeeRows = async () => {
  const [employees, leaves] = await Promise.all([fetchEmployees(), fetchEmployeeLeaves()]);
  const used = paidLeaveUsed(leaves as unknown as Row[], new Date());
  return employees.map((e) => employeeToRecord(e as unknown as Row, used)) as unknown as Row[];
};
const LEAVES = leavesDefinition({ fetchAll: async () => (await fetchEmployeeLeaves()) as unknown as Row[] });

/**
 * HR employees on the view engine (new UI): directory and leave requests, plus the tabs of
 * modules built on HR (payroll), passed in by the route as on the classic screen.
 */
export default function EmployeesScreen({ extraTabs = [] }: { extraTabs?: EmployeesPageTab[] }) {
  const params = useSearchParams();
  const tab = params.get("tab") ?? "directory";
  const extra = extraTabs.find((x) => x.id === tab);
  if (extra) return <ExtraTab tab={extra} tabs={extraTabs} />;
  return tab === "leaves" ? <LeavesTab tabs={extraTabs} /> : <DirectoryTab tabs={extraTabs} />;
}

function Tabs({ active, tabs }: { active: string; tabs: EmployeesPageTab[] }) {
  const { t } = useI18n();
  const all = [{ id: "directory", label: t("employees.tabs.directory") }, ...tabs.map((x) => ({ id: x.id, label: t(x.labelKey) })), { id: "leaves", label: t("employees.tabs.leaves") }];
  return (
    <nav aria-label={t("employees.pageTitle")} className="flex gap-4 overflow-x-auto border-b" style={{ borderColor: "var(--ds-border)" }}>
      {all.map((x) => (
        <Link key={x.id} href={x.id === "directory" ? "/employees" : `/employees?tab=${x.id}`} className="ds-tab" aria-current={active === x.id ? "page" : undefined}>
          {x.label}
        </Link>
      ))}
    </nav>
  );
}

function useDepartments() {
  return useQuery({ queryKey: ["hr", "departments"], queryFn: () => fetchEmployeeDepartments(false) });
}

function DirectoryTab({ tabs }: { tabs: EmployeesPageTab[] }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const departments = useDepartments();
  const canManage = can("can_manage_hr");
  const definition = useMemo(() => {
    const rows = departments.data ?? [];
    return employeesDefinition({ fetchAll: fetchEmployeeRows }, rows.map((d) => ({ value: d.code, label: getDepartmentLabel(d.code, rows) })));
  }, [departments.data]);
  // The classic dialogs, opened from the page: new or edit employee, departments.
  const [form, setForm] = useState<{ initial: Employee | null } | null>(null);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const reload = () => invalidateModel(client, EMPLOYEES_VIEW_KEY);

  const save = async (values: EmployeeFormValues) => {
    setSaving(true);
    const result = form?.initial ? await updateEmployeeAction(form.initial.id, values) : await createEmployeeAction(values);
    setSaving(false);
    if (!result.success) {
      toast(t("common.error"), t("employees.errorPrefix") + formatRpcError(result.error, t), "error");
      return;
    }
    setForm(null);
    toast(t("employees.saved"), undefined, "success");
    await reload();
  };

  return (
    <>
      <EngineScreen
        definition={definition}
        title={t("employees.tabs.directory")}
        header={<Tabs active="directory" tabs={tabs} />}
        kpis={(records, fmt, ctx) => employeeKpis(records, fmt, ctx.now)}
        actions={
          canManage ? (
            <>
              <button type="button" className="ds-btn ds-btn-sm" onClick={() => setDepartmentsOpen(true)}>
                <Building2 className="h-4 w-4" aria-hidden />
                {t("hr.engine.departments")}
              </button>
              <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setForm({ initial: null })}>
                <Plus className="h-4 w-4" aria-hidden />
                {t("employees.createLabel")}
              </button>
            </>
          ) : null
        }
        recordTitle={(r) => r.full_name}
        renderRecord={(r, { close }) => (
          <EmployeeRecordView
            record={r}
            definition={definition}
            onEdit={async () => {
              const employee = (await fetchEmployees()).find((e) => e.id === r.id) ?? null;
              close();
              if (employee) setForm({ initial: employee });
            }}
            onDeleted={close}
          />
        )}
      />
      <EmployeeFormModal isOpen={!!form} initial={form?.initial ?? null} departments={departments.data ?? []} saving={saving} onClose={() => setForm(null)} onSubmit={save} />
      <EmployeeDepartmentManagerModal
        isOpen={departmentsOpen}
        departments={departments.data ?? []}
        onClose={() => setDepartmentsOpen(false)}
        onUpdated={() => {
          void departments.refetch();
          void reload();
        }}
      />
    </>
  );
}

function EmployeeRecordView({ record, definition, onEdit, onDeleted }: { record: EmployeeRecord; definition: ReturnType<typeof employeesDefinition>; onEdit: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const client = useQueryClient();
  const { can } = useAuth();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const actions: FormAction[] = can("can_manage_hr")
    ? [
        { key: "edit", label: t("employees.editEmployee"), primary: true, icon: <PencilLine className="h-4 w-4" aria-hidden />, onClick: onEdit },
        { key: "delete", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" aria-hidden />, onClick: () => setDeleting(true) },
      ]
    : [];
  return (
    <>
      <FormView definition={definition} record={record} canWrite={false} fmt={fmt} actions={actions} />
      <TypeToConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        confirmText={record.full_name}
        labels={{
          title: t("common.delete"),
          description: t("common.confirmDelete", { name: record.full_name }),
          instruction: t("hr.engine.typeName"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("common.delete"),
          working: t("common.loading"),
          audit: t("hr.engine.deleteAudit"),
        }}
        onConfirm={async () => {
          const result = await deleteEmployeeAction(record.id);
          if (!result.success) {
            toast(t("common.error"), t("employees.errorPrefix") + formatRpcError(result.error, t), "error");
            return;
          }
          await invalidateModel(client, EMPLOYEES_VIEW_KEY);
          onDeleted();
        }}
      />
    </>
  );
}

function LeavesTab({ tabs }: { tabs: EmployeesPageTab[] }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const employees = useQuery({ queryKey: ["hr", "employees-list"], queryFn: fetchEmployees });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const create = async (payload: { employeeId: string; leaveType: EmployeeLeave["leave_type"]; startDate: string; endDate: string; notes: string }) => {
    setSaving(true);
    const result = await createEmployeeLeaveAction(payload);
    setSaving(false);
    if (!result.success) {
      toast(t("common.error"), t("employees.errorPrefix") + formatRpcError(result.error, t), "error");
      return;
    }
    toast(t("employees.leaves.created"), undefined, "success");
    setCreating(false);
    await Promise.all([invalidateModel(client, LEAVES_VIEW_KEY), invalidateModel(client, EMPLOYEES_VIEW_KEY)]);
  };
  return (
    <>
      <EngineScreen
        definition={LEAVES}
        title={t("employees.tabs.leaves")}
        header={<Tabs active="leaves" tabs={tabs} />}
        kpis={(records, fmt, ctx) => leaveKpis(records, fmt, ctx.now)}
        actions={
          can("can_manage_hr") ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("employees.leaves.newTitle")}
            </button>
          ) : null
        }
        recordTitle={(r) => r.employee_name ?? ""}
        renderRecord={(r) => <LeaveRecordView record={r} />}
      />
      <LeaveFormModal isOpen={creating} employees={employees.data ?? []} saving={saving} onClose={() => setCreating(false)} onSubmit={create} />
    </>
  );
}

function LeaveRecordView({ record }: { record: LeaveRecord }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const client = useQueryClient();
  const { can } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const decide = async (status: EmployeeLeave["status"]) => {
    setBusy(true);
    const result = await updateEmployeeLeaveStatusAction(record.id, status);
    setBusy(false);
    if (!result.success) {
      toast(t("common.error"), t("employees.errorPrefix") + formatRpcError(result.error, t), "error");
      return;
    }
    await Promise.all([invalidateModel(client, LEAVES_VIEW_KEY), invalidateModel(client, EMPLOYEES_VIEW_KEY)]);
  };
  const actions: FormAction[] =
    can("can_manage_hr") && record.status === "PENDING"
      ? [
          { key: "approve", label: t("employees.leaves.approve"), primary: true, disabled: busy, icon: <CheckCircle2 className="h-4 w-4" aria-hidden />, onClick: () => void decide("APPROVED") },
          { key: "reject", label: t("employees.leaves.reject"), disabled: busy, icon: <XCircle className="h-4 w-4" aria-hidden />, onClick: () => void decide("REJECTED") },
        ]
      : [];
  return <FormView definition={LEAVES} record={record} canWrite={false} fmt={fmt} actions={actions} />;
}

/** A tab of a module built on HR (payroll): its own component, as on the classic screen. */
function ExtraTab({ tab, tabs }: { tab: EmployeesPageTab; tabs: EmployeesPageTab[] }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const employees = useQuery({ queryKey: ["hr", "employees-list"], queryFn: fetchEmployees });
  const accounts = useQuery({ queryKey: ["hr", "accounts"], queryFn: fetchAccounts });
  const [createOpen, setCreateOpen] = useState(false);
  const canManage = can("can_manage_hr");
  return (
    <ViewScope>
      <ExtraTabBody tab={tab} tabs={tabs} employees={employees.data ?? []} accounts={accounts.data ?? []} canManage={canManage} createOpen={createOpen} setCreateOpen={setCreateOpen} createLabel={tab.createLabelKey ? t(tab.createLabelKey) : null} />
    </ViewScope>
  );
}

function ExtraTabBody({
  tab,
  tabs,
  employees,
  accounts,
  canManage,
  createOpen,
  setCreateOpen,
  createLabel,
}: {
  tab: EmployeesPageTab;
  tabs: EmployeesPageTab[];
  employees: Employee[];
  accounts: { id: string; name: string; balance: number }[];
  canManage: boolean;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  createLabel: string | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const Component = tab.Component;
  return (
    <div className="flex flex-col gap-4">
      <Tabs active={tab.id} tabs={tabs} />
      {createLabel && canManage ? (
        <button type="button" className="ds-btn ds-btn-sm ds-btn-primary self-end" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {createLabel}
        </button>
      ) : null}
      <Component
        employees={employees}
        accounts={accounts}
        canManageHr={canManage}
        createOpen={createOpen}
        setCreateOpen={setCreateOpen}
        showError={(message) => toast(t("common.error"), message, "error")}
        showSuccess={(message) => toast(message, undefined, "success")}
      />
    </div>
  );
}
