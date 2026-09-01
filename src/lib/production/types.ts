import { DEFAULT_CONTRACT_TERMS_AZ } from "@/lib/production/constants";
import {
  normalizeProductionModel,
  type ProductionModel,
  PRODUCTION_MODEL_DEFAULT,
  PRODUCTION_MODELS,
} from "@/lib/production/models";
import { normalizeStatus, normalizeType, canonicalizeProductionOrderWrite } from "@/lib/production/ordersClient";

export { normalizeStatus, normalizeType } from "@/lib/production/ordersClient";
export {
  normalizeProductionModel,
  productionModelFromLegacy,
  legacyFromProductionModel,
  productionModelLabel,
  PRODUCTION_MODEL_DEFAULT,
  PRODUCTION_MODELS,
  PRODUCTION_MODEL_LABELS,
  type ProductionModel,
} from "@/lib/production/models";

export const PRODUCTION_ORDER_TYPES = ["Custom", "Series"] as const;
export type ProductionOrderType = (typeof PRODUCTION_ORDER_TYPES)[number];
export const PRODUCTION_TYPE_DEFAULT: ProductionOrderType = "Custom";

export function normalizeProductionType(value: unknown): ProductionOrderType {
  return normalizeType(typeof value === "string" ? value : value == null ? "" : String(value));
}

export const CUSTOM_WORKFLOWS = ["in_house", "outsourced_cut", "subcontractor"] as const;
export type CustomWorkflow = (typeof CUSTOM_WORKFLOWS)[number];

/** Exact values allowed by production_orders_status_check. */
export const PRODUCTION_STATUSES = ["Draft", "In-Progress", "Ready", "Delivered"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];
export const PRODUCTION_STATUS_DEFAULT: ProductionStatus = "Draft";

export function normalizeProductionStatus(value: unknown): ProductionStatus {
  return normalizeStatus(typeof value === "string" ? value : value == null ? "" : String(value)) as ProductionStatus;
}

export function isProductionStatusDbKey(value: unknown): value is ProductionStatus {
  return typeof value === "string" && (PRODUCTION_STATUSES as readonly string[]).includes(value);
}

/** Value written to production_orders.status — never a translated label. */
export function toProductionStatusDbKey(value: unknown): ProductionStatus {
  const key = normalizeStatus(typeof value === "string" ? value : value == null ? "" : String(value));
  return isProductionStatusDbKey(key) ? key : PRODUCTION_STATUS_DEFAULT;
}

export function withNormalizedProductionOrderWrite<T extends Record<string, unknown>>(
  payload: T,
  options?: { forceType?: boolean; forceStatus?: boolean }
): T {
  const isInsert = Boolean(options?.forceType || options?.forceStatus || "order_no" in payload);
  const next = canonicalizeProductionOrderWrite(payload as Record<string, unknown>, {
    insert: isInsert,
  });
  return next as T;
}

/** @deprecated Use withNormalizedProductionOrderWrite */
export function withNormalizedProductionStatus<T extends Record<string, unknown>>(payload: T): T {
  return withNormalizedProductionOrderWrite(payload);
}

export const PRODUCTION_STATUS_NEXT: Record<ProductionStatus, ProductionStatus | null> = {
  Draft: "In-Progress",
  "In-Progress": "Ready",
  Ready: "Delivered",
  Delivered: null,
};

export const DEFAULT_CONTRACTOR_COMMISSION = 20;

export const PRODUCTION_EXPENSE_CATEGORIES = [
  "transport",
  "delivery",
  "installation",
  "tools",
  "other",
] as const;
export type ProductionExpenseCategory = (typeof PRODUCTION_EXPENSE_CATEGORIES)[number];

export const PRODUCTION_HEALTH = ["healthy", "tight", "loss", "pending"] as const;
export type ProductionHealth = (typeof PRODUCTION_HEALTH)[number];

export interface ProductionBomItem {
  id: string;
  bom_id: string;
  product_id: string;
  product_code: string | null;
  product_name: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  quantity: number;
  unit: string | null;
  unit_cost: number;
}

export interface ProductionBom {
  id: string;
  finished_product_id: string;
  name: string;
  notes: string | null;
  items: ProductionBomItem[];
}

export interface ProductionMaterial {
  id: string;
  production_order_id: string;
  product_id: string | null;
  product_code: string | null;
  product_name: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  quantity: number;
  unit: string | null;
  unit_cost: number;
  line_cost: number;
  inventory_mode: string | null;
  polywood_sale_mode: "linear_m" | "full_sheet" | null;
  polywood_length_m: number | null;
  stage_no: number;
  stage_label: string | null;
  notes: string | null;
  issued: boolean;
  issued_at: string | null;
  created_by_name: string | null;
}

export interface ProductionExpense {
  id: string;
  production_order_id: string;
  category: ProductionExpenseCategory;
  description: string;
  amount: number;
  expense_date: string;
  account_id: string | null;
  account_name: string | null;
  finance_expense_id: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string | null;
}

export interface ProductionOutsourcing {
  id: string;
  production_order_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  material_description: string;
  sqm_quantity: number;
  price_per_sqm: number;
  total_cost: number;
  notes: string | null;
}

export interface ProductionContractor {
  id: string;
  production_order_id: string;
  contractor_id: string | null;
  contractor_name: string;
  commission_percentage: number;
  calculated_fee: number;
  notes: string | null;
}

export interface ProductionContract {
  id: string;
  production_order_id: string;
  contract_no: string;
  contract_date: string;
  customer_id: string | null;
  customer_name: string | null;
  project_name: string | null;
  project_scope: string | null;
  expected_delivery_date: string | null;
  total_project_price: number;
  installation_fee: number;
  advance_payment: number;
  remaining_balance: number;
  terms: string | null;
  notes: string | null;
}

export interface ProductionOrder {
  id: string;
  order_no: string;
  production_model: ProductionModel;
  type: ProductionOrderType;
  custom_workflow: CustomWorkflow | null;
  status: ProductionStatus;
  project_name: string;
  customer_id: string | null;
  customer_name: string | null;
  ousta_id: string | null;
  subcontractor_id: string | null;
  subcontractor_fee_percent: number;
  subcontractor_fee_amount: number;
  finished_product_id: string | null;
  finished_product_name: string | null;
  custom_product_id: string | null;
  quantity: number;
  warehouse_id: string | null;
  warehouse_name: string | null;
  raw_material_warehouse_id: string | null;
  furniture_warehouse_id: string | null;
  total_project_price: number;
  installation_fee: number;
  advance_payment: number;
  advance_account_id: string | null;
  advance_posted_at: string | null;
  advance_transaction_id: string | null;
  remaining_balance: number;
  expected_delivery_date: string | null;
  project_scope: string | null;
  terms: string | null;
  notes: string | null;
  materials_allocated: boolean;
  finished_goods_posted: boolean;
  sale_id: string | null;
  delivered_at: string | null;
  created_at: string | null;
  materials: ProductionMaterial[];
  outsourcing: ProductionOutsourcing[];
  contractors: ProductionContractor[];
  expenses: ProductionExpense[];
  contract: ProductionContract | null;
}

export interface ProductionCosting {
  materialCost: number;
  plannedMaterialCost: number;
  outsourcingCost: number;
  sideExpenseCost: number;
  contractorFee: number;
  totalCost: number;
  projectPrice: number;
  installationFee: number;
  revenue: number;
  profit: number;
  marginPercent: number;
  health: ProductionHealth;
}

export function productionHealth(revenue: number, marginPercent: number): ProductionHealth {
  if (revenue <= 0) return "pending";
  if (marginPercent < 0) return "loss";
  if (marginPercent < 15) return "tight";
  return "healthy";
}

export function calcProductionCosting(order: ProductionOrder): ProductionCosting {
  const materialCost = (order.materials || [])
    .filter((row) => row.issued)
    .reduce((sum, row) => sum + Number(row.line_cost || 0), 0);
  const plannedMaterialCost = (order.materials || [])
    .filter((row) => !row.issued)
    .reduce((sum, row) => sum + Number(row.line_cost || 0), 0);
  const outsourcingCost = (order.outsourcing || []).reduce(
    (sum, row) => sum + Number(row.total_cost || 0),
    0
  );
  const sideExpenseCost = (order.expenses || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const contractorFee = (order.contractors || []).reduce(
    (sum, row) => sum + Number(row.calculated_fee || 0),
    0
  );
  const totalCost = materialCost + outsourcingCost + sideExpenseCost + contractorFee;
  const projectPrice = Number(order.total_project_price || 0);
  const installationFee = Number(order.installation_fee || 0);
  const revenue = projectPrice + installationFee;
  const profit = revenue - totalCost;
  const marginPercent = revenue > 0 ? (profit / revenue) * 100 : 0;

  return {
    materialCost,
    plannedMaterialCost,
    outsourcingCost,
    sideExpenseCost,
    contractorFee,
    totalCost,
    projectPrice,
    installationFee,
    revenue,
    profit,
    marginPercent,
    health: productionHealth(revenue, marginPercent),
  };
}

export function remainingBalance(totalPrice: number, installationFee: number, advance: number): number {
  return Math.max(0, Number(totalPrice || 0) + Number(installationFee || 0) - Number(advance || 0));
}

export function remainingBalanceFromOrder(order: {
  total_project_price?: number | null;
  installation_fee?: number | null;
  advance_payment?: number | null;
}): number {
  return remainingBalance(
    Number(order.total_project_price || 0),
    Number(order.installation_fee || 0),
    Number(order.advance_payment || 0)
  );
}

/** Merge a partial order payload (new/changed rows only) into existing client state. */
export function mergeProductionOrder(prev: ProductionOrder, delta: ProductionOrder): ProductionOrder {
  const mergeRows = <T extends { id: string }>(current: T[], incoming: T[]) => {
    if (!incoming.length) return current;
    const next = [...current];
    for (const row of incoming) {
      const index = next.findIndex((item) => item.id === row.id);
      if (index >= 0) next[index] = row;
      else next.push(row);
    }
    return next;
  };

  return {
    ...prev,
    status: delta.status || prev.status,
    materials_allocated: delta.materials_allocated ?? prev.materials_allocated,
    finished_goods_posted: delta.finished_goods_posted ?? prev.finished_goods_posted,
    sale_id: delta.sale_id ?? prev.sale_id,
    delivered_at: delta.delivered_at ?? prev.delivered_at,
    materials: mergeRows(prev.materials, delta.materials),
    outsourcing: mergeRows(prev.outsourcing, delta.outsourcing),
    expenses: mergeRows(prev.expenses, delta.expenses),
    contractors: delta.contractors.length ? delta.contractors : prev.contractors,
    contract: delta.contract ?? prev.contract,
  };
}

export function pickText(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function resolveProjectScope(source: {
  project_scope?: string | null;
  notes?: string | null;
  contract?: { project_scope?: string | null; notes?: string | null } | null;
}): string {
  return (
    source.project_scope?.trim() ||
    source.contract?.project_scope?.trim() ||
    source.notes?.trim() ||
    source.contract?.notes?.trim() ||
    ""
  );
}

export function resolveContractTerms(source: {
  terms?: string | null;
  contract?: { terms?: string | null } | null;
}): string {
  return (
    source.terms?.trim() ||
    source.contract?.terms?.trim() ||
    DEFAULT_CONTRACT_TERMS_AZ
  );
}

export function isMissingProductionSchema(error?: string | null): boolean {
  return Boolean(
    error && /production_orders|schema cache|Could not find the table|Could not find the '[^']+' column/i.test(error)
  );
}
