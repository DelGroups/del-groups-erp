import { supabase } from "@/lib/supabase";
import {
  getDateRangeBounds,
  getRecordDate,
  getTransactionDate,
  isDateInRange,
} from "@/lib/reports/dateRange";
import type {
  DashboardData,
  LowStockProduct,
  MonthlyTrendPoint,
  RecentActivityRow,
} from "@/types/database.types";

function monthLabel(year: number, month: number): string {
  const d = new Date(year, month, 1);
  return d.toLocaleDateString("az-AZ", { month: "short", year: "numeric" });
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const monthRange = getDateRangeBounds("month");
  const now = new Date();

  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const trendStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

  const [salesRes, purchasesRes, transactionsRes, trendTxRes, productsRes] = await Promise.all([
    supabase
      .from("sales")
      .select("id, doc_no, doc_date, created_at, customer_name, total_amount, remaining_balance"),
    supabase
      .from("purchases")
      .select("id, invoice_number, doc_date, created_at, supplier_id, total_amount, debt_amount"),
    supabase
      .from("transactions")
      .select("id, type, amount, category, notes, created_at, accounts(name)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("transactions")
      .select("type, amount, created_at")
      .gte("created_at", `${trendStart}T00:00:00`),
    supabase
      .from("products")
      .select("id, code, name, stock, min_stock, unit, category, buy_price, sell_price"),
  ]);

  const sales = salesRes.data || [];
  const purchases = purchasesRes.data || [];
  const transactions = transactionsRes.data || [];
  const trendTransactions = trendTxRes.data || [];
  const products = productsRes.data || [];

  let monthlyRevenue = 0;
  let customerDebts = 0;

  for (const sale of sales) {
    const date = getRecordDate(sale.doc_date, sale.created_at);
    if (isDateInRange(date, monthRange.startDate, monthRange.endDate)) {
      monthlyRevenue += Number(sale.total_amount) || 0;
    }
    customerDebts += Math.max(0, Number(sale.remaining_balance) || 0);
  }

  let supplierDebts = 0;
  for (const purchase of purchases) {
    supplierDebts += Math.max(0, Number(purchase.debt_amount) || 0);
  }

  let monthlyExpenses = 0;
  for (const tx of trendTransactions) {
    const date = getTransactionDate(tx.created_at as string);
    if (!isDateInRange(date, monthRange.startDate, monthRange.endDate)) continue;
    if (tx.type === "Məxaric") {
      monthlyExpenses += Number(tx.amount) || 0;
    }
  }

  const netProfit = monthlyRevenue - monthlyExpenses;

  const lowStockAlerts: LowStockProduct[] = products
    .filter((p) => {
      const stock = Number(p.stock) || 0;
      const min = Number(p.min_stock) || 0;
      return stock <= min;
    })
    .map((p) => ({
      id: p.id as string,
      code: (p.code as string) || "",
      name: (p.name as string) || "",
      stock: Number(p.stock) || 0,
      min_stock: Number(p.min_stock) || 0,
      unit: (p.unit as string) || "Ədəd",
      category: (p.category as string) || "",
    }))
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 12);

  const recentActivities: RecentActivityRow[] = [];

  for (const sale of sales.slice(0, 15)) {
    recentActivities.push({
      id: `sale-${sale.id}`,
      date: getRecordDate(sale.doc_date, sale.created_at) || sale.created_at?.slice(0, 10) || "",
      type: "Satış",
      reference: (sale.doc_no as string) || "-",
      party: (sale.customer_name as string) || "-",
      amount: Number(sale.total_amount) || 0,
      direction: "in",
    });
  }

  for (const purchase of purchases.slice(0, 15)) {
    recentActivities.push({
      id: `purchase-${purchase.id}`,
      date: getRecordDate(purchase.doc_date, purchase.created_at) || purchase.created_at?.slice(0, 10) || "",
      type: "Alış",
      reference: (purchase.invoice_number as string) || "-",
      party: "-",
      amount: Number(purchase.total_amount) || 0,
      direction: "out",
    });
  }

  for (const tx of transactions.slice(0, 20)) {
    const isIncome = tx.type === "Mədaxil";
    recentActivities.push({
      id: `tx-${tx.id}`,
      date: getTransactionDate(tx.created_at as string),
      type: isIncome ? "Mədaxil" : "Məxaric",
      reference: (tx.category as string) || "-",
      party: (tx.accounts as { name?: string } | null)?.name || "-",
      amount: Number(tx.amount) || 0,
      direction: isIncome ? "in" : "out",
    });
  }

  recentActivities.sort((a, b) => b.date.localeCompare(a.date));

  const monthlyTrend: MonthlyTrendPoint[] = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

    let revenue = 0;
    for (const sale of sales) {
      const date = getRecordDate(sale.doc_date, sale.created_at);
      if (isDateInRange(date, start, end)) {
        revenue += Number(sale.total_amount) || 0;
      }
    }

    let expenses = 0;
    for (const tx of trendTransactions) {
      const date = getTransactionDate(tx.created_at as string);
      if (!isDateInRange(date, start, end)) continue;
      if (tx.type === "Məxaric") expenses += Number(tx.amount) || 0;
    }

    monthlyTrend.push({
      label: monthLabel(d.getFullYear(), d.getMonth()),
      revenue,
      expenses,
    });
  }

  return {
    kpis: {
      monthlyRevenue,
      monthlyExpenses,
      netProfit,
      customerDebts,
      supplierDebts,
    },
    lowStockAlerts,
    recentActivities: recentActivities.slice(0, 12),
    monthlyTrend,
  };
}
