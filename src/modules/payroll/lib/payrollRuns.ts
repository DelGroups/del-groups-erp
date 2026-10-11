/** Payroll runs and salary advances. */
import { supabase } from "@/lib/supabase";
import type {
  EmployeeAdvance,
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
    gross_salary: Number(row.gross_salary) || 0,
    dsmf_employee: Number(row.dsmf_employee) || 0,
    dsmf_employer: Number(row.dsmf_employer) || 0,
    its_employee: Number(row.its_employee) || 0,
    its_employer: Number(row.its_employer) || 0,
    income_tax: Number(row.income_tax) || 0,
    taxable_income: Number(row.taxable_income) || 0,
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
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Payroll runs fetch error:", error.message);
    return [];
  }

  return (data || [])
    .map((row) => mapPayroll(row as Record<string, unknown>))
    .sort((a, b) =>
      (a.employees?.full_name || "").localeCompare(b.employees?.full_name || "", "az")
    );
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
