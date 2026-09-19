import { supabase } from "@/lib/supabase";

export interface EmployeeDepartmentRow {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export function slugifyDepartmentCode(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return ascii || `dept_${Date.now()}`;
}

export async function fetchEmployeeDepartments(
  activeOnly = true
): Promise<EmployeeDepartmentRow[]> {
  let query = supabase
    .from("employee_departments")
    .select("id, code, name, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) {
    console.error("employee_departments fetch:", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    sort_order: Number(row.sort_order) || 0,
    is_active: Boolean(row.is_active),
  }));
}
