import { supabase } from "@/lib/supabase";
import { getRecordDate, isDateInRange, resolveReportDateRange } from "@/lib/reports/dateRange";
import type {
  ReportFilters,
  SalesReportData,
  TopSellingProduct,
} from "@/types/database.types";

interface SaleRow {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  created_at: string | null;
  seller_id: string | null;
  seller_name: string | null;
  total_amount: number | null;
}

interface SaleItemRow {
  sale_id: string;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export async function fetchSalesReport(filters: ReportFilters): Promise<SalesReportData> {
  const { startDate, endDate } = resolveReportDateRange(filters);

  const [salesRes, itemsRes, productsRes] = await Promise.all([
    supabase.from("sales").select("id, doc_no, doc_date, created_at, seller_id, seller_name, total_amount"),
    supabase.from("sale_items").select("sale_id, product_id, product_code, product_name, warehouse_id, warehouse_name, quantity, unit_price, line_total"),
    supabase.from("products").select("id, category, buy_price"),
  ]);

  const sales = (salesRes.data as SaleRow[]) || [];
  const allItems = (itemsRes.data as SaleItemRow[]) || [];
  const products = productsRes.data || [];

  const productMeta = new Map(
    products.map((p) => [
      p.id as string,
      { category: (p.category as string) || "Digər", buy_price: Number(p.buy_price) || 0 },
    ])
  );

  const filteredSaleIds = new Set<string>();

  for (const sale of sales) {
    const date = getRecordDate(sale.doc_date, sale.created_at);
    if (!isDateInRange(date, startDate, endDate)) continue;
    if (filters.employeeId && sale.seller_id !== filters.employeeId) continue;
    filteredSaleIds.add(sale.id);
  }

  const productMap = new Map<string, TopSellingProduct>();

  for (const item of allItems) {
    if (!filteredSaleIds.has(item.sale_id)) continue;
    if (filters.warehouseId && item.warehouse_id !== filters.warehouseId) continue;

    const meta = item.product_id ? productMeta.get(item.product_id) : undefined;
    const category = meta?.category || "Digər";
    if (filters.category && category !== filters.category) continue;

    const key = item.product_id || item.product_name || "unknown";
    const qty = Number(item.quantity) || 0;
    const revenue = Number(item.line_total) || qty * (Number(item.unit_price) || 0);
    const unitCost = meta?.buy_price || 0;
    const cost = qty * unitCost;

    const existing = productMap.get(key);
    if (existing) {
      existing.quantity += qty;
      existing.revenue += revenue;
      existing.cost += cost;
      existing.profit = existing.revenue - existing.cost;
      existing.marginPercent =
        existing.revenue > 0 ? (existing.profit / existing.revenue) * 100 : 0;
    } else {
      const profit = revenue - cost;
      productMap.set(key, {
        product_id: item.product_id || "",
        product_name: item.product_name || "Naməlum",
        product_code: item.product_code || "-",
        category,
        quantity: qty,
        revenue,
        cost,
        profit,
        marginPercent: revenue > 0 ? (profit / revenue) * 100 : 0,
      });
    }
  }

  const topProducts = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue);

  const totalVolume = topProducts.reduce((s, p) => s + p.quantity, 0);
  const totalRevenue = topProducts.reduce((s, p) => s + p.revenue, 0);
  const totalCost = topProducts.reduce((s, p) => s + p.cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const invoiceCount = filteredSaleIds.size;

  return {
    topProducts,
    summary: {
      totalVolume,
      totalRevenue,
      totalCost,
      totalProfit,
      averageMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
      invoiceCount,
    },
  };
}
