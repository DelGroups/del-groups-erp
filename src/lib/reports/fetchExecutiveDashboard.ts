import { supabase } from "@/lib/supabase";
import { DEFAULT_CONTRACTOR_COMMISSION } from "@/lib/production/types";
import type {
  CashFlowDayPoint,
  ExecutiveDashboardData,
  MaterialUsageRow,
  ProjectProfitabilityRow,
} from "@/types/database.types";

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

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function materialLineCost(row: Record<string, unknown>): number {
  const line = num(row.line_cost);
  if (line > 0) return line;
  return num(row.quantity) * num(row.unit_cost);
}

function groupByOrder(rows: Record<string, unknown>[] | null | undefined): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const row of rows || []) {
    const key = String(row.production_order_id || "");
    if (!key) continue;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function buildProfitabilityRow(
  record: Record<string, unknown>,
  materials: Record<string, unknown>[],
  contractors: Record<string, unknown>[],
  expenses: Record<string, unknown>[],
  outsourcing: Record<string, unknown>[]
): ProjectProfitabilityRow {
  const income = num(record.total_project_price) + num(record.installation_fee);
  const projectPrice = num(record.total_project_price);

  const estimatedMaterials = materials.length
    ? materials.reduce((sum, row) => sum + materialLineCost(row), 0)
    : num(record.total_material_cost);
  const actualMaterials = materials.length
    ? materials.filter((row) => Boolean(row.issued)).reduce((sum, row) => sum + materialLineCost(row), 0)
    : num(record.total_material_cost);

  const outsourcingCost =
    outsourcing.reduce((sum, row) => sum + num(row.total_cost), 0) || num(record.total_outsourcing_cost);
  const operational =
    expenses.reduce((sum, row) => sum + num(row.amount), 0) || num(record.total_expense_cost);

  const actualContractor =
    contractors.reduce((sum, row) => sum + num(row.calculated_fee), 0) ||
    num(record.subcontractor_fee_amount);
  const estimatedContractor = Math.max(
    actualContractor,
    (projectPrice * DEFAULT_CONTRACTOR_COMMISSION) / 100
  );

  const estimatedLabor = estimatedContractor + outsourcingCost;
  const actualLabor = actualContractor + outsourcingCost;
  const estimatedProfit = income - estimatedMaterials - estimatedLabor - operational;
  const actualProfit = income - actualMaterials - actualLabor - operational;

  return {
    orderId: String(record.id),
    orderNo: String(record.order_no || "—"),
    customerName: String(record.customer_name || record.project_name || "—"),
    status: String(record.status || "Draft"),
    netRevenue: income,
    rawMaterialCost: actualMaterials,
    laborCost: actualLabor,
    generalExpenses: operational,
    grossProfit: actualProfit,
    netProfit: actualProfit,
    marginPercent: income > 0 ? (actualProfit / income) * 100 : 0,
    estimatedProfit,
    actualProfit,
    estimatedMarginPercent: income > 0 ? (estimatedProfit / income) * 100 : 0,
    actualMarginPercent: income > 0 ? (actualProfit / income) * 100 : 0,
  };
}

async function fetchProjectProfitability(): Promise<ProjectProfitabilityRow[]> {
  const { data: orders, error } = await supabase
    .from("production_orders")
    .select(
      "id, order_no, status, customer_name, project_name, total_project_price, installation_fee, subcontractor_fee_amount, total_material_cost, total_outsourcing_cost, total_expense_cost"
    )
    .order("created_at", { ascending: false })
    .limit(80);

  if (error || !orders?.length) {
    if (error) console.error("Executive dashboard production fetch:", error.message);
    return [];
  }

  const ids = orders.map((row) => row.id as string);

  const [materialsRes, contractorsRes, expensesRes, outsourcingRes] = await Promise.all([
    supabase
      .from("production_materials")
      .select("production_order_id, quantity, unit_cost, line_cost, issued")
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

  const materialsByOrder = groupByOrder(materialsRes.data as Record<string, unknown>[] | null);
  const contractorsByOrder = groupByOrder(contractorsRes.data as Record<string, unknown>[] | null);
  const expensesByOrder = groupByOrder(expensesRes.data as Record<string, unknown>[] | null);
  const outsourcingByOrder = groupByOrder(outsourcingRes.data as Record<string, unknown>[] | null);

  return orders
    .map((row) => {
      const record = row as Record<string, unknown>;
      const orderId = String(record.id);
      return buildProfitabilityRow(
        record,
        materialsByOrder.get(orderId) || [],
        contractorsByOrder.get(orderId) || [],
        expensesByOrder.get(orderId) || [],
        outsourcingByOrder.get(orderId) || []
      );
    })
    .sort((a, b) => b.netRevenue - a.netRevenue);
}

function addToBucket(
  buckets: Map<string, { inflows: number; outflows: number }>,
  key: string,
  side: "inflows" | "outflows",
  amount: number
) {
  if (amount <= 0) return;
  const bucket = buckets.get(key);
  if (!bucket) return;
  bucket[side] += amount;
}

async function fetchCashFlowForecast(): Promise<{
  points: CashFlowDayPoint[];
  summary: ExecutiveDashboardData["cashFlowSummary"];
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = addDays(today, 30);

  const buckets = new Map<string, { inflows: number; outflows: number }>();
  for (let i = 0; i <= 30; i += 1) {
    buckets.set(toDateKey(addDays(today, i)), { inflows: 0, outflows: 0 });
  }

  const [
    accountsRes,
    productionRes,
    salesRes,
    purchasesRes,
    payrollRes,
    purchaseRequestsRes,
    employeesRes,
    productsRes,
  ] = await Promise.all([
    supabase.from("accounts").select("balance, type"),
    supabase
      .from("production_orders")
      .select("remaining_balance, expected_delivery_date, status")
      .gt("remaining_balance", 0),
    supabase.from("sales").select("remaining_balance, doc_date, created_at").gt("remaining_balance", 0),
    supabase.from("purchases").select("debt_amount, created_at, status").gt("debt_amount", 0),
    supabase
      .from("payrolls")
      .select("net_salary, period_month, period_year, status")
      .in("status", ["DRAFT", "APPROVED"]),
    supabase
      .from("purchase_requests")
      .select("quantity, product_id, purchase_id, status, created_at")
      .in("status", ["pending", "ordered"]),
    supabase.from("employees").select("base_salary, status"),
    supabase.from("products").select("id, buy_price"),
  ]);

  const openingCash = (accountsRes.data || []).reduce((sum, row) => sum + num(row.balance), 0);

  for (const row of productionRes.data || []) {
    const due = parseDate(row.expected_delivery_date as string) || addDays(today, 7);
    addToBucket(buckets, clampDateToForecast(due, today, end), "inflows", num(row.remaining_balance));
  }

  for (const row of salesRes.data || []) {
    const base = parseDate(row.doc_date as string) || parseDate(row.created_at as string) || today;
    addToBucket(buckets, clampDateToForecast(addDays(base, 14), today, end), "inflows", num(row.remaining_balance));
  }

  for (const row of purchasesRes.data || []) {
    const status = String(row.status || "").toLowerCase();
    if (status === "cancelled" || status === "void") continue;
    const base = parseDate(row.created_at as string) || today;
    addToBucket(buckets, clampDateToForecast(addDays(base, 21), today, end), "outflows", num(row.debt_amount));
  }

  const productCost = new Map(
    (productsRes.data || []).map((row) => [String(row.id), num(row.buy_price)])
  );
  for (const row of purchaseRequestsRes.data || []) {
    if (row.purchase_id) continue;
    const amount = num(row.quantity) * (productCost.get(String(row.product_id || "")) || 0);
    const due = addDays(parseDate(row.created_at as string) || today, 7);
    addToBucket(buckets, clampDateToForecast(due, today, end), "outflows", amount);
  }

  let payrollPlaced = false;
  for (const row of payrollRes.data || []) {
    const amount = num(row.net_salary);
    if (amount <= 0) continue;
    const due = new Date(
      num(row.period_year) || today.getFullYear(),
      num(row.period_month) || today.getMonth() + 1,
      0
    );
    if (due < today || due > end) continue;
    addToBucket(buckets, clampDateToForecast(due, today, end), "outflows", amount);
    payrollPlaced = true;
  }

  if (!payrollPlaced) {
    const monthlyPayroll = (employeesRes.data || [])
      .filter((row) => {
        const status = String(row.status || "").toLowerCase();
        return !status || status === "active" || status === "aktiv";
      })
      .reduce((sum, row) => sum + num(row.base_salary), 0);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    if (monthlyPayroll > 0 && monthEnd >= today && monthEnd <= end) {
      addToBucket(buckets, toDateKey(monthEnd), "outflows", monthlyPayroll);
    }
  }

  const points: CashFlowDayPoint[] = [];
  let totalInflows = 0;
  let totalOutflows = 0;
  let running = openingCash;

  for (let i = 0; i <= 30; i += 1) {
    const date = addDays(today, i);
    const key = toDateKey(date);
    const bucket = buckets.get(key) || { inflows: 0, outflows: 0 };
    totalInflows += bucket.inflows;
    totalOutflows += bucket.outflows;
    running += bucket.inflows - bucket.outflows;
    points.push({
      date: key,
      label: date.toLocaleDateString("az-AZ", { day: "2-digit", month: "short" }),
      inflows: bucket.inflows,
      outflows: bucket.outflows,
      net: bucket.inflows - bucket.outflows,
      balance: running,
    });
  }

  return {
    points,
    summary: {
      totalInflows,
      totalOutflows,
      netPosition: totalInflows - totalOutflows,
      openingCash,
      closingCash: running,
    },
  };
}

function toUsageRow(
  product: Record<string, unknown>,
  extras?: { totalUsed?: number; daysIdle?: number }
): MaterialUsageRow {
  const stock = num(product.stock);
  const minStock = num(product.min_stock);
  return {
    productId: String(product.id),
    code: String(product.code || ""),
    name: String(product.name || ""),
    unit: String(product.unit || "Ədəd"),
    category: String(product.category || ""),
    totalUsed: extras?.totalUsed || 0,
    stock,
    minStock,
    belowMin: stock <= minStock,
    daysIdle: extras?.daysIdle,
  };
}

async function fetchInventoryInsights(): Promise<{
  topMaterials: MaterialUsageRow[];
  deficitAlerts: MaterialUsageRow[];
  deadstock: MaterialUsageRow[];
}> {
  const now = new Date();
  const cutoff = addDays(now, -90);
  const since = cutoff.toISOString();

  const [materialsRes, movementsRes, recentSalesRes, productsRes] = await Promise.all([
    supabase.from("production_materials").select("product_id, quantity, created_at").gte("created_at", since),
    supabase
      .from("stock_movements")
      .select("product_id, quantity, movement_type, created_at")
      .gte("created_at", since),
    supabase.from("sales").select("id").gte("doc_date", since.slice(0, 10)),
    supabase.from("products").select("id, code, name, stock, min_stock, unit, category, is_service"),
  ]);

  const recentSaleIds = (recentSalesRes.data || []).map((row) => String(row.id)).filter(Boolean);
  const saleItemsRes =
    recentSaleIds.length > 0
      ? await supabase.from("sale_items").select("product_id, quantity").in("sale_id", recentSaleIds.slice(0, 500))
      : { data: [] as { product_id?: string | null; quantity?: number | null }[] };

  const usageByProduct = new Map<string, number>();
  const movedRecently = new Set<string>();

  const markUsage = (productId: unknown, qty: unknown) => {
    const id = String(productId || "");
    if (!id) return;
    movedRecently.add(id);
    usageByProduct.set(id, (usageByProduct.get(id) || 0) + num(qty));
  };

  for (const row of materialsRes.data || []) markUsage(row.product_id, row.quantity);
  for (const row of movementsRes.data || []) {
    if (row.movement_type === "out") markUsage(row.product_id, row.quantity);
    else if (row.product_id) movedRecently.add(String(row.product_id));
  }
  for (const row of saleItemsRes.data || []) markUsage(row.product_id, row.quantity);

  const products = (productsRes.data || []) as Record<string, unknown>[];
  const physical = products.filter((row) => row.is_service !== true);

  const usageRows = physical
    .map((product) => {
      const id = String(product.id);
      return toUsageRow(product, { totalUsed: usageByProduct.get(id) || 0 });
    })
    .filter((row) => row.totalUsed > 0);

  const topMaterials = [...usageRows].sort((a, b) => b.totalUsed - a.totalUsed).slice(0, 5);

  const deficitAlerts = physical
    .map((product) => toUsageRow(product, { totalUsed: usageByProduct.get(String(product.id)) || 0 }))
    .filter((row) => row.belowMin)
    .sort((a, b) => a.stock - a.minStock - (b.stock - b.minStock))
    .slice(0, 8);

  const idleMs = now.getTime() - cutoff.getTime();
  const daysIdle = Math.round(idleMs / (1000 * 60 * 60 * 24));
  const deadstock = physical
    .map((product) =>
      toUsageRow(product, {
        totalUsed: usageByProduct.get(String(product.id)) || 0,
        daysIdle,
      })
    )
    .filter((row) => row.stock > 0 && !movedRecently.has(row.productId))
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 12);

  return { topMaterials, deficitAlerts, deadstock };
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
    deadstock: inventory.deadstock,
  };
}
