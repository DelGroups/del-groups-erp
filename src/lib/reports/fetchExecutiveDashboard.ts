import { supabase } from "@/lib/supabase";
import { calcProductionCosting, type ProductionOrder } from "@/lib/production/types";
import type {
  CashFlowDayPoint,
  ExecutiveDashboardData,
  MaterialUsageRow,
  ProjectProfitabilityRow,
} from "@/types/database.types";

const ACTIVE_STATUSES = ["In-Progress", "Ready", "Delivered"];

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampDateToForecast(date: Date, start: Date, end: Date): string {
  if (date < start) return toDateKey(start);
  if (date > end) return toDateKey(end);
  return toDateKey(date);
}

function profitabilityFromHeader(row: Record<string, unknown>): ProjectProfitabilityRow {
  const netRevenue =
    (Number(row.total_project_price) || 0) + (Number(row.installation_fee) || 0);
  const rawMaterialCost = Number(row.total_material_cost) || 0;
  const laborCost =
    (Number(row.subcontractor_fee_amount) || 0) + (Number(row.total_outsourcing_cost) || 0);
  const generalExpenses = Number(row.total_expense_cost) || 0;
  const grossProfit = netRevenue - rawMaterialCost - laborCost - generalExpenses;
  const marginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

  return {
    orderId: row.id as string,
    orderNo: (row.order_no as string) || "—",
    customerName:
      (row.customer_name as string) ||
      (row.project_name as string) ||
      "—",
    status: (row.status as string) || "Draft",
    netRevenue,
    rawMaterialCost,
    laborCost,
    generalExpenses,
    grossProfit,
    marginPercent,
  };
}

function profitabilityFromCosting(
  order: ProductionOrder,
  row: Record<string, unknown>
): ProjectProfitabilityRow {
  const costing = calcProductionCosting(order);
  const laborCost =
    costing.contractorFee + (Number(row.subcontractor_fee_amount) || 0) + costing.outsourcingCost;

  return {
    orderId: order.id,
    orderNo: order.order_no,
    customerName: order.customer_name || order.project_name || "—",
    status: order.status,
    netRevenue: costing.revenue,
    rawMaterialCost: costing.materialCost,
    laborCost,
    generalExpenses: costing.sideExpenseCost,
    grossProfit: costing.profit,
    marginPercent: costing.marginPercent,
  };
}

async function fetchProjectProfitability(): Promise<ProjectProfitabilityRow[]> {
  const { data: orders, error } = await supabase
    .from("production_orders")
    .select(
      "id, order_no, status, customer_name, project_name, total_project_price, installation_fee, subcontractor_fee_amount, total_material_cost, total_outsourcing_cost, total_expense_cost"
    )
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !orders?.length) {
    if (error) console.error("Executive dashboard production fetch:", error.message);
    return [];
  }

  const ids = orders.map((o) => o.id as string);

  const [materialsRes, contractorsRes, expensesRes, outsourcingRes] = await Promise.all([
    supabase
      .from("production_materials")
      .select(
        "id, production_order_id, product_id, product_code, product_name, quantity, unit_cost, line_cost, issued"
      )
      .in("production_order_id", ids),
    supabase
      .from("production_contractors")
      .select("production_order_id, calculated_fee")
      .in("production_order_id", ids),
    supabase
      .from("production_expenses")
      .select("production_order_id, amount")
      .in("production_order_id", ids),
    supabase
      .from("production_outsourcing")
      .select("production_order_id, total_cost")
      .in("production_order_id", ids),
  ]);

  const materialsByOrder = new Map<string, Record<string, unknown>[]>();
  for (const row of materialsRes.data || []) {
    const key = row.production_order_id as string;
    const list = materialsByOrder.get(key) || [];
    list.push(row as Record<string, unknown>);
    materialsByOrder.set(key, list);
  }

  const contractorsByOrder = new Map<string, Record<string, unknown>[]>();
  for (const row of contractorsRes.data || []) {
    const key = row.production_order_id as string;
    const list = contractorsByOrder.get(key) || [];
    list.push(row as Record<string, unknown>);
    contractorsByOrder.set(key, list);
  }

  const expensesByOrder = new Map<string, Record<string, unknown>[]>();
  for (const row of expensesRes.data || []) {
    const key = row.production_order_id as string;
    const list = expensesByOrder.get(key) || [];
    list.push(row as Record<string, unknown>);
    expensesByOrder.set(key, list);
  }

  const outsourcingByOrder = new Map<string, Record<string, unknown>[]>();
  for (const row of outsourcingRes.data || []) {
    const key = row.production_order_id as string;
    const list = outsourcingByOrder.get(key) || [];
    list.push(row as Record<string, unknown>);
    outsourcingByOrder.set(key, list);
  }

  const rows: ProjectProfitabilityRow[] = [];

  for (const row of orders) {
    const record = row as Record<string, unknown>;
    const orderId = record.id as string;
    const hasChildren =
      (materialsByOrder.get(orderId)?.length || 0) > 0 ||
      (contractorsByOrder.get(orderId)?.length || 0) > 0 ||
      (expensesByOrder.get(orderId)?.length || 0) > 0;

    if (!hasChildren) {
      rows.push(profitabilityFromHeader(record));
      continue;
    }

    const stubOrder = {
      id: orderId,
      order_no: (record.order_no as string) || "",
      production_model: "custom_furniture",
      type: "Custom",
      custom_workflow: null,
      status: (record.status as ProductionOrder["status"]) || "In-Progress",
      project_name: (record.project_name as string) || "",
      customer_id: null,
      customer_name: (record.customer_name as string) || null,
      ousta_id: null,
      subcontractor_id: null,
      contractor_id: null,
      production_type: null,
      subcontractor_fee_percent: 0,
      subcontractor_fee_amount: Number(record.subcontractor_fee_amount) || 0,
      finished_product_id: null,
      finished_product_name: null,
      custom_product_id: null,
      quantity: 1,
      warehouse_id: null,
      warehouse_name: null,
      raw_material_warehouse_id: null,
      furniture_warehouse_id: null,
      total_project_price: Number(record.total_project_price) || 0,
      installation_fee: Number(record.installation_fee) || 0,
      advance_payment: 0,
      advance_account_id: null,
      advance_posted_at: null,
      advance_transaction_id: null,
      remaining_balance: 0,
      expected_delivery_date: null,
      project_scope: null,
      terms: null,
      notes: null,
      materials_allocated: false,
      finished_goods_posted: false,
      sale_id: null,
      delivered_at: null,
      created_at: null,
      materials: (materialsByOrder.get(orderId) || []).map((m) => ({
        id: m.id as string,
        production_order_id: orderId,
        product_id: (m.product_id as string) || null,
        product_code: (m.product_code as string) || null,
        product_name: (m.product_name as string) || "",
        warehouse_id: null,
        warehouse_name: null,
        quantity: Number(m.quantity) || 0,
        unit: null,
        unit_cost: Number(m.unit_cost) || 0,
        line_cost: Number(m.line_cost) || 0,
        issued: Boolean(m.issued),
        issued_at: null,
        stage_no: null,
      })),
      outsourcing: (outsourcingByOrder.get(orderId) || []).map((o) => ({
        id: "",
        production_order_id: orderId,
        supplier_id: null,
        supplier_name: null,
        sqm_quantity: 0,
        price_per_sqm: 0,
        total_cost: Number(o.total_cost) || 0,
        notes: null,
      })),
      contractors: (contractorsByOrder.get(orderId) || []).map((c, idx) => ({
        id: String(idx),
        production_order_id: orderId,
        contractor_id: null,
        contractor_name: "",
        commission_percentage: 0,
        calculated_fee: Number(c.calculated_fee) || 0,
        notes: null,
      })),
      expenses: (expensesByOrder.get(orderId) || []).map((e, idx) => ({
        id: String(idx),
        production_order_id: orderId,
        category: "other",
        description: null,
        amount: Number(e.amount) || 0,
        expense_date: null,
        finance_expense_id: null,
        account_id: null,
      })),
      contract: null,
    } as ProductionOrder;

    rows.push(profitabilityFromCosting(stubOrder, record));
  }

  return rows.sort((a, b) => b.netRevenue - a.netRevenue);
}

async function fetchCashFlowForecast(): Promise<{
  points: CashFlowDayPoint[];
  summary: ExecutiveDashboardData["cashFlowSummary"];
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = addDays(today, 30);

  const buckets = new Map<string, { inflows: number; outflows: number }>();
  for (let i = 0; i <= 30; i++) {
    const key = toDateKey(addDays(today, i));
    buckets.set(key, { inflows: 0, outflows: 0 });
  }

  const [productionRes, salesRes, purchasesRes, payrollRes] = await Promise.all([
    supabase
      .from("production_orders")
      .select("remaining_balance, expected_delivery_date, status")
      .gt("remaining_balance", 0)
      .in("status", ACTIVE_STATUSES),
    supabase
      .from("sales")
      .select("remaining_balance, doc_date, created_at")
      .gt("remaining_balance", 0),
    supabase
      .from("purchases")
      .select("debt_amount, doc_date, created_at")
      .gt("debt_amount", 0),
    supabase
      .from("payrolls")
      .select("net_salary, period_month, period_year, status")
      .in("status", ["DRAFT", "APPROVED"]),
  ]);

  for (const row of productionRes.data || []) {
    const amount = Number(row.remaining_balance) || 0;
    if (amount <= 0) continue;
    const due =
      parseDate(row.expected_delivery_date as string) ||
      addDays(today, 7);
    const key = clampDateToForecast(due, today, end);
    const bucket = buckets.get(key);
    if (bucket) bucket.inflows += amount;
  }

  for (const row of salesRes.data || []) {
    const amount = Number(row.remaining_balance) || 0;
    if (amount <= 0) continue;
    const base =
      parseDate(row.doc_date as string) || parseDate(row.created_at as string) || today;
    const due = addDays(base, 14);
    const key = clampDateToForecast(due, today, end);
    const bucket = buckets.get(key);
    if (bucket) bucket.inflows += amount;
  }

  for (const row of purchasesRes.data || []) {
    const amount = Number(row.debt_amount) || 0;
    if (amount <= 0) continue;
    const base =
      parseDate(row.doc_date as string) || parseDate(row.created_at as string) || today;
    const due = addDays(base, 21);
    const key = clampDateToForecast(due, today, end);
    const bucket = buckets.get(key);
    if (bucket) bucket.outflows += amount;
  }

  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  for (const row of payrollRes.data || []) {
    const amount = Number(row.net_salary) || 0;
    if (amount <= 0) continue;
    const due = new Date(
      Number(row.period_year) || today.getFullYear(),
      Number(row.period_month) || today.getMonth() + 1,
      0
    );
    if (due < today || due > end) {
      if (nextMonthEnd <= end && due.getTime() === nextMonthEnd.getTime()) {
        const key = clampDateToForecast(nextMonthEnd, today, end);
        const bucket = buckets.get(key);
        if (bucket) bucket.outflows += amount;
      }
      continue;
    }
    const key = clampDateToForecast(due, today, end);
    const bucket = buckets.get(key);
    if (bucket) bucket.outflows += amount;
  }

  const points: CashFlowDayPoint[] = [];
  let totalInflows = 0;
  let totalOutflows = 0;

  for (let i = 0; i <= 30; i++) {
    const date = addDays(today, i);
    const key = toDateKey(date);
    const bucket = buckets.get(key) || { inflows: 0, outflows: 0 };
    totalInflows += bucket.inflows;
    totalOutflows += bucket.outflows;
    points.push({
      date: key,
      label: date.toLocaleDateString("az-AZ", { day: "2-digit", month: "short" }),
      inflows: bucket.inflows,
      outflows: bucket.outflows,
      net: bucket.inflows - bucket.outflows,
    });
  }

  return {
    points,
    summary: {
      totalInflows,
      totalOutflows,
      netPosition: totalInflows - totalOutflows,
    },
  };
}

async function fetchInventoryInsights(): Promise<{
  topMaterials: MaterialUsageRow[];
  deficitAlerts: MaterialUsageRow[];
}> {
  const since = addDays(new Date(), -90).toISOString();

  const [materialsRes, productsRes] = await Promise.all([
    supabase
      .from("production_materials")
      .select("product_id, quantity, created_at")
      .gte("created_at", since),
    supabase
      .from("products")
      .select("id, code, name, stock, min_stock, unit, category"),
  ]);

  const usageByProduct = new Map<string, number>();
  for (const row of materialsRes.data || []) {
    const productId = row.product_id as string;
    if (!productId) continue;
    usageByProduct.set(
      productId,
      (usageByProduct.get(productId) || 0) + (Number(row.quantity) || 0)
    );
  }

  const products = productsRes.data || [];
  const productMap = new Map(
    products.map((p) => [p.id as string, p as Record<string, unknown>])
  );

  const usageRows: MaterialUsageRow[] = [];
  for (const [productId, totalUsed] of usageByProduct.entries()) {
    const product = productMap.get(productId);
    if (!product) continue;
    const stock = Number(product.stock) || 0;
    const minStock = Number(product.min_stock) || 0;
    usageRows.push({
      productId,
      code: (product.code as string) || "",
      name: (product.name as string) || "",
      unit: (product.unit as string) || "Ədəd",
      category: (product.category as string) || "",
      totalUsed,
      stock,
      minStock,
      belowMin: stock <= minStock,
    });
  }

  const topMaterials = [...usageRows]
    .sort((a, b) => b.totalUsed - a.totalUsed)
    .slice(0, 5);

  const deficitAlerts = products
    .map((p) => {
      const stock = Number(p.stock) || 0;
      const minStock = Number(p.min_stock) || 0;
      return {
        productId: p.id as string,
        code: (p.code as string) || "",
        name: (p.name as string) || "",
        unit: (p.unit as string) || "Ədəd",
        category: (p.category as string) || "",
        totalUsed: usageByProduct.get(p.id as string) || 0,
        stock,
        minStock,
        belowMin: stock <= minStock,
      };
    })
    .filter((p) => p.belowMin)
    .sort((a, b) => (a.minStock - a.stock) - (b.minStock - b.stock))
    .slice(0, 5);

  return { topMaterials, deficitAlerts };
}

export async function fetchExecutiveDashboard(): Promise<ExecutiveDashboardData> {
  const [projectProfitability, cashFlow, inventory] = await Promise.all([
    fetchProjectProfitability(),
    fetchCashFlowForecast(),
    fetchInventoryInsights(),
  ]);

  return {
    projectProfitability,
    cashFlowForecast: cashFlow.points,
    cashFlowSummary: cashFlow.summary,
    topMaterials: inventory.topMaterials,
    deficitAlerts: inventory.deficitAlerts,
  };
}
