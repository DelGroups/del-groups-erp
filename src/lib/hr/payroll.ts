import { supabase } from "@/lib/supabase";
import type {
  EmployeeAdvance,
  EmployeeLeave,
  PayrollRun,
} from "@/types/database.types";

function mapAdvance(row: Record<string, unknown>): EmployeeAdvance {
  return {
    id: row.id as string,
    employee_id: row.employee_id as string,
    amount: Number(row.amount) || 0,
    request_date: row.request_date as string,
    status: (row.status as EmployeeAdvance["status"]) || "PENDING",
    account_id: (row.account_id as string) || null,
    transaction_id: (row.transaction_id as string) || null,
    description: (row.description as string) || null,
    created_at: (row.created_at as string) || null,
    employees: row.employees as EmployeeAdvance["employees"],
    accounts: row.accounts as EmployeeAdvance["accounts"],
  };
}

function mapLeave(row: Record<string, unknown>): EmployeeLeave {
  return {
    id: row.id as string,
    employee_id: row.employee_id as string,
    leave_type: (row.leave_type as EmployeeLeave["leave_type"]) || "PAID",
    start_date: row.start_date as string,
    end_date: row.end_date as string,
    days_count: Number(row.days_count) || 0,
    status: (row.status as EmployeeLeave["status"]) || "PENDING",
    notes: (row.notes as string) || null,
    created_at: (row.created_at as string) || null,
    employees: row.employees as EmployeeLeave["employees"],
  };
}

function mapPayroll(row: Record<string, unknown>): PayrollRun {
  return {
    id: row.id as string,
    period_month: Number(row.period_month) || 1,
    period_year: Number(row.period_year) || new Date().getFullYear(),
    employee_id: row.employee_id as string,
    base_salary: Number(row.base_salary) || 0,
    bonuses_commissions: Number(row.bonuses_commissions) || 0,
    advances_deducted: Number(row.advances_deducted) || 0,
    other_deductions: Number(row.other_deductions) || 0,
    net_salary: Number(row.net_salary) || 0,
    status: (row.status as PayrollRun["status"]) || "DRAFT",
    paid_at: (row.paid_at as string) || null,
    account_id: (row.account_id as string) || null,
    transaction_id: (row.transaction_id as string) || null,
    notes: (row.notes as string) || null,
    created_at: (row.created_at as string) || null,
    employees: row.employees as PayrollRun["employees"],
  };
}

export async function fetchPayrollRuns(
  month: number,
  year: number
): Promise<PayrollRun[]> {
  const { data, error } = await supabase
    .from("payrolls")
    .select("*, employees(full_name, employee_code)")
    .eq("period_month", month)
    .eq("period_year", year)
    .order("employees(full_name)");

  if (error) {
    console.error("Payroll runs fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => mapPayroll(row as Record<string, unknown>));
}

export async function fetchEmployeeAdvances(): Promise<EmployeeAdvance[]> {
  const { data, error } = await supabase
    .from("employee_advances")
    .select("*, employees(full_name), accounts(name)")
    .order("request_date", { ascending: false });

  if (error) {
    console.error("Employee advances fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => mapAdvance(row as Record<string, unknown>));
}

export async function fetchEmployeeLeaves(): Promise<EmployeeLeave[]> {
  const { data, error } = await supabase
    .from("employee_leaves")
    .select("*, employees(full_name)")
    .order("start_date", { ascending: false });

  if (error) {
    console.error("Employee leaves fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => mapLeave(row as Record<string, unknown>));
}

export async function fetchApprovedPaidLeaveDaysForYear(
  employeeId: string,
  year: number
): Promise<number> {
  const { data, error } = await supabase
    .from("employee_leaves")
    .select("days_count")
    .eq("employee_id", employeeId)
    .eq("leave_type", "PAID")
    .eq("status", "APPROVED")
    .gte("start_date", `${year}-01-01`)
    .lte("start_date", `${year}-12-31`);

  if (error) return 0;
  return (data || []).reduce((sum, row) => sum + (Number(row.days_count) || 0), 0);
}
