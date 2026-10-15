/**
 * Payroll on the view engine (NEW_UI): a month's payroll run per employee and salary advances,
 * with the classic summary cards. Pure: rows come from the module's fetchPayrollRuns /
 * fetchEmployeeAdvances (same data as the classic tabs on the HR employees screen).
 */
import { countIf, figure, money, sumIf, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export const PAYROLL_VIEW_KEY = "payroll.runs";
export const ADVANCES_VIEW_KEY = "payroll.advances";
type Fetchers = Pick<ModelDef, "fetchAll" | "fetchOne">;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export interface PayrollRecord extends ViewRecord {
  employee_id: string;
  employee_name: string | null;
  employee_code: string | null;
  base_salary: number;
  bonuses: number;
  advances_deducted: number;
  other_deductions: number;
  gross_salary: number;
  dsmf_employee: number;
  its_employee: number;
  income_tax: number;
  net_salary: number;
  employer_cost: number;
  status: "DRAFT" | "APPROVED" | "PAID";
  paid_at: string | null;
}

export function payrollToRecord(row: Record<string, unknown>): PayrollRecord {
  const emp = row.employees as { full_name?: string; employee_code?: string } | null | undefined;
  const status = row.status === "APPROVED" || row.status === "PAID" ? row.status : "DRAFT";
  return {
    id: String(row.id),
    employee_id: String(row.employee_id ?? ""),
    employee_name: emp?.full_name ?? null,
    employee_code: emp?.employee_code ?? null,
    base_salary: num(row.base_salary),
    bonuses: num(row.bonuses_commissions),
    advances_deducted: num(row.advances_deducted),
    other_deductions: num(row.other_deductions),
    gross_salary: num(row.gross_salary),
    dsmf_employee: num(row.dsmf_employee),
    its_employee: num(row.its_employee),
    income_tax: num(row.income_tax),
    net_salary: num(row.net_salary),
    // Gross plus the employer's social and unemployment insurance (the classic employer note).
    employer_cost: Math.round((num(row.gross_salary) + num(row.dsmf_employer) + num(row.its_employer)) * 100) / 100,
    status,
    paid_at: str(row.paid_at),
  };
}

/** Whether a run row can be paid (the classic rule: not paid yet and a positive net salary). */
export const canPayRun = (r: Pick<PayrollRecord, "status" | "net_salary">) => r.status !== "PAID" && r.net_salary > 0;

export function payrollDefinition(fetchers: Fetchers): ViewDefinition<PayrollRecord> {
  return {
    model: { key: PAYROLL_VIEW_KEY, table: "payrolls", module: "payroll", readPermission: "can_view_hr", writePermission: "can_manage_hr", select: "*", order: { field: "employee_name", dir: "asc" }, toRecord: payrollToRecord, ...fetchers },
    titleKey: "employees.tabs.payroll",
    fields: [
      { name: "employee_id", labelKey: "employees.employee", type: "many2one", displayField: "employee_name", searchable: true, groupable: true, readonly: true },
      { name: "employee_code", labelKey: "common.code", type: "char", searchable: true, readonly: true },
      { name: "base_salary", labelKey: "employees.baseSalary", type: "monetary", readonly: true },
      { name: "bonuses", labelKey: "payroll.engine.bonuses", type: "monetary", readonly: true },
      { name: "gross_salary", labelKey: "employees.payroll.gross", type: "monetary", readonly: true },
      { name: "dsmf_employee", labelKey: "employees.payroll.dsmf", type: "monetary", readonly: true },
      { name: "its_employee", labelKey: "employees.payroll.its", type: "monetary", readonly: true },
      { name: "income_tax", labelKey: "employees.payroll.incomeTax", type: "monetary", readonly: true },
      { name: "advances_deducted", labelKey: "employees.advance.deducted", type: "monetary", readonly: true },
      { name: "other_deductions", labelKey: "employees.payroll.otherDeductions", type: "monetary", readonly: true },
      { name: "net_salary", labelKey: "employees.payroll.netSalary", type: "monetary", readonly: true },
      { name: "employer_cost", labelKey: "payroll.engine.employerCost", type: "monetary", readonly: true },
      { name: "paid_at", labelKey: "payroll.engine.paidAt", type: "datetime", readonly: true },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "DRAFT", labelKey: "employees.payroll.statusDRAFT", color: "#94a3b8" },
          { value: "APPROVED", labelKey: "employees.payroll.statusAPPROVED", color: "#0ea5e9" },
          { value: "PAID", labelKey: "employees.payroll.statusPAID", color: "#10b981" },
        ],
      },
    ],
    filters: [
      { key: "to_pay", labelKey: "payroll.engine.toPay", group: "status", conditions: () => [{ field: "status", op: "neq", value: "PAID" }, { field: "net_salary", op: "gt", value: 0 }] },
      { key: "paid", labelKey: "employees.payroll.statusPAID", group: "status", conditions: () => [{ field: "status", op: "eq", value: "PAID" }] },
    ],
    groupBys: ["status", "employee_id"],
    views: ["list", "kanban", "graph"],
    list: { columns: ["employee_id", "gross_salary", "dsmf_employee", "its_employee", "income_tax", "other_deductions", "net_salary", "status"], sums: ["gross_salary", "dsmf_employee", "its_employee", "income_tax", "other_deductions", "net_salary", "employer_cost"] },
    kanban: { groupBy: "status", title: "employee_id", subtitle: "employee_code", amount: "net_salary", fields: ["gross_salary"] },
    form: {
      title: "employee_id",
      statusField: "status",
      fields: ["employee_code", "base_salary", "bonuses", "gross_salary", "dsmf_employee", "its_employee", "income_tax", "advances_deducted", "other_deductions", "net_salary", "employer_cost", "paid_at"],
    },
    graph: { groupBy: "employee_id", measure: "net_salary", type: "bar" },
  };
}

/** The classic cards: rows, net still to pay, paid rows; plus the employer's total cost. */
export function payrollKpis(records: readonly PayrollRecord[], fmt: Formatter): Kpi[] {
  return [
    { key: "rows", label: fmt.t("employees.payroll.totalRows"), value: figure(records.length, fmt) },
    { key: "to_pay", label: fmt.t("employees.payroll.draftTotal"), value: money(sumIf(records, (r) => r.net_salary, (r) => r.status !== "PAID"), fmt, 2), filters: ["to_pay"], filterLabel: fmt.t("payroll.engine.showToPay"), tone: "attention" },
    { key: "paid", label: fmt.t("employees.payroll.paidCount"), value: figure(countIf(records, (r) => r.status === "PAID"), fmt), filters: ["paid"], filterLabel: fmt.t("payroll.engine.showPaid"), tone: "good" },
    { key: "cost", label: fmt.t("payroll.engine.employerCost"), value: money(sumIf(records, (r) => r.employer_cost), fmt, 2), hint: fmt.t("payroll.engine.employerCostHint") },
  ];
}

// ── Advances ─────────────────────────────────────────────────────────────────

export interface AdvanceRecord extends ViewRecord {
  employee_id: string;
  employee_name: string | null;
  amount: number;
  request_date: string;
  status: "PENDING" | "PAID" | "DEDUCTED";
  account_name: string | null;
  description: string | null;
}

export function advanceToRecord(row: Record<string, unknown>): AdvanceRecord {
  const emp = row.employees as { full_name?: string } | null | undefined;
  const acc = row.accounts as { name?: string } | null | undefined;
  return {
    id: String(row.id),
    employee_id: String(row.employee_id ?? ""),
    employee_name: emp?.full_name ?? null,
    amount: num(row.amount),
    request_date: String(row.request_date ?? ""),
    status: row.status === "PAID" || row.status === "DEDUCTED" ? row.status : "PENDING",
    account_name: acc?.name ?? null,
    description: str(row.description),
  };
}

export function advancesDefinition(fetchers: Fetchers): ViewDefinition<AdvanceRecord> {
  return {
    model: { key: ADVANCES_VIEW_KEY, table: "employee_advances", module: "payroll", readPermission: "can_view_hr", writePermission: "can_manage_hr", select: "*", order: { field: "request_date", dir: "desc" }, toRecord: advanceToRecord, ...fetchers },
    titleKey: "employees.tabs.advances",
    fields: [
      { name: "employee_id", labelKey: "employees.employee", type: "many2one", displayField: "employee_name", searchable: true, groupable: true, readonly: true },
      { name: "request_date", labelKey: "employees.advance.requestDate", type: "date", readonly: true },
      { name: "amount", labelKey: "employees.advance.amount", type: "monetary", readonly: true },
      { name: "account_name", labelKey: "employees.advance.paymentAccount", type: "char", groupable: true, readonly: true },
      { name: "description", labelKey: "payroll.engine.description", type: "text", searchable: true, readonly: true },
      {
        name: "status",
        labelKey: "common.status",
        type: "selection",
        groupable: true,
        readonly: true,
        options: [
          { value: "PENDING", labelKey: "employees.advance.statusPENDING", color: "#f59e0b" },
          { value: "PAID", labelKey: "employees.advance.statusPAID", color: "#0ea5e9" },
          { value: "DEDUCTED", labelKey: "employees.advance.statusDEDUCTED", color: "#10b981" },
        ],
      },
    ],
    filters: [{ key: "open", labelKey: "payroll.engine.notDeducted", group: "status", conditions: () => [{ field: "status", op: "neq", value: "DEDUCTED" }] }],
    groupBys: ["status", "employee_id", "account_name", "request_date:month"],
    views: ["list", "kanban", "pivot", "calendar"],
    list: { columns: ["employee_id", "request_date", "amount", "account_name", "status"], sums: ["amount"] },
    kanban: { groupBy: "status", title: "employee_id", amount: "amount", fields: ["request_date"] },
    form: { title: "employee_id", statusField: "status", fields: ["request_date", "amount", "account_name", "description"] },
    pivot: { rows: "employee_id", cols: "request_date:month", measure: "amount" },
    calendar: { dateField: "request_date", title: "employee_id", colorField: "status" },
  };
}

export function advanceKpis(records: readonly AdvanceRecord[], fmt: Formatter): Kpi[] {
  return [
    { key: "open", label: fmt.t("payroll.engine.toDeduct"), value: money(sumIf(records, (r) => r.amount, (r) => r.status !== "DEDUCTED"), fmt, 2), hint: fmt.t("payroll.engine.toDeductHint"), filters: ["open"], filterLabel: fmt.t("payroll.engine.showNotDeducted") },
    { key: "count", label: fmt.t("payroll.engine.advanceCount"), value: figure(records.length, fmt) },
  ];
}
