export const PRODUCTION_ORDER_TYPES = ["series", "custom"] as const;
export type ProductionOrderType = (typeof PRODUCTION_ORDER_TYPES)[number];

export const CUSTOM_WORKFLOWS = ["in_house", "outsourced_cut", "subcontractor"] as const;
export type CustomWorkflow = (typeof CUSTOM_WORKFLOWS)[number];

export const PRODUCTION_STATUSES = ["draft", "in_progress", "ready", "delivered"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const DEFAULT_CONTRACTOR_COMMISSION = 20;

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
  type: ProductionOrderType;
  custom_workflow: CustomWorkflow | null;
  status: ProductionStatus;
  project_name: string;
  customer_id: string | null;
  customer_name: string | null;
  finished_product_id: string | null;
  finished_product_name: string | null;
  quantity: number;
  warehouse_id: string | null;
  warehouse_name: string | null;
  total_project_price: number;
  installation_fee: number;
  advance_payment: number;
  remaining_balance: number;
  expected_delivery_date: string | null;
  project_scope: string | null;
  terms: string | null;
  notes: string | null;
  materials_allocated: boolean;
  finished_goods_posted: boolean;
  created_at: string | null;
  materials: ProductionMaterial[];
  outsourcing: ProductionOutsourcing[];
  contractors: ProductionContractor[];
  contract: ProductionContract | null;
}

export interface ProductionCosting {
  materialCost: number;
  outsourcingCost: number;
  contractorFee: number;
  totalCost: number;
  projectPrice: number;
  profit: number;
  marginPercent: number;
}

export function calcProductionCosting(order: ProductionOrder): ProductionCosting {
  const materialCost = order.materials.reduce((sum, row) => sum + Number(row.line_cost || 0), 0);
  const outsourcingCost = order.outsourcing.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
  const contractorFee = order.contractors.reduce((sum, row) => sum + Number(row.calculated_fee || 0), 0);
  const totalCost = materialCost + outsourcingCost + contractorFee;
  const projectPrice = Number(order.total_project_price || 0);
  const profit = projectPrice - totalCost;
  const marginPercent = projectPrice > 0 ? (profit / projectPrice) * 100 : 0;

  return {
    materialCost,
    outsourcingCost,
    contractorFee,
    totalCost,
    projectPrice,
    profit,
    marginPercent,
  };
}

export function remainingBalance(totalPrice: number, installationFee: number, advance: number): number {
  return Math.max(0, Number(totalPrice || 0) + Number(installationFee || 0) - Number(advance || 0));
}
