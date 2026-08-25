import { supabase } from "@/lib/supabase";
import type { Category, Warehouse } from "@/types/database.types";

export interface ReportFilterOptions {
  warehouses: Warehouse[];
  categories: Category[];
  employees: { id: string; full_name: string }[];
}

export async function fetchReportFilterOptions(): Promise<ReportFilterOptions> {
  const [warehousesRes, categoriesRes, employeesRes] = await Promise.all([
    supabase.from("warehouses").select("*").order("name"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("employees").select("id, full_name").order("full_name"),
  ]);

  const employees = (employeesRes.data || []).map((row) => ({
    id: row.id,
    full_name: row.full_name || "Adsız",
  }));

  return {
    warehouses: (warehousesRes.data as Warehouse[]) || [],
    categories: (categoriesRes.data as Category[]) || [],
    employees,
  };
}
