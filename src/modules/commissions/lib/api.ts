import { supabase } from "@/lib/supabase";
import type {
  CommissionRule,
  EmployeeCommissionRule,
  SalesCommission,
} from "@/types/database.types";

function mapCommission(row: Record<string, unknown>): SalesCommission {
  return {
    id: row.id as string,
    sale_id: row.sale_id as string,
    employee_id: (row.employee_id as string) || null,
    seller_name: (row.seller_name as string) || null,
    sale_doc_no: (row.sale_doc_no as string) || null,
    product_category: (row.product_category as string) || "Ümumi",
    product_name: (row.product_name as string) || null,
    sale_amount: Number(row.sale_amount) || 0,
    commission_rate: Number(row.commission_rate) || 0,
    commission_amount: Number(row.commission_amount) || 0,
    status: (row.status as "pending" | "paid") || "pending",
    payroll_id: (row.payroll_id as string) || null,
    created_at: (row.created_at as string) || null,
  };
}

export function resolveCommissionRate(
  category: string,
  employeeDefaultRate: number,
  employeeRules: EmployeeCommissionRule[],
  globalRules: CommissionRule[]
): number {
  const cat = category.trim().toLowerCase();

  const empRule = employeeRules.find((r) => r.category_name.toLowerCase() === cat);
  if (empRule) return Number(empRule.commission_rate) || 0;

  if (employeeDefaultRate > 0) return employeeDefaultRate;

  const globalRule = globalRules.find((r) => r.category_name.toLowerCase() === cat);
  if (globalRule) return Number(globalRule.commission_percentage) || 0;

  const generalRule = globalRules.find((r) => r.category_name.toLowerCase() === "ümumi");
  return generalRule ? Number(generalRule.commission_percentage) || 0 : 0;
}

export async function fetchPendingCommissions(): Promise<SalesCommission[]> {
  const { data, error } = await supabase
    .from("sales_commissions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Pending commissions fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => mapCommission(row as Record<string, unknown>));
}

export async function fetchPendingCommissionsForEmployee(
  employeeId: string
): Promise<SalesCommission[]> {
  const { data, error } = await supabase
    .from("sales_commissions")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data || []).map((row) => mapCommission(row as Record<string, unknown>));
}

export async function fetchEmployeeCommissionRules(
  employeeId: string
): Promise<EmployeeCommissionRule[]> {
  const { data, error } = await supabase
    .from("employee_commission_rules")
    .select("*")
    .eq("employee_id", employeeId)
    .order("category_name");

  if (error) return [];
  return (data || []) as EmployeeCommissionRule[];
}

export async function upsertEmployeeCommissionRule(
  employeeId: string,
  categoryName: string,
  commissionRate: number
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await supabase
    .from("employee_commission_rules")
    .select("id")
    .eq("employee_id", employeeId)
    .ilike("category_name", categoryName)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("employee_commission_rules")
      .update({ commission_rate: commissionRate })
      .eq("id", existing.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await supabase.from("employee_commission_rules").insert([
    { employee_id: employeeId, category_name: categoryName, commission_rate: commissionRate },
  ]);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteEmployeeCommissionRule(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("employee_commission_rules").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
