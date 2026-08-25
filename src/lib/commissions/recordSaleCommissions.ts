import { supabase } from "@/lib/supabase";
import type { SaleItem, SalesCommissionInsert } from "@/types/database.types";
import { resolveCommissionRate } from "@/lib/commissions/api";
import { normalizeCommissionRule } from "@/types/database.types";

export async function recordSaleCommissions(
  saleId: string,
  docNo: string,
  sellerId: string | null | undefined,
  sellerName: string | null | undefined,
  items: SaleItem[]
): Promise<void> {
  if (!sellerId && !sellerName) return;

  const validItems = items.filter((i) => i.product_id || i.product_name.trim());
  if (validItems.length === 0) return;

  const productIds = validItems.map((i) => i.product_id).filter(Boolean) as string[];

  const [productsRes, empRes, empRulesRes, globalRulesRes] = await Promise.all([
    productIds.length
      ? supabase.from("products").select("id, category").in("id", productIds)
      : Promise.resolve({ data: [] }),
    sellerId
      ? supabase
          .from("employees")
          .select("id, default_commission")
          .eq("id", sellerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sellerId
      ? supabase.from("employee_commission_rules").select("*").eq("employee_id", sellerId)
      : Promise.resolve({ data: [] }),
    supabase.from("commission_rules").select("*"),
  ]);

  const productCategories = new Map<string, string>(
    (productsRes.data || []).map((p) => [p.id as string, (p.category as string) || "Ümumi"])
  );

  const employeeDefaultRate = Number(empRes.data?.default_commission) || 0;
  const employeeRules = empRulesRes.data || [];
    const globalRules = (globalRulesRes.data || []).map((row) =>
      normalizeCommissionRule(row as Record<string, unknown>)
    );

  const rows = validItems.map((item) => {
    const category = item.product_id
      ? productCategories.get(item.product_id) || "Ümumi"
      : "Ümumi";
    const saleAmount = Number(item.total) || 0;
    const rate = resolveCommissionRate(
      category,
      employeeDefaultRate,
      employeeRules as Parameters<typeof resolveCommissionRate>[2],
      globalRules as Parameters<typeof resolveCommissionRate>[3]
    );
    const commissionAmount = saleAmount * (rate / 100);

    return {
      sale_id: saleId,
      employee_id: sellerId || null,
      seller_name: sellerName || null,
      sale_doc_no: docNo,
      product_category: category,
      product_name: item.product_name || null,
      sale_amount: saleAmount,
      commission_rate: rate,
      commission_amount: commissionAmount,
      status: "pending",
    };
  });

  const withCommission = rows.filter((r) => r.commission_amount > 0);
  if (withCommission.length === 0) return;

  const { error } = await supabase.from("sales_commissions").insert(withCommission as SalesCommissionInsert[]);
  if (error) {
    console.error("Commission record error:", error.message);
  }
}
