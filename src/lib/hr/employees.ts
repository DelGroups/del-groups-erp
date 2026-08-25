import { supabase } from "@/lib/supabase";
import type { Employee, EmployeeDbInsert, EmployeeInsert } from "@/types/database.types";
import { normalizeEmployee, toEmployeeDbRow } from "@/types/database.types";

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Employees fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => normalizeEmployee(row as Record<string, unknown>));
}

export async function createEmployee(
  payload: EmployeeInsert
): Promise<{ ok: boolean; error?: string }> {
  const row = toEmployeeDbRow(payload);
  const { error } = await supabase.from("employees").insert([row]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateEmployee(
  id: string,
  payload: Partial<EmployeeInsert>
): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, unknown> = {};

  if (payload.employee_code != null) patch.employee_code = payload.employee_code.trim();
  if (payload.full_name != null) patch.full_name = payload.full_name.trim();
  if (payload.role != null) patch.role = payload.role.trim();
  if (payload.department != null) patch.department = payload.department.trim();
  if (payload.phone !== undefined) patch.phone = payload.phone?.trim() || null;
  if (payload.base_salary != null) patch.base_salary = Number(payload.base_salary) || 0;
  if (payload.default_commission != null) {
    patch.default_commission = Number(payload.default_commission) || 0;
  }
  if (payload.status != null) patch.status = payload.status.trim();

  const { error } = await supabase
    .from("employees")
    .update(patch as Partial<EmployeeDbInsert>)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteEmployee(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchAccounts(): Promise<{ id: string; name: string; balance: number }[]> {
  const { data, error } = await supabase.from("accounts").select("id, name, balance").order("name");
  if (error) return [];
  return (data || []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    balance: Number(a.balance) || 0,
  }));
}
