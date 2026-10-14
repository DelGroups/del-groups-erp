/**
 * HR on the view engine (NEW_UI): the employee directory and leave requests, with dashboard
 * cards. Pure: rows come from the module's fetchEmployees / fetchEmployeeLeaves (same data as
 * the classic screen); the paid-leave rule is the classic one (approved paid days this year).
 */
import { ANNUAL_PAID_LEAVE_DAYS, calcRemainingPaidLeave } from "../../../types/database.types";
import { countIf, figure, money, sumIf, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { ModelDef, SelectionOption, ViewDefinition, ViewRecord } from "../../../views/types";

export const EMPLOYEES_VIEW_KEY = "hr.employees";
export const LEAVES_VIEW_KEY = "hr.leaves";
type Fetchers = Pick<ModelDef, "fetchAll" | "fetchOne">;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export interface EmployeeRecord extends ViewRecord {
  employee_code: string;
  full_name: string;
  role: string;
  department: string;
  status: string;
  phone: string | null;
  base_salary: number;
  default_commission: number;
  fin_code: string | null;
  iban: string | null;
  bank_name: string | null;
  hire_date: string | null;
  contract_end_date: string | null;
  paid_leave_used: number;
  paid_leave_left: number;
}

/** Approved paid-leave days per employee in the year of `now` (the classic leave balance). */
export function paidLeaveUsed(leaves: readonly Record<string, unknown>[], now: Date): Map<string, number> {
  const year = String(now.getFullYear());
  const used = new Map<string, number>();
  for (const l of leaves) {
    if (l.leave_type !== "PAID" || l.status !== "APPROVED") continue;
    if (!String(l.start_date ?? "").startsWith(year)) continue;
    const id = String(l.employee_id);
    used.set(id, (used.get(id) ?? 0) + num(l.days_count));
  }
  return used;
}

export function employeeToRecord(row: Record<string, unknown>, used: ReadonlyMap<string, number> = new Map()): EmployeeRecord {
  const id = String(row.id);
  const taken = used.get(id) ?? 0;
  return {
    id,
    employee_code: String(row.employee_code ?? ""),
    full_name: String(row.full_name ?? ""),
    role: String(row.role ?? ""),
    department: String(row.department ?? ""),
    status: String(row.status ?? "active"),
    phone: str(row.phone),
    base_salary: num(row.base_salary),
    default_commission: num(row.default_commission),
    fin_code: str(row.fin_code),
    iban: str(row.iban),
    bank_name: str(row.bank_name),
    hire_date: str(row.hire_date),
    contract_end_date: str(row.contract_end_date),
    paid_leave_used: taken,
    paid_leave_left: calcRemainingPaidLeave(taken),
  };
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const CONTRACT_WARNING_DAYS = 30;

export function employeesDefinition(fetchers: Fetchers, departments: readonly SelectionOption[] = []): ViewDefinition<EmployeeRecord> {
  return {
    model: { key: EMPLOYEES_VIEW_KEY, table: "employees", module: "hr", readPermission: "can_view_hr", writePermission: "can_manage_hr", select: "*", order: { field: "full_name", dir: "asc" }, toRecord: (r) => employeeToRecord(r), ...fetchers },
    titleKey: "employees.tabs.directory",
    fields: [
      { name: "employee_code", labelKey: "common.code", type: "char", searchable: true, readonly: true },
      { name: "full_name", labelKey: "auth.fullName", type: "char", searchable: true, readonly: true },
      { name: "role", labelKey: "employees.role", type: "char", searchable: true, groupable: true, readonly: true },
      { name: "department", labelKey: "employees.department", type: "selection", options: departments.map((o) => ({ ...o })), searchable: true, groupable: true, readonly: true },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "active", labelKey: "hr.engine.statusActive", color: "#10b981" },
          { value: "on_leave", labelKey: "hr.engine.statusOnLeave", color: "#f59e0b" },
          { value: "inactive", labelKey: "hr.engine.statusInactive", color: "#94a3b8" },
        ],
      },
      { name: "phone", labelKey: "hr.engine.phone", type: "char", searchable: true, readonly: true },
      { name: "fin_code", labelKey: "hr.engine.finCode", type: "char", searchable: true, readonly: true },
      { name: "base_salary", labelKey: "employees.baseSalary", type: "monetary", readonly: true },
      { name: "default_commission", labelKey: "hr.engine.commission", type: "float", readonly: true },
      { name: "hire_date", labelKey: "hr.engine.hireDate", type: "date", readonly: true },
      { name: "contract_end_date", labelKey: "hr.engine.contractEnd", type: "date", readonly: true },
      { name: "bank_name", labelKey: "hr.engine.bank", type: "char", readonly: true },
      { name: "iban", labelKey: "hr.engine.iban", type: "char", readonly: true },
      { name: "paid_leave_used", labelKey: "employees.leaves.used", type: "integer", readonly: true },
      { name: "paid_leave_left", labelKey: "employees.leaves.remaining", type: "integer", readonly: true },
    ],
    filters: [
      { key: "active", labelKey: "hr.engine.statusActive", group: "status", conditions: () => [{ field: "status", op: "eq", value: "active" }] },
      { key: "on_leave", labelKey: "hr.engine.statusOnLeave", group: "status", conditions: () => [{ field: "status", op: "eq", value: "on_leave" }] },
      { key: "inactive", labelKey: "hr.engine.statusInactive", group: "status", conditions: () => [{ field: "status", op: "eq", value: "inactive" }] },
      {
        key: "contract_ending",
        labelKey: "hr.engine.contractEnding",
        group: "contract",
        conditions: (ctx) => [
          { field: "contract_end_date", op: "gte", value: dayStart(ctx.now) },
          { field: "contract_end_date", op: "lt", value: addDays(dayStart(ctx.now), CONTRACT_WARNING_DAYS + 1) },
        ],
      },
    ],
    groupBys: ["department", "status", "role", "hire_date:year"],
    views: ["list", "kanban", "pivot", "graph"],
    list: { columns: ["employee_code", "full_name", "role", "department", "status", "base_salary", "paid_leave_left"], sums: ["base_salary"] },
    kanban: { groupBy: "status", title: "full_name", subtitle: "role", fields: ["department", "phone"] },
    form: {
      title: "full_name",
      statusField: "status",
      fields: ["employee_code", "role", "department", "phone", "fin_code", "hire_date", "contract_end_date", "base_salary", "default_commission"],
      tabs: [
        { key: "bank", labelKey: "hr.engine.bank", fields: ["bank_name", "iban"] },
        { key: "leave", labelKey: "employees.tabs.leaves", fields: ["paid_leave_used", "paid_leave_left"] },
      ],
    },
    pivot: { rows: "department", cols: "status", measure: "base_salary" },
    graph: { groupBy: "department", measure: "__count", type: "bar" },
  };
}

export function employeeKpis(records: readonly EmployeeRecord[], fmt: Formatter, now: Date): Kpi[] {
  const active = records.filter((r) => r.status === "active");
  const today = dayStart(now);
  const limit = addDays(today, CONTRACT_WARNING_DAYS + 1);
  const ending = countIf(records, (r) => {
    if (!r.contract_end_date) return false;
    const d = new Date(`${r.contract_end_date.slice(0, 10)}T00:00:00`);
    return d >= today && d < limit;
  });
  return [
    { key: "active", label: fmt.t("hr.engine.kpi.active"), value: figure(active.length, fmt), hint: fmt.t("hr.engine.kpi.total", { count: records.length }), filters: ["active"], filterLabel: fmt.t("hr.engine.kpi.showActive") },
    { key: "on_leave", label: fmt.t("hr.engine.statusOnLeave"), value: figure(countIf(records, (r) => r.status === "on_leave"), fmt), filters: ["on_leave"], filterLabel: fmt.t("hr.engine.kpi.showOnLeave") },
    { key: "payroll", label: fmt.t("hr.engine.kpi.monthlySalaries"), value: money(sumIf(active, (r) => r.base_salary), fmt), hint: fmt.t("hr.engine.kpi.monthlySalariesHint") },
    { key: "contracts", label: fmt.t("hr.engine.kpi.contractsEnding", { days: CONTRACT_WARNING_DAYS }), value: figure(ending, fmt), filters: ["contract_ending"], filterLabel: fmt.t("hr.engine.kpi.showContractsEnding"), tone: ending ? "attention" : undefined },
  ];
}

// ── Leaves ───────────────────────────────────────────────────────────────────

export interface LeaveRecord extends ViewRecord {
  employee_id: string;
  employee_name: string | null;
  leave_type: "PAID" | "UNPAID" | "SICK";
  start_date: string;
  end_date: string;
  days_count: number;
  status: "APPROVED" | "PENDING" | "REJECTED";
  notes: string | null;
  created_at: string | null;
}

export function leaveToRecord(row: Record<string, unknown>): LeaveRecord {
  const emp = row.employees as { full_name?: string } | null | undefined;
  return {
    id: String(row.id),
    employee_id: String(row.employee_id ?? ""),
    employee_name: emp?.full_name ?? null,
    leave_type: row.leave_type === "UNPAID" || row.leave_type === "SICK" ? row.leave_type : "PAID",
    start_date: String(row.start_date ?? ""),
    end_date: String(row.end_date ?? ""),
    days_count: num(row.days_count),
    status: row.status === "APPROVED" || row.status === "REJECTED" ? row.status : "PENDING",
    notes: str(row.notes),
    created_at: str(row.created_at),
  };
}

export function leavesDefinition(fetchers: Fetchers): ViewDefinition<LeaveRecord> {
  return {
    model: { key: LEAVES_VIEW_KEY, table: "employee_leaves", module: "hr", readPermission: "can_view_hr", writePermission: "can_manage_hr", select: "*", order: { field: "start_date", dir: "desc" }, toRecord: leaveToRecord, ...fetchers },
    titleKey: "employees.tabs.leaves",
    fields: [
      { name: "employee_id", labelKey: "employees.employee", type: "many2one", displayField: "employee_name", searchable: true, groupable: true, readonly: true },
      {
        name: "leave_type",
        labelKey: "employees.leaves.type",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "PAID", labelKey: "employees.leaves.typePaid", color: "#0ea5e9" },
          { value: "UNPAID", labelKey: "employees.leaves.typeUnpaid", color: "#94a3b8" },
          { value: "SICK", labelKey: "employees.leaves.typeSick", color: "#f43f5e" },
        ],
      },
      { name: "start_date", labelKey: "hr.engine.from", type: "date", readonly: true },
      { name: "end_date", labelKey: "hr.engine.to", type: "date", readonly: true },
      { name: "days_count", labelKey: "employees.leaves.days", type: "integer", readonly: true },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "PENDING", labelKey: "employees.leaves.statusPENDING", color: "#f59e0b" },
          { value: "APPROVED", labelKey: "employees.leaves.statusAPPROVED", color: "#10b981" },
          { value: "REJECTED", labelKey: "employees.leaves.statusREJECTED", color: "#f43f5e" },
        ],
      },
      { name: "notes", labelKey: "hr.engine.notes", type: "text", searchable: true, readonly: true },
    ],
    filters: [
      { key: "pending", labelKey: "employees.leaves.statusPENDING", group: "status", conditions: () => [{ field: "status", op: "eq", value: "PENDING" }] },
      { key: "approved", labelKey: "employees.leaves.statusAPPROVED", group: "status", conditions: () => [{ field: "status", op: "eq", value: "APPROVED" }] },
      {
        key: "current",
        labelKey: "hr.engine.onLeaveToday",
        group: "when",
        conditions: (ctx) => [
          { field: "status", op: "eq", value: "APPROVED" },
          { field: "start_date", op: "lte", value: dayStart(ctx.now) },
          { field: "end_date", op: "gte", value: dayStart(ctx.now) },
        ],
      },
      { key: "upcoming", labelKey: "hr.engine.upcoming", group: "when", conditions: (ctx) => [{ field: "start_date", op: "gt", value: dayStart(ctx.now) }] },
    ],
    groupBys: ["status", "leave_type", "employee_id", "start_date:month"],
    views: ["list", "kanban", "calendar", "pivot"],
    list: { columns: ["employee_id", "leave_type", "start_date", "end_date", "days_count", "status"], sums: ["days_count"] },
    kanban: { groupBy: "status", title: "employee_id", subtitle: "leave_type", fields: ["start_date", "end_date", "days_count"] },
    form: { title: "employee_id", statusField: "status", fields: ["leave_type", "start_date", "end_date", "days_count", "notes"] },
    pivot: { rows: "employee_id", cols: "leave_type", measure: "days_count" },
    calendar: { dateField: "start_date", title: "employee_id", colorField: "leave_type" },
  };
}

export function leaveKpis(records: readonly LeaveRecord[], fmt: Formatter, now: Date): Kpi[] {
  const today = dayStart(now);
  const day = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);
  const year = String(now.getFullYear());
  return [
    { key: "pending", label: fmt.t("hr.engine.kpi.pendingLeaves"), value: figure(countIf(records, (r) => r.status === "PENDING"), fmt), filters: ["pending"], filterLabel: fmt.t("hr.engine.kpi.showPendingLeaves"), tone: records.some((r) => r.status === "PENDING") ? "attention" : undefined },
    { key: "today", label: fmt.t("hr.engine.onLeaveToday"), value: figure(countIf(records, (r) => r.status === "APPROVED" && day(r.start_date) <= today && day(r.end_date) >= today), fmt), filters: ["current"], filterLabel: fmt.t("hr.engine.kpi.showOnLeaveToday") },
    { key: "paid_days", label: fmt.t("hr.engine.kpi.paidDaysYear"), value: figure(sumIf(records, (r) => r.days_count, (r) => r.leave_type === "PAID" && r.status === "APPROVED" && r.start_date.startsWith(year)), fmt), hint: fmt.t("hr.engine.kpi.annualAllowance", { days: ANNUAL_PAID_LEAVE_DAYS }) },
    { key: "sick", label: fmt.t("hr.engine.kpi.sickDaysYear"), value: figure(sumIf(records, (r) => r.days_count, (r) => r.leave_type === "SICK" && r.status === "APPROVED" && r.start_date.startsWith(year)), fmt) },
  ];
}
