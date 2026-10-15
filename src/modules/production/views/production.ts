/**
 * Production on the view engine (NEW_UI): the order board (Draft → In progress → Ready →
 * Delivered) with the classic costing. Pure: rows come from the module's
 * listProductionOrdersAction; costing and the next stage are the module's own rules.
 */
import { calcProductionCosting, PRODUCTION_STATUS_NEXT, productionModelLabel, type ProductionOrder, type ProductionStatus } from "../lib/types";
import { countIf, figure, money, sumIf, type Formatter } from "../../../views/logic";
import type { Kpi } from "../../../views/components/KpiCards";
import type { FieldDef, ModelDef, ViewDefinition, ViewRecord } from "../../../views/types";

export const PRODUCTION_VIEW_KEY = "production.orders";

export interface ProductionRecord extends ViewRecord {
  order_no: string;
  project_name: string;
  customer_name: string | null;
  model: string;
  status: ProductionStatus;
  next_status: ProductionStatus | null;
  quantity: number;
  warehouse_name: string | null;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  is_late: boolean;
  project_price: number;
  remaining_balance: number;
  revenue: number;
  total_cost: number;
  profit: number;
  margin: number;
  health: string;
  created_at: string | null;
}

/** An order with the classic costing (materials, outsourcing, expenses, contractor fee). */
export function productionToRecord(row: Record<string, unknown>, now: Date = new Date()): ProductionRecord {
  const order = row as unknown as ProductionOrder;
  const costing = calcProductionCosting({ ...order, materials: order.materials ?? [], outsourcing: order.outsourcing ?? [], contractors: order.contractors ?? [], expenses: order.expenses ?? [] });
  const status = (["Draft", "In-Progress", "Ready", "Delivered"] as const).includes(order.status) ? order.status : "Draft";
  const due = order.expected_delivery_date ? new Date(`${String(order.expected_delivery_date).slice(0, 10)}T00:00:00`) : null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    id: String(order.id),
    order_no: String(order.order_no ?? ""),
    project_name: String(order.project_name ?? ""),
    customer_name: order.customer_name ?? null,
    model: productionModelLabel(order.production_model),
    status,
    next_status: PRODUCTION_STATUS_NEXT[status],
    quantity: Number(order.quantity) || 0,
    warehouse_name: order.warehouse_name ?? null,
    expected_delivery_date: order.expected_delivery_date ?? null,
    delivered_at: order.delivered_at ?? null,
    is_late: status !== "Delivered" && !!due && due < today,
    project_price: Number(order.total_project_price) || 0,
    remaining_balance: Number(order.remaining_balance) || 0,
    revenue: costing.revenue,
    total_cost: costing.totalCost,
    profit: costing.profit,
    margin: Math.round(costing.marginPercent * 10) / 10,
    health: costing.health,
    created_at: order.created_at ?? null,
  };
}

const FINANCIAL = new Set(["project_price", "remaining_balance", "revenue", "total_cost", "profit", "margin", "health"]);

/**
 * The production board: kanban by stage (read-only: an order moves one stage at a time with
 * its own action, as on the classic card), list, pivot, graph and a delivery calendar.
 * Money fields are left out for users who may not see production financials.
 */
export function productionDefinition(fetchers: Pick<ModelDef, "fetchAll" | "fetchOne">, showFinancials: boolean): ViewDefinition<ProductionRecord> {
  const fields: FieldDef[] = [
    { name: "order_no", labelKey: "production.engine.orderNo", type: "char", searchable: true, readonly: true },
    { name: "project_name", labelKey: "production.engine.project", type: "char", searchable: true, readonly: true },
    { name: "customer_name", labelKey: "sales.customer", type: "char", searchable: true, groupable: true, readonly: true },
    { name: "model", labelKey: "production.engine.model", type: "char", groupable: true, readonly: true },
    {
      name: "status",
      labelKey: "common.status",
      type: "selection",
      groupable: true,
      readonly: true,
      options: [
        { value: "Draft", labelKey: "production.engine.stage.draft", color: "#94a3b8" },
        { value: "In-Progress", labelKey: "production.engine.stage.inProgress", color: "#0ea5e9" },
        { value: "Ready", labelKey: "production.engine.stage.ready", color: "#f59e0b" },
        { value: "Delivered", labelKey: "production.engine.stage.delivered", color: "#10b981" },
      ],
    },
    { name: "quantity", labelKey: "modals.salesView.quantity", type: "float", readonly: true },
    { name: "warehouse_name", labelKey: "sales.warehouse", type: "char", groupable: true, readonly: true },
    { name: "expected_delivery_date", labelKey: "production.engine.deliveryDate", type: "date", readonly: true },
    { name: "delivered_at", labelKey: "production.engine.deliveredAt", type: "datetime", readonly: true },
    { name: "is_late", labelKey: "production.engine.late", type: "boolean", groupable: true, readonly: true },
    { name: "project_price", labelKey: "production.engine.projectPrice", type: "monetary", readonly: true },
    { name: "remaining_balance", labelKey: "sales.remaining", type: "monetary", readonly: true },
    { name: "revenue", labelKey: "sales.profitability.revenue", type: "monetary", readonly: true },
    { name: "total_cost", labelKey: "production.engine.totalCost", type: "monetary", readonly: true },
    { name: "profit", labelKey: "sales.profitability.grossProfit", type: "monetary", readonly: true },
    { name: "margin", labelKey: "sales.profitability.margin", type: "float", readonly: true },
    {
      name: "health",
      labelKey: "production.engine.health",
      type: "selection",
      groupable: true,
      readonly: true,
      options: [
        { value: "healthy", labelKey: "production.health.healthy", color: "#10b981" },
        { value: "tight", labelKey: "production.health.tight", color: "#f59e0b" },
        { value: "loss", labelKey: "production.health.loss", color: "#f43f5e" },
        { value: "pending", labelKey: "production.health.pending", color: "#94a3b8" },
      ],
    },
    { name: "created_at", labelKey: "sales.engine.fields.createdAt", type: "datetime", readonly: true },
  ];
  const keep = (names: readonly string[]) => names.filter((n) => showFinancials || !FINANCIAL.has(n));
  return {
    model: { key: PRODUCTION_VIEW_KEY, table: "production_orders", module: "production", readPermission: "can_view_production", writePermission: "can_manage_production", select: "*", order: { field: "created_at", dir: "desc" }, toRecord: (r) => productionToRecord(r), ...fetchers },
    titleKey: "production.boardTitle",
    fields: fields.filter((f) => showFinancials || !FINANCIAL.has(f.name)),
    filters: [
      { key: "open", labelKey: "production.engine.open", group: "status", conditions: () => [{ field: "status", op: "neq", value: "Delivered" }] },
      { key: "late", labelKey: "production.engine.late", group: "late", conditions: () => [{ field: "is_late", op: "eq", value: true }] },
      ...(showFinancials ? [{ key: "loss", labelKey: "production.health.loss", group: "health", conditions: () => [{ field: "health", op: "eq" as const, value: "loss" }] }] : []),
    ],
    groupBys: keep(["status", "customer_name", "model", "warehouse_name", "health", "is_late", "expected_delivery_date:month", "created_at:month"]),
    views: ["kanban", "list", "pivot", "graph", "calendar"],
    list: { columns: keep(["order_no", "project_name", "customer_name", "model", "status", "expected_delivery_date", "revenue", "total_cost", "profit", "health"]), sums: keep(["revenue", "total_cost", "profit"]) },
    kanban: { groupBy: "status", title: "project_name", subtitle: "customer_name", amount: showFinancials ? "revenue" : undefined, fields: ["order_no", "expected_delivery_date"], folded: ["Delivered"] },
    form: {
      title: "project_name",
      statusField: "status",
      fields: keep(["order_no", "customer_name", "model", "quantity", "warehouse_name", "expected_delivery_date", "delivered_at", "project_price", "remaining_balance"]),
      tabs: showFinancials ? [{ key: "costing", labelKey: "production.engine.costing", fields: ["revenue", "total_cost", "profit", "margin", "health"] }] : [],
    },
    pivot: showFinancials ? { rows: "customer_name", cols: "status", measure: "revenue" } : { rows: "customer_name", cols: "status", measure: "__count" },
    graph: showFinancials ? { groupBy: "created_at:month", measure: "revenue", type: "bar" } : { groupBy: "status", measure: "__count", type: "bar" },
    calendar: { dateField: "expected_delivery_date", title: "project_name", colorField: "status" },
  };
}

/** Open orders, late deliveries, ready to deliver; with financials the classic profit total. */
export function productionKpis(records: readonly ProductionRecord[], fmt: Formatter, showFinancials: boolean): Kpi[] {
  const kpis: Kpi[] = [
    { key: "open", label: fmt.t("production.engine.open"), value: figure(countIf(records, (r) => r.status !== "Delivered"), fmt), hint: fmt.t("production.engine.inProgressHint", { count: countIf(records, (r) => r.status === "In-Progress") }), filters: ["open"], filterLabel: fmt.t("production.engine.showOpen") },
    { key: "late", label: fmt.t("production.engine.late"), value: figure(countIf(records, (r) => r.is_late), fmt), filters: ["late"], filterLabel: fmt.t("production.engine.showLate"), tone: records.some((r) => r.is_late) ? "attention" : undefined },
    { key: "ready", label: fmt.t("production.engine.stage.ready"), value: figure(countIf(records, (r) => r.status === "Ready"), fmt), hint: fmt.t("production.engine.readyHint") },
  ];
  if (showFinancials) {
    kpis.push({
      key: "profit",
      label: fmt.t("production.engine.profitTotal"),
      value: money(sumIf(records, (r) => r.profit), fmt),
      hint: fmt.t("production.engine.profitHint", { revenue: money(sumIf(records, (r) => r.revenue), fmt), cost: money(sumIf(records, (r) => r.total_cost), fmt) }),
      tone: sumIf(records, (r) => r.profit) < 0 ? "attention" : "good",
    });
  }
  return kpis;
}
