import { supabase } from "@/lib/supabase";
import type { EmployeeLeave } from "@/types/database.types";

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
