"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { userHasPermission } from "@/lib/auth/routePermissions";
import { createSupabaseServerClient, getServerAuthContext } from "@/lib/supabaseServer";
import { POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import { DEFAULT_CONTRACT_TERMS_AZ } from "@/lib/production/constants";
import {
  buildSyntheticProductionContract,
  withPrintableProductionContract,
} from "@/lib/production/contracts";
import {
  buildContractMappingSourceFromOrder,
  buildContractPayloadFromOrder,
  contractSelectColumns,
  formatContractDateYmd,
  isProductionContractSchemaColumnError,
  isProductionContractSelectColumn,
  persistSanitizedContractRow,
  resolveContractAdvancePayment,
  resolveContractCustomerId,
  resolveContractCustomerName,
  resolveContractDate,
  resolveContractDeliveryDate,
  resolveContractContent,
  resolveContractNumber,
  resolveContractProjectName,
  resolveContractProjectScope,
  resolveContractRemainingBalance,
  resolveContractTotalAmount,
  selectProductionContractRow,
} from "@/app/production/contractInsert";
import {
  allocateProductionMaterialPolywood,
} from "@/lib/production/inventory";
import { completeProductionDelivery } from "@/lib/production/delivery";
import { recordProductionAdvancePayment } from "@/lib/production/advancePayment";
import {
  DEFAULT_CONTRACTOR_COMMISSION,
  PRODUCTION_EXPENSE_CATEGORIES,
  pickText,
  remainingBalanceFromOrder,
  PRODUCTION_STATUS_DEFAULT,
  PRODUCTION_STATUS_NEXT,
  normalizeProductionType,
  toProductionStatusDbKey,
  type CustomWorkflow,
  type ProductionBom,
  type ProductionBomItem,
  type ProductionContract,
  type ProductionContractor,
  type ProductionExpense,
  type ProductionExpenseCategory,
  type ProductionMaterial,
  type ProductionOrder,
  type ProductionOrderType,
  type ProductionOutsourcing,
  type ProductionStatus,
} from "@/lib/production/types";
import {
  legacyFromProductionModel,
  normalizeProductionModel,
  productionModelFromLegacy,
  type ProductionModel,
} from "@/lib/production/models";
import {
  isMissingTableError,
  missingColumnFromError,
  missingTableFromError,
  mutateOmittingMissingColumns,
  omitEmptyOptionalText,
  PRODUCTION_ORDER_CORE_COLUMNS,
  PRODUCTION_ORDER_OPTIONAL_COLUMNS,
  selectProductionOrders,
} from "@/lib/production/safeQuery";
import { insertProductionOrders, normalizeStatus, normalizeType, updateProductionOrders } from "@/lib/production/ordersClient";
import {
  buildStrictMaterialInsertPayload,
  insertSanitizedMaterialRow,
  sanitizeAddProductionMaterialInput,
  sanitizeMaterialPayload,
  type AddProductionMaterialInput,
} from "@/app/production/materialInsert";
import {
  buildProductionExpenseInsertPayload,
  buildProductionOutsourcingInsertPayload,
  formatProductionDbError,
  PRODUCTION_MATERIAL_LIVE_COLUMNS,
  productionSchemaColumnFromError,
  selectProductionMaterialsWithFallback,
} from "@/lib/production/payloads";
import type { Customer, Employee, Product, Supplier, Warehouse } from "@/types/database.types";
import { normalizeEmployee } from "@/types/database.types";

export type ProductionActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

function isMissingRelation(error?: { message?: string; code?: string } | null): boolean {
  const message = error?.message || "";
  return (
    error?.code === "PGRST205" ||
    Boolean(missingTableFromError(error)) ||
    /schema cache|Could not find the table|does not exist/i.test(message)
  );
}

function isProductionContractsTableError(error?: { message?: string; code?: string } | null): boolean {
  return (
    isMissingTableError(error, "production_contracts") ||
    /production_contracts/i.test(error?.message || "")
  );
}

async function selectProductionContractForOrder(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string
): Promise<ProductionContract | null> {
  const { data, error } = await selectProductionContractRow(admin, orderId);
  if (error && !isProductionContractsTableError({ message: error })) return null;
  return data ? mapContract(data) : null;
}

async function requireProductionIssuePermission() {
  const { user, profile } = await getServerAuthContext();
  if (!user) throw new ActionAuthError("Giriş tələb olunur");
  if (profile?.is_active === false) {
    throw new ActionAuthError("Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın.");
  }
  if (
    userHasPermission(profile, "can_manage_production") ||
    userHasPermission(profile, "can_writeoff_inventory") ||
    userHasPermission(profile, "can_manage_warehouses")
  ) {
    return { user, profile };
  }
  throw new ActionAuthError("İcazəniz yoxdur");
}

function actorName(profile: { full_name?: string | null; email?: string | null } | null | undefined): string | null {
  return profile?.full_name?.trim() || profile?.email || null;
}

function createDocNo(prefix: string): string {
  return `${prefix}-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}


const OUTSOURCING_FIELD_NAMES = [
  "id",
  "production_order_id",
  "supplier_id",
  "supplier_name",
  "material_description",
  "description",
  "sqm_quantity",
  "price_per_sqm",
  "total_cost",
  "notes",
] as const;
/** Writable PostgREST columns only — `total_cost` is DB-generated/read-only. */
const OUTSOURCING_INSERT_COLUMNS = [
  "production_order_id",
  "supplier_id",
  "supplier_name",
  "material_description",
  "description",
  "notes",
  "sqm_quantity",
  "price_per_sqm",
] as const;
const OUTSOURCING_OPTIONAL_INSERT_COLUMNS = new Set([
  "supplier_id",
  "supplier_name",
  "material_description",
  "description",
  "notes",
]);
const CONTRACTOR_FIELDS =
  "id,production_order_id,contractor_id,contractor_name,commission_percentage,calculated_fee,notes";
const EXPENSE_FIELDS =
  "id,production_order_id,category,description,amount,expense_date,account_id,account_name,finance_expense_id,notes,created_by_name,created_at";
const BOM_FIELDS = "id,finished_product_id,name,notes";
const BOM_ITEM_FIELDS =
  "id,bom_id,product_id,product_code,product_name,warehouse_id,warehouse_name,quantity,unit,unit_cost";

function asOrder(row: Record<string, unknown>, extras?: Partial<ProductionOrder>): ProductionOrder {
  const type = normalizeProductionType(row.type);
  const customWorkflow = (row.custom_workflow as CustomWorkflow) || null;
  const productionModel = row.production_model
    ? normalizeProductionModel(row.production_model)
    : productionModelFromLegacy(type, customWorkflow);
  return {
    id: String(row.id),
    order_no: String(row.order_no || ""),
    production_model: productionModel,
    type,
    custom_workflow: customWorkflow,
    status: toProductionStatusDbKey(row.status),
    project_name: String(row.project_name || ""),
    customer_id: (row.customer_id as string) || null,
    customer_name: (row.customer_name as string) || null,
    ousta_id: (row.ousta_id as string) || null,
    subcontractor_id: (row.subcontractor_id as string) || null,
    subcontractor_fee_percent: num(row.subcontractor_fee_percent) || DEFAULT_CONTRACTOR_COMMISSION,
    subcontractor_fee_amount: num(row.subcontractor_fee_amount),
    finished_product_id: (row.finished_product_id as string) || null,
    finished_product_name: (row.finished_product_name as string) || null,
    custom_product_id: (row.custom_product_id as string) || null,
    quantity: num(row.quantity) || 1,
    warehouse_id: (row.warehouse_id as string) || null,
    warehouse_name: (row.warehouse_name as string) || null,
    raw_material_warehouse_id: (row.raw_material_warehouse_id as string) || null,
    furniture_warehouse_id: (row.furniture_warehouse_id as string) || null,
    total_project_price: num(row.total_project_price),
    installation_fee: num(row.installation_fee),
    advance_payment: num(row.advance_payment),
    advance_account_id: (row.advance_account_id as string) || null,
    advance_posted_at: (row.advance_posted_at as string) || null,
    advance_transaction_id: (row.advance_transaction_id as string) || null,
    remaining_balance: remainingBalanceFromOrder({
      total_project_price: num(row.total_project_price),
      installation_fee: num(row.installation_fee),
      advance_payment: num(row.advance_payment),
    }),
    expected_delivery_date: (row.expected_delivery_date as string) || null,
    project_scope: pickText(row, "project_scope"),
    terms: pickText(row, "terms", "terms_and_conditions"),
    notes: pickText(row, "notes"),
    materials_allocated: Boolean(row.materials_allocated),
    finished_goods_posted: Boolean(row.finished_goods_posted),
    sale_id: (row.sale_id as string) || null,
    delivered_at: (row.delivered_at as string) || null,
    created_at: (row.created_at as string) || null,
    materials: extras?.materials || [],
    outsourcing: extras?.outsourcing || [],
    contractors: extras?.contractors || [],
    expenses: extras?.expenses || [],
    contract: extras?.contract || null,
  };
}

function mapMaterial(row: Record<string, unknown>): ProductionMaterial {
  const quantity = num(row.quantity);
  const unitCost = num(row.unit_cost ?? row.unit_price);
  const lineCost = num(row.line_cost ?? row.total_price ?? quantity * unitCost);
  return {
    id: String(row.id),
    production_order_id: String(row.production_order_id),
    product_id: (row.product_id as string) || null,
    product_code: null,
    product_name: "",
    warehouse_id: (row.warehouse_id as string) || null,
    warehouse_name: (row.warehouse_name as string) || null,
    quantity,
    unit: (row.unit as string) || "Ədəd",
    unit_cost: unitCost,
    line_cost: lineCost,
    inventory_mode: "standard",
    polywood_sale_mode: null,
    polywood_length_m: row.polywood_length_m == null ? null : num(row.polywood_length_m),
    stage_no: Math.max(1, Math.round(num(row.stage_no) || 1)),
    stage_label: (row.stage_label as string) || null,
    notes: (row.notes as string) || null,
    issued: Boolean(row.issued),
    issued_at: (row.issued_at as string) || null,
    created_by_name: (row.created_by_name as string) || null,
  };
}

type MaterialInsertInput = {
  production_order_id: string;
  product_id: string;
  product_code?: string | null;
  product_name: string;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  quantity: number;
  unit: string;
  unit_cost: number;
  polywood_sale_mode?: ProductionMaterial["polywood_sale_mode"] | null;
  stage_no: number;
  stage_label?: string | null;
  notes?: string | null;
  issued?: boolean;
  created_by?: string | null;
  created_by_name?: string | null;
};

function materialSchemaColumnFromError(error?: { message?: string; code?: string } | null): string | null {
  return productionSchemaColumnFromError(error) || outsourcingInsertColumnFromError(error);
}

/** Join product/warehouse metadata — never read product_code or product_name from production_materials. */
async function enrichMaterialRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  materials: ProductionMaterial[]
): Promise<ProductionMaterial[]> {
  if (!materials.length) return materials;

  const productIds = [...new Set(materials.map((material) => material.product_id).filter(Boolean))] as string[];
  const warehouseIds = [...new Set(materials.map((material) => material.warehouse_id).filter(Boolean))] as string[];

  const [productsRes, warehousesRes] = await Promise.all([
    productIds.length
      ? admin.from("products").select("id,code,name,unit,inventory_mode").in("id", productIds)
      : Promise.resolve({ data: [] as Product[] }),
    warehouseIds.length
      ? admin.from("warehouses").select("id,name").in("id", warehouseIds)
      : Promise.resolve({ data: [] as Warehouse[] }),
  ]);

  const productsById = new Map(((productsRes.data || []) as Product[]).map((product) => [product.id, product]));
  const warehousesById = new Map(
    ((warehousesRes.data || []) as Warehouse[]).map((warehouse) => [warehouse.id, warehouse])
  );

  return materials.map((material) => {
    const product = material.product_id ? productsById.get(material.product_id) : undefined;
    const warehouse = material.warehouse_id ? warehousesById.get(material.warehouse_id) : undefined;
    const isPolywood = product?.inventory_mode === POLYWOOD_INVENTORY_MODE;

    return {
      ...material,
      product_code: material.product_code || product?.code || null,
      product_name: material.product_name || product?.name || "",
      unit: material.unit || product?.unit || "Ədəd",
      warehouse_name: material.warehouse_name || warehouse?.name || null,
      inventory_mode: isPolywood ? POLYWOOD_INVENTORY_MODE : "standard",
      polywood_sale_mode: isPolywood ? material.polywood_sale_mode || "linear_m" : null,
    };
  });
}

async function selectMaterialRowById(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  materialId: string
): Promise<ProductionMaterial | null> {
  const result = await selectProductionMaterialsWithFallback<Record<string, unknown>>(async (columns) => {
    const { data, error } = await admin
      .from("production_materials")
      .select(columns)
      .eq("id", materialId)
      .maybeSingle();
    return { data: (data as Record<string, unknown> | null) ?? null, error };
  });
  if (!result.data) return null;
  const [material] = await enrichMaterialRows(admin, [
    mapMaterial(result.data as Record<string, unknown>),
  ]);
  return material || null;
}

async function selectMaterialsForOrder(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  options: {
    orderId: string;
    stageNo?: number;
    issued?: boolean;
    ids?: string[];
    orderCreatedAt?: boolean;
  }
): Promise<ProductionMaterial[]> {
  const result = await selectProductionMaterialsWithFallback<Record<string, unknown>[]>(async (columns) => {
    let query = admin
      .from("production_materials")
      .select(columns)
      .eq("production_order_id", options.orderId);
    if (options.orderCreatedAt && columns.split(",").includes("created_at")) {
      query = query.order("created_at");
    } else {
      query = query.order("id");
    }
    const { data, error } = await query;
    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  });
  if (!result.data?.length) return [];

  let materials = (result.data as Record<string, unknown>[]).map(mapMaterial);
  if (options.stageNo != null) {
    materials = materials.filter((material) => material.stage_no === options.stageNo);
  }
  if (options.issued != null) {
    materials = materials.filter((material) => material.issued === options.issued);
  }
  if (options.ids?.length) {
    materials = materials.filter((material) => options.ids!.includes(material.id));
  }
  return enrichMaterialRows(admin, materials);
}

async function insertMaterialRow(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  input: MaterialInsertInput
): Promise<{ error: string | null; material: ProductionMaterial | null }> {
  const item = buildStrictMaterialInsertPayload({
    production_order_id: input.production_order_id,
    product_id: input.product_id,
    warehouse_id: input.warehouse_id ?? null,
    quantity: input.quantity,
    unit: input.unit || null,
    unit_cost: input.unit_cost,
    notes: input.notes ?? null,
  });
  const safePayload = sanitizeMaterialPayload(item);
  const { data: inserted, error: insertError } = await insertSanitizedMaterialRow(admin, item);

  if (insertError || !inserted) {
    return { error: formatProductionDbError(insertError || "Material əlavə edilmədi"), material: null };
  }

  const materialId = String(inserted.id);
  const quantity = num(safePayload.quantity);
  const unitCost = num(safePayload.unit_price);

  return {
    error: null,
    material: {
      id: materialId,
      production_order_id: input.production_order_id,
      product_id: input.product_id,
      product_code: input.product_code ?? null,
      product_name: input.product_name,
      warehouse_id: input.warehouse_id ?? null,
      warehouse_name: input.warehouse_name ?? null,
      quantity,
      unit: safePayload.unit || input.unit || "Ədəd",
      unit_cost: unitCost,
      line_cost: quantity * unitCost,
      inventory_mode: input.polywood_sale_mode ? POLYWOOD_INVENTORY_MODE : "standard",
      polywood_sale_mode: input.polywood_sale_mode ?? null,
      polywood_length_m: null,
      stage_no: input.stage_no,
      stage_label: input.stage_label ?? null,
      notes: input.notes ?? null,
      issued: Boolean(input.issued),
      issued_at: null,
      created_by_name: input.created_by_name ?? null,
    },
  };
}

async function insertMaterialRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  rows: MaterialInsertInput[]
): Promise<string | null> {
  for (const row of rows) {
    const result = await insertMaterialRow(admin, row);
    if (result.error) return result.error;
  }
  return null;
}

async function updateMaterialOmittingMissingColumns(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  materialId: string,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  let payload: Record<string, unknown> = {};
  if (patch.issued !== undefined) payload.issued = patch.issued;
  if (patch.issued_at !== undefined) payload.issued_at = patch.issued_at;
  if (patch.polywood_length_m !== undefined) payload.polywood_length_m = patch.polywood_length_m;
  if (patch.polywood_cut_details !== undefined) payload.polywood_cut_details = patch.polywood_cut_details;

  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await admin.from("production_materials").update(payload as never).eq("id", materialId);
    if (!error) return { ok: true };
    const blocked = materialSchemaColumnFromError(error);
    if (!blocked || !(blocked in payload)) return { ok: false, error: error.message };
    delete payload[blocked];
  }
  return { ok: false, error: "production_materials schema mismatch" };
}

function mapExpense(row: Record<string, unknown>): ProductionExpense {
  const category = row.category as ProductionExpenseCategory;
  return {
    id: String(row.id),
    production_order_id: String(row.production_order_id),
    category: ["transport", "delivery", "installation", "tools", "other"].includes(category)
      ? category
      : "other",
    description: String(row.description || ""),
    amount: num(row.amount),
    expense_date: String(row.expense_date || "").slice(0, 10),
    account_id: (row.account_id as string) || null,
    account_name: (row.account_name as string) || null,
    finance_expense_id: (row.finance_expense_id as string) || null,
    notes: (row.notes as string) || null,
    created_by_name: (row.created_by_name as string) || null,
    created_at: (row.created_at as string) || null,
  };
}

function mapOutsourcing(row: Record<string, unknown>): ProductionOutsourcing {
  const description = String(row.material_description || row.description || "");
  const sqm = num(row.sqm_quantity);
  const price = num(row.price_per_sqm);
  return {
    id: String(row.id),
    production_order_id: String(row.production_order_id),
    supplier_id: (row.supplier_id as string) || null,
    supplier_name: (row.supplier_name as string) || null,
    material_description: description,
    sqm_quantity: sqm,
    price_per_sqm: price,
    total_cost: num(row.total_cost) || sqm * price,
    notes: (row.notes as string) || (row.description as string) || null,
  };
}

type OutsourcingInsertInput = {
  production_order_id: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  material_description: string;
  sqm_quantity: number;
  price_per_sqm: number;
  notes?: string | null;
};

/** Keep only known writable columns; omit undefined and empty optional values. */
function pickOutsourcingInsertPayload(row: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of OUTSOURCING_INSERT_COLUMNS) {
    if (!(key in row)) continue;
    const value = row[key];
    if (value === undefined) continue;
    if (OUTSOURCING_OPTIONAL_INSERT_COLUMNS.has(key) && (value === null || value === "")) continue;
    next[key] = value;
  }
  return next;
}

function outsourcingInsertColumnFromError(error?: { message?: string; code?: string } | null): string | null {
  const missing = missingColumnFromError(error);
  if (missing) return missing;
  const message = error?.message || "";
  const generated = message.match(/cannot insert a non-DEFAULT value into column '([^']+)'/i);
  if (generated?.[1]) return generated[1];
  return null;
}

/** Canonical Xarici kəsim row: mirrors text across description/notes for legacy schemas. */
function buildOutsourcingInsertPayload(input: OutsourcingInsertInput): Record<string, unknown> {
  return buildProductionOutsourcingInsertPayload({
    production_order_id: input.production_order_id,
    supplier_id: input.supplier_id,
    supplier_name: input.supplier_name,
    material_description: input.material_description,
    notes: input.notes,
    sqm_quantity: input.sqm_quantity,
    price_per_sqm: input.price_per_sqm,
  });
}

async function selectOutsourcingRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  options: { orderId?: string; orderIds?: string[]; limit?: number; orderCreatedAt?: boolean }
) {
  let columns: string[] = [...OUTSOURCING_FIELD_NAMES];
  for (let attempt = 0; attempt < 3; attempt++) {
    let query = admin.from("production_outsourcing").select(columns.join(","));
    if (options.orderId) query = query.eq("production_order_id", options.orderId);
    if (options.orderIds?.length) query = query.in("production_order_id", options.orderIds);
    if (options.orderCreatedAt) query = query.order("created_at");
    if (options.limit) query = query.limit(options.limit);
    const result = await query;
    if (!result.error) return result;
    const missing = missingColumnFromError(result.error);
    if (!missing || !columns.includes(missing)) return result;
    columns = columns.filter((column) => column !== missing);
  }
  return { data: null, error: { message: "production_outsourcing schema mismatch" } };
}

async function insertOutsourcingRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  rows: OutsourcingInsertInput[]
): Promise<{ error: string | null; rows: ProductionOutsourcing[] }> {
  let payload = rows.map((row) => buildOutsourcingInsertPayload(row));
  let selectColumns = [...OUTSOURCING_FIELD_NAMES];

  for (let attempt = 0; attempt < 8; attempt++) {
    const cleaned = payload.map((row) => pickOutsourcingInsertPayload(row));
    const select = selectColumns.join(",");
    const { data, error } = await admin
      .from("production_outsourcing")
      .insert(cleaned as never)
      .select(select);
    if (!error) {
      return {
        error: null,
        rows: ((data || []) as unknown as Record<string, unknown>[]).map(mapOutsourcing),
      };
    }
    const blocked = outsourcingInsertColumnFromError(error);
    if (!blocked || !payload.some((row) => blocked in row)) return { error: error.message, rows: [] };
    payload = payload.map((row) => {
      const next = { ...row };
      delete next[blocked];
      return pickOutsourcingInsertPayload(next);
    });
    if (selectColumns.includes(blocked as (typeof OUTSOURCING_FIELD_NAMES)[number])) {
      selectColumns = selectColumns.filter((column) => column !== blocked);
    }
  }
  return { error: "production_outsourcing schema mismatch", rows: [] };
}

function mapContractor(row: Record<string, unknown>): ProductionContractor {
  return {
    id: String(row.id),
    production_order_id: String(row.production_order_id),
    contractor_id: (row.contractor_id as string) || null,
    contractor_name: String(row.contractor_name || ""),
    commission_percentage: num(row.commission_percentage) || DEFAULT_CONTRACTOR_COMMISSION,
    calculated_fee: num(row.calculated_fee),
    notes: (row.notes as string) || null,
  };
}

function mapContract(row: Record<string, unknown>): ProductionContract {
  const advance = resolveContractAdvancePayment(row);
  const totalFromAmount = resolveContractTotalAmount(row);
  return {
    id: String(row.id),
    production_order_id: String(row.production_order_id),
    contract_no: resolveContractNumber(row) || "",
    contract_date: resolveContractDate(row),
    customer_id: resolveContractCustomerId(row),
    customer_name: resolveContractCustomerName(row),
    project_name: resolveContractProjectName(row) || (row.project_name as string) || null,
    project_scope: resolveContractProjectScope(row) || pickText(row, "project_scope", "content"),
    expected_delivery_date: resolveContractDeliveryDate(row) || (row.expected_delivery_date as string) || null,
    total_project_price: num(row.total_project_price) || totalFromAmount,
    installation_fee: num(row.installation_fee),
    advance_payment: advance,
    remaining_balance: num(row.remaining_balance) || resolveContractRemainingBalance(row),
    terms: pickText(row, "terms", "content", "terms_and_conditions"),
    notes: pickText(row, "notes"),
  };
}

function mapBomItem(row: Record<string, unknown>): ProductionBomItem {
  return {
    id: String(row.id),
    bom_id: String(row.bom_id),
    product_id: String(row.product_id),
    product_code: (row.product_code as string) || null,
    product_name: String(row.product_name || ""),
    warehouse_id: (row.warehouse_id as string) || null,
    warehouse_name: (row.warehouse_name as string) || null,
    quantity: num(row.quantity),
    unit: (row.unit as string) || "Ədəd",
    unit_cost: num(row.unit_cost),
  };
}

function bundleExtrasFromRow(row: Record<string, unknown>, expensesMissing = false) {
  const materials = Array.isArray(row.production_materials)
    ? (row.production_materials as Record<string, unknown>[])
    : [];
  const outsourcing = Array.isArray(row.production_outsourcing)
    ? (row.production_outsourcing as Record<string, unknown>[])
    : [];
  const contractors = Array.isArray(row.production_contractors)
    ? (row.production_contractors as Record<string, unknown>[])
    : [];
  const expenseRows = Array.isArray(row.production_expenses)
    ? (row.production_expenses as Record<string, unknown>[])
    : [];
  const contractRaw = row.production_contracts;
  const contractRow = Array.isArray(contractRaw)
    ? (contractRaw[0] as Record<string, unknown> | undefined)
    : (contractRaw as Record<string, unknown> | null | undefined);

  return {
    materials: materials.map(mapMaterial),
    outsourcing: outsourcing.map(mapOutsourcing),
    contractors: contractors.map(mapContractor),
    expenses: expensesMissing ? [] : expenseRows.map(mapExpense),
    contract: contractRow ? mapContract(contractRow) : null,
  };
}

function orderRowWithoutRelations(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  delete next.production_materials;
  delete next.production_outsourcing;
  delete next.production_contractors;
  delete next.production_expenses;
  delete next.production_contracts;
  return next;
}

async function loadOrderBundleRelational(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string
): Promise<ProductionOrder | null> {
  const dropped = new Set<string>();
  const droppedRelations = new Set<string>();
  const droppedContractColumns = new Set<string>();

  for (let attempt = 0; attempt < 8; attempt++) {
    const orderSelect = [...PRODUCTION_ORDER_CORE_COLUMNS, ...PRODUCTION_ORDER_OPTIONAL_COLUMNS]
      .filter((column) => !dropped.has(column))
      .join(",");
    const outsourcingSelect = OUTSOURCING_FIELD_NAMES.filter((column) => !dropped.has(column)).join(",");
    const materialSelect = PRODUCTION_MATERIAL_LIVE_COLUMNS.join(",");
    const relationParts = [
      `production_materials(${materialSelect})`,
      `production_outsourcing(${outsourcingSelect})`,
      `production_contractors(${CONTRACTOR_FIELDS})`,
    ];
    if (!droppedRelations.has("production_expenses")) {
      relationParts.splice(3, 0, `production_expenses(${EXPENSE_FIELDS})`);
    }
    if (!droppedRelations.has("production_contracts")) {
      relationParts.push(`production_contracts(${contractSelectColumns(droppedContractColumns)})`);
    }
    const select = [orderSelect, ...relationParts].join(",");

    const { data, error } = await admin.from("production_orders").select(select).eq("id", id).maybeSingle();
    if (!error && data) {
      const row = data as unknown as Record<string, unknown>;
      const extras = bundleExtrasFromRow(row, droppedRelations.has("production_expenses"));
      extras.materials = await enrichMaterialRows(admin, extras.materials);
      return asOrder(orderRowWithoutRelations(row), extras);
    }

    const missingTable = missingTableFromError(error);
    if (missingTable === "production_contracts") {
      droppedRelations.add("production_contracts");
      continue;
    }
    if (missingTable === "production_expenses") {
      droppedRelations.add("production_expenses");
      continue;
    }

    const missing = missingColumnFromError(error);
    if (missing && isProductionContractSelectColumn(missing)) {
      droppedContractColumns.add(missing);
      continue;
    }
    if (missing === "production_expenses" || isMissingRelation(error)) {
      droppedRelations.add("production_expenses");
      continue;
    }
    if (!missing || dropped.has(missing)) break;
    dropped.add(missing);
  }

  return null;
}

async function loadOrderBundleParallel(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string
): Promise<ProductionOrder | null> {
  const { data: order, error } = await selectProductionOrders(admin, { id, maybeSingle: true });
  if (error || !order) return null;

  const [materialsRes, outsourcingRes, contractorsRes, expensesRes, contract] = await Promise.all([
    selectMaterialsForOrder(admin, { orderId: id, orderCreatedAt: true }),
    selectOutsourcingRows(admin, { orderId: id, orderCreatedAt: true }),
    admin.from("production_contractors").select(CONTRACTOR_FIELDS).eq("production_order_id", id).order("created_at"),
    admin.from("production_expenses").select(EXPENSE_FIELDS).eq("production_order_id", id).order("created_at"),
    selectProductionContractForOrder(admin, id),
  ]);

  return asOrder(order as Record<string, unknown>, {
    materials: materialsRes,
    outsourcing: ((outsourcingRes.data || []) as unknown as Record<string, unknown>[]).map(mapOutsourcing),
    contractors: ((contractorsRes.data || []) as Record<string, unknown>[]).map(mapContractor),
    expenses: isMissingRelation(expensesRes.error)
      ? []
      : ((expensesRes.data || []) as Record<string, unknown>[]).map(mapExpense),
    contract,
  });
}

async function loadOrderBundle(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string
): Promise<ProductionOrder | null> {
  const relational = await loadOrderBundleRelational(admin, id);
  if (relational) return relational;
  return loadOrderBundleParallel(admin, id);
}

async function loadProductionOrderHeader(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string
): Promise<ProductionOrder | null> {
  const { data, error } = await selectProductionOrders(admin, { id, maybeSingle: true });
  if (error || !data) return null;
  return asOrder(data as Record<string, unknown>);
}

function orderCollectionDelta(
  header: ProductionOrder,
  patch: Partial<
    Pick<
      ProductionOrder,
      | "materials"
      | "outsourcing"
      | "expenses"
      | "contractors"
      | "contract"
      | "status"
      | "materials_allocated"
      | "finished_goods_posted"
    >
  >
): ProductionOrder {
  return {
    ...header,
    materials: patch.materials ?? [],
    outsourcing: patch.outsourcing ?? [],
    expenses: patch.expenses ?? [],
    contractors: patch.contractors ?? [],
    contract: patch.contract ?? null,
    status: patch.status ?? header.status,
    materials_allocated: patch.materials_allocated ?? header.materials_allocated,
    finished_goods_posted: patch.finished_goods_posted ?? header.finished_goods_posted,
  };
}

async function recastContractorFee(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string,
  totalProjectPrice: number
) {
  const fee = (num(totalProjectPrice) * DEFAULT_CONTRACTOR_COMMISSION) / 100;
  await admin
    .from("production_contractors")
    .update({
      commission_percentage: DEFAULT_CONTRACTOR_COMMISSION,
      calculated_fee: fee,
    })
    .eq("production_order_id", orderId);
}

export interface ProductionLookups {
  customers: Customer[];
  products: Product[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  employees: Employee[];
  accounts: { id: string; code?: string | null; name: string; type?: string | null; balance?: number | null }[];
  boms: ProductionBom[];
}

export async function fetchProductionLookupsAction(): Promise<
  ProductionActionResult<ProductionLookups>
> {
  try {
    await requirePermissionAction("can_view_production");
    const admin = createSupabaseAdminClient();
    const [customers, products, warehouses, suppliers, employees, accounts, bomsRes] = await Promise.all([
      admin.from("customers").select("id,full_name,name,company_name").order("full_name").limit(250),
      admin.from("products").select("id,code,name,category,subcategory,unit,buy_price,sell_price,stock,min_stock,barcode,color,weight,extra_info,warehouse_id,inventory_mode,full_sheet_length_m").order("name").limit(500),
      admin.from("warehouses").select("id,code,name,location,is_default,warehouse_type").order("name").limit(100),
      admin.from("suppliers").select("id,code,full_name,company_name,phone,balance").order("full_name").limit(250),
      admin.from("employees").select("id,employee_code,full_name,role,department,phone,base_salary,default_commission,status").eq("status", "active").order("full_name").limit(250),
      admin.from("accounts").select("id,code,name,type,balance").order("name").limit(100),
      admin.from("production_boms").select(BOM_FIELDS).order("name").limit(250),
    ]);

    const bomRows = (bomsRes.data || []) as Record<string, unknown>[];
    const bomIds = bomRows.map((row) => String(row.id));
    let itemRows: Record<string, unknown>[] = [];
    if (bomIds.length) {
      const { data } = await admin
        .from("production_bom_items")
        .select(BOM_ITEM_FIELDS)
        .in("bom_id", bomIds)
        .limit(2000);
      itemRows = (data || []) as Record<string, unknown>[];
    }
    const itemsByBom = new Map<string, ProductionBomItem[]>();
    for (const item of itemRows.map(mapBomItem)) {
      const list = itemsByBom.get(item.bom_id) || [];
      list.push(item);
      itemsByBom.set(item.bom_id, list);
    }

    return {
      success: true,
      data: {
        customers: (customers.data as Customer[]) || [],
        products: (products.data as Product[]) || [],
        warehouses: (warehouses.data as Warehouse[]) || [],
        suppliers: (suppliers.data as Supplier[]) || [],
        employees: ((employees.data || []) as Record<string, unknown>[]).map(normalizeEmployee),
        accounts: ((accounts.data || []) as ProductionLookups["accounts"]),
        boms: bomRows.map((row) => ({
          id: String(row.id),
          finished_product_id: String(row.finished_product_id),
          name: String(row.name || ""),
          notes: (row.notes as string) || null,
          items: itemsByBom.get(String(row.id)) || [],
        })),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function listProductionOrdersAction(): Promise<
  ProductionActionResult<ProductionOrder[]>
> {
  try {
    await requirePermissionAction("can_view_production");
    const admin = createSupabaseAdminClient();
    const { data, error } = await selectProductionOrders(admin, {
      orderCreatedAtDesc: true,
      limit: 50,
    });
    if (error) return { success: false, error: error.message || "Failed" };

    const orders = ((data || []) as Record<string, unknown>[]).map((row) => asOrder(row));
    const ids = orders.map((o) => o.id);
    if (!ids.length) return { success: true, data: orders };

    const [materialsResult, outsourcingRes, contractorsRes, expensesRes] = await Promise.all([
      selectProductionMaterialsWithFallback<Record<string, unknown>[]>(async (columns) => {
        const { data, error } = await admin
          .from("production_materials")
          .select(columns)
          .in("production_order_id", ids)
          .limit(5000);
        return { data: (data as Record<string, unknown>[] | null) ?? null, error };
      }),
      selectOutsourcingRows(admin, { orderIds: ids, limit: 1000 }),
      admin.from("production_contractors").select(CONTRACTOR_FIELDS).in("production_order_id", ids).limit(500),
      admin.from("production_expenses").select(EXPENSE_FIELDS).in("production_order_id", ids).limit(2000),
    ]);

    const materials = await enrichMaterialRows(
      admin,
      ((materialsResult.data || []) as Record<string, unknown>[]).map(mapMaterial)
    );
    const outsourcing = ((outsourcingRes.data || []) as unknown as Record<string, unknown>[]).map(mapOutsourcing);
    const contractors = ((contractorsRes.data || []) as Record<string, unknown>[]).map(mapContractor);
    const expenses = isMissingRelation(expensesRes.error)
      ? []
      : ((expensesRes.data || []) as Record<string, unknown>[]).map(mapExpense);

    const groupByOrder = <T extends { production_order_id: string }>(rows: T[]) => {
      const grouped = new Map<string, T[]>();
      for (const row of rows) {
        const current = grouped.get(row.production_order_id);
        if (current) current.push(row);
        else grouped.set(row.production_order_id, [row]);
      }
      return grouped;
    };
    const materialsByOrder = groupByOrder(materials);
    const outsourcingByOrder = groupByOrder(outsourcing);
    const contractorsByOrder = groupByOrder(contractors);
    const expensesByOrder = groupByOrder(expenses);

    for (const order of orders) {
      order.materials = materialsByOrder.get(order.id) || [];
      order.outsourcing = outsourcingByOrder.get(order.id) || [];
      order.contractors = contractorsByOrder.get(order.id) || [];
      order.expenses = expensesByOrder.get(order.id) || [];
    }

    return { success: true, data: orders };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function getProductionOrderAction(
  id: string
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_view_production");
    const admin = createSupabaseAdminClient();
    const order = await loadOrderBundle(admin, id);
    if (!order) return { success: false, error: "İstehsalat sənədi tapılmadı" };
    return { success: true, data: order };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export interface CreateProductionOrderInput {
  production_model?: ProductionModel;
  type: ProductionOrderType;
  custom_workflow?: CustomWorkflow | null;
  project_name: string;
  customer_id?: string | null;
  customer_name?: string | null;
  ousta_id?: string | null;
  subcontractor_id?: string | null;
  subcontractor_fee_percent?: number;
  finished_product_id?: string | null;
  custom_product_id?: string | null;
  quantity?: number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  raw_material_warehouse_id?: string | null;
  furniture_warehouse_id?: string | null;
  total_project_price?: number;
  installation_fee?: number;
  advance_payment?: number;
  advance_account_id?: string | null;
  expected_delivery_date?: string | null;
  project_scope?: string | null;
  notes?: string | null;
  materials?: {
    product_id: string;
    warehouse_id?: string | null;
    warehouse_name?: string | null;
    quantity: number;
    unit_cost?: number;
    stage_no?: number;
    stage_label?: string | null;
    notes?: string | null;
  }[];
  outsourcing?: {
    supplier_id?: string | null;
    supplier_name?: string | null;
    material_description: string;
    sqm_quantity: number;
    price_per_sqm: number;
    notes?: string | null;
  }[];
  expenses?: {
    category: ProductionExpenseCategory;
    description: string;
    amount: number;
    expense_date?: string | null;
    account_id?: string | null;
    account_name?: string | null;
    notes?: string | null;
  }[];
  contractor?: {
    contractor_id?: string | null;
    contractor_name: string;
  } | null;
}

export async function createProductionOrderAction(
  input: CreateProductionOrderInput
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    const { user, profile } = await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();

    const productionModel = input.production_model
      ? normalizeProductionModel(input.production_model)
      : productionModelFromLegacy(
          normalizeType(normalizeProductionType(input.type ?? "")),
          input.custom_workflow
        );
    const legacy = legacyFromProductionModel(productionModel);
    const resolvedType = legacy.type;
    const resolvedWorkflow = legacy.custom_workflow;

    const projectName = input.project_name.trim();
    if (!projectName) return { success: false, error: "Layihə adı tələb olunur" };

    if (resolvedType === "Custom" && !resolvedWorkflow) {
      return { success: false, error: "Fərdi istehsalat üçün iş axını seçin" };
    }

    let finishedName: string | null = null;
    let finishedSellPrice = 0;
    const customProductId = input.custom_product_id || input.finished_product_id || null;

    if (resolvedType === "Series") {
      if (!input.finished_product_id) return { success: false, error: "Hazır məhsul seçin" };
      const { data: product } = await admin
        .from("products")
        .select("id, name, sell_price")
        .eq("id", input.finished_product_id)
        .maybeSingle();
      if (!product) return { success: false, error: "Hazır məhsul tapılmadı" };
      finishedName = product.name as string;
      finishedSellPrice = num(product.sell_price);

      const { data: bom } = await admin
        .from("production_boms")
        .select("id")
        .eq("finished_product_id", input.finished_product_id)
        .maybeSingle();
      if (!bom && !input.materials?.length) {
        return { success: false, error: "Bu məhsul üçün BOM seçin və ya materialları əl ilə əlavə edin" };
      }
    }
    if (resolvedType === "Custom" && customProductId) {
      const { data: product } = await admin
        .from("products")
        .select("id, name")
        .eq("id", customProductId)
        .maybeSingle();
      finishedName = product?.name ? String(product.name) : null;
    }

    const qty = Math.max(1, num(input.quantity) || 1);
    let totalPrice = num(input.total_project_price);
    if (resolvedType === "Series" && totalPrice <= 0 && finishedSellPrice > 0) {
      totalPrice = finishedSellPrice * qty;
    }
    const installFee = num(input.installation_fee);
    const advance = num(input.advance_payment);
    if (advance > 0 && !input.advance_account_id?.trim()) {
      return { success: false, error: "Avans üçün kassa/bank hesabı seçilməlidir" };
    }

    const subcontractorFeePercent =
      productionModel === "subcontractor_custom"
        ? num(input.subcontractor_fee_percent) || DEFAULT_CONTRACTOR_COMMISSION
        : 0;
    const subcontractorFeeAmount =
      productionModel === "subcontractor_custom"
        ? (totalPrice * subcontractorFeePercent) / 100
        : 0;

    const insertPayload = omitEmptyOptionalText({
      order_no: createDocNo(resolvedType === "Series" ? "PRS" : "PRC"),
      production_model: productionModel,
      type: resolvedType,
      custom_workflow: resolvedType === "Custom" ? resolvedWorkflow : null,
      status: normalizeStatus(PRODUCTION_STATUS_DEFAULT),
      project_name: projectName,
      customer_id: input.customer_id || null,
      customer_name: input.customer_name?.trim() || null,
      ousta_id: input.ousta_id || null,
      subcontractor_id:
        productionModel === "subcontractor_custom" ? input.subcontractor_id || null : null,
      subcontractor_fee_percent: subcontractorFeePercent,
      subcontractor_fee_amount: subcontractorFeeAmount,
      finished_product_id: resolvedType === "Series" ? input.finished_product_id || null : customProductId,
      finished_product_name: finishedName,
      custom_product_id: resolvedType === "Custom" ? customProductId : null,
      quantity: qty,
      warehouse_id: input.warehouse_id || null,
      warehouse_name: input.warehouse_name || null,
      raw_material_warehouse_id: input.raw_material_warehouse_id || input.warehouse_id || null,
      furniture_warehouse_id: input.furniture_warehouse_id || input.warehouse_id || null,
      total_project_price: totalPrice,
      installation_fee: installFee,
      advance_payment: advance,
      advance_account_id: input.advance_account_id?.trim() || null,
      expected_delivery_date: input.expected_delivery_date || null,
      project_scope: input.project_scope?.trim() || null,
      terms: resolvedType === "Custom" ? DEFAULT_CONTRACT_TERMS_AZ : null,
      notes: input.notes?.trim() || null,
      created_by: user.id,
    });

    const inserted = await mutateOmittingMissingColumns<Record<string, unknown>>(
      async (payload) => {
        const { data, error } = await insertProductionOrders(admin, payload)
          .select("id,order_no,type,status,project_name,customer_id,customer_name,finished_product_id,finished_product_name,quantity,warehouse_id,warehouse_name,total_project_price,installation_fee,advance_payment,expected_delivery_date,materials_allocated,finished_goods_posted,created_at")
          .single();
        return { data: (data as Record<string, unknown>) || null, error };
      },
      insertPayload,
      { foldText: { project_scope: "notes", terms: "notes", terms_and_conditions: "notes" } }
    );

    if (inserted.error || !inserted.data) {
      return { success: false, error: inserted.error || "Sənəd yaradılmadı" };
    }
    const orderRow = inserted.data;

    const orderId = orderRow.id as string;

    if (resolvedType === "Series" && input.finished_product_id && !(input.materials?.length)) {
      const { data: bom } = await admin
        .from("production_boms")
        .select(BOM_FIELDS)
        .eq("finished_product_id", input.finished_product_id)
        .maybeSingle();
      if (bom) {
        const { data: bomItems } = await admin
          .from("production_bom_items")
          .select(BOM_ITEM_FIELDS)
          .eq("bom_id", String((bom as Record<string, unknown>).id));
        const rows = ((bomItems || []) as Record<string, unknown>[]).map((item) => {
          const lineQty = num(item.quantity) * qty;
          const unitCost = num(item.unit_cost);
          return {
            production_order_id: orderId,
            product_id: item.product_id,
            product_code: item.product_code,
            product_name: item.product_name,
            warehouse_id: item.warehouse_id,
            warehouse_name: item.warehouse_name,
            quantity: lineQty,
            unit: item.unit || "Ədəd",
            unit_cost: unitCost,
            stage_no: 1,
            issued: false,
          };
        });
        if (rows.length) {
          const materialInputs: MaterialInsertInput[] = rows.map((row) => ({
            production_order_id: String(row.production_order_id),
            product_id: String(row.product_id),
            product_code: (row.product_code as string) || null,
            product_name: String(row.product_name),
            warehouse_id: (row.warehouse_id as string) || null,
            warehouse_name: (row.warehouse_name as string) || null,
            quantity: num(row.quantity),
            unit: String(row.unit || "Ədəd"),
            unit_cost: num(row.unit_cost),
            stage_no: num(row.stage_no) || 1,
            issued: false,
          }));
          const matError = await insertMaterialRows(admin, materialInputs);
          if (matError) return { success: false, error: matError };
        }
      }
    }

    const failCreatedOrder = async (message: string): Promise<ProductionActionResult<ProductionOrder>> => {
      await admin.from("production_orders").delete().eq("id", orderId);
      return { success: false, error: message };
    };

    if (input.materials?.length) {
      const productIds = [...new Set(input.materials.map((row) => row.product_id).filter(Boolean))];
      const { data: products, error: productsError } = await admin
        .from("products")
        .select("id,code,name,unit,buy_price,warehouse_id,inventory_mode")
        .in("id", productIds);
      if (productsError) return failCreatedOrder(productsError.message);

      const productsById = new Map(
        ((products || []) as Product[]).map((product) => [product.id, product])
      );
      const materialInputs: MaterialInsertInput[] = [];
      for (const item of input.materials) {
        const product = productsById.get(item.product_id);
        const quantity = num(item.quantity);
        if (!product || quantity <= 0) continue;
        const unitCost = item.unit_cost == null ? num(product.buy_price) : num(item.unit_cost);
        materialInputs.push({
          production_order_id: orderId,
          product_id: product.id,
          product_code: product.code,
          product_name: product.name,
          warehouse_id: item.warehouse_id || product.warehouse_id || input.warehouse_id || null,
          warehouse_name: item.warehouse_name || input.warehouse_name || null,
          quantity,
          unit: product.unit || "Ədəd",
          unit_cost: unitCost,
          stage_no: Math.max(1, Math.round(num(item.stage_no) || 1)),
          stage_label: item.stage_label?.trim() || null,
          notes: item.notes?.trim() || null,
          issued: false,
          created_by: user.id,
        });
      }

      if (materialInputs.length !== input.materials.length) {
        return failCreatedOrder("Material siyahısında etibarsız məhsul və ya miqdar var");
      }
      const materialsError = await insertMaterialRows(admin, materialInputs);
      if (materialsError) return failCreatedOrder(materialsError);
    }

    if (input.outsourcing?.length) {
      const rows: OutsourcingInsertInput[] = [];
      for (const item of input.outsourcing) {
        const quantity = num(item.sqm_quantity);
        const price = num(item.price_per_sqm);
        const description = item.material_description?.trim();
        if (!description || quantity <= 0 || price < 0) continue;
        rows.push({
          production_order_id: orderId,
          supplier_id: item.supplier_id || null,
          supplier_name: item.supplier_name?.trim() || null,
          material_description: description,
          sqm_quantity: quantity,
          price_per_sqm: price,
          notes: item.notes?.trim() || null,
        });
      }
      if (rows.length !== input.outsourcing.length) {
        return failCreatedOrder("Xarici xidmət siyahısında etibarsız sətir var");
      }
      const outsourcingResult = await insertOutsourcingRows(admin, rows);
      if (outsourcingResult.error) return failCreatedOrder(outsourcingResult.error);
    }

    if (input.contractor?.contractor_name?.trim()) {
      const { error: contractorError } = await admin.from("production_contractors").insert([
        {
          production_order_id: orderId,
          contractor_id: input.contractor.contractor_id || null,
          contractor_name: input.contractor.contractor_name.trim(),
          commission_percentage: subcontractorFeePercent || DEFAULT_CONTRACTOR_COMMISSION,
          calculated_fee: subcontractorFeeAmount || (totalPrice * DEFAULT_CONTRACTOR_COMMISSION) / 100,
        },
      ]);
      if (contractorError) return failCreatedOrder(contractorError.message);
    }

    for (const item of input.expenses || []) {
      const description = item.description?.trim();
      const amount = num(item.amount);
      if (
        !description ||
        amount <= 0 ||
        !(PRODUCTION_EXPENSE_CATEGORIES as readonly string[]).includes(item.category)
      ) {
        return failCreatedOrder("Yan xərc siyahısında etibarsız sətir var");
      }

      if (item.account_id) {
        const posted = await postFinanceSideExpense({
          amount,
          accountId: item.account_id,
          orderId,
          orderNo: String(orderRow.order_no),
          description,
          category: item.category,
          expenseDate: item.expense_date,
          accountName: item.account_name,
          notes: item.notes,
          actorName: actorName(profile),
        });
        if (!posted.ok) return failCreatedOrder(posted.error);
        continue;
      }

      const expensePayload = buildProductionExpenseInsertPayload({
        production_order_id: orderId,
        category: item.category,
        description,
        amount,
        expense_date: item.expense_date,
        account_id: item.account_id,
        account_name: item.account_name,
        notes: item.notes,
        created_by: user.id,
      });
      const { error: expenseError } = await admin
        .from("production_expenses")
        .insert([expensePayload] as never);
      if (expenseError) return failCreatedOrder(expenseError.message);
    }

    const reservationResult = await syncProductionReservations(admin, orderId);
    if (!reservationResult.ok) return failCreatedOrder(reservationResult.error || "Material rezervasiyası yaradılmadı");

    const bundled = await loadOrderBundle(admin, orderId);
    if (bundled && advance > 0) {
      const adv = await syncProductionAdvancePayment(admin, bundled, {
        accountId: input.advance_account_id,
      });
      if (!adv.ok) return failCreatedOrder(adv.error || "Avans ödənişi qeydə alınmadı");
    }

    const order = await loadOrderBundle(admin, orderId);
    return { success: true, data: order || asOrder(orderRow as Record<string, unknown>) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

async function syncProductionAdvancePayment(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  order: ProductionOrder,
  options?: { accountId?: string | null; amount?: number }
): Promise<{ ok: boolean; error?: string }> {
  if (order.advance_transaction_id) return { ok: true };

  const amount = options?.amount ?? order.advance_payment;
  if (amount <= 0) return { ok: true };

  const accountId = (options?.accountId ?? order.advance_account_id)?.trim();
  if (!accountId) {
    return { ok: false, error: "Avans üçün kassa/bank hesabı seçilməlidir" };
  }
  if (!order.customer_id) {
    return { ok: false, error: "Avans üçün müştəri seçilməlidir" };
  }

  const posted = await recordProductionAdvancePayment(admin, {
    orderId: order.id,
    accountId,
    amount,
  });
  if (!posted.ok) return { ok: false, error: posted.error };
  return { ok: true };
}

export interface UpdateProductionOrderInput {
  project_name?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  total_project_price?: number;
  installation_fee?: number;
  advance_payment?: number;
  advance_account_id?: string | null;
  expected_delivery_date?: string | null;
  project_scope?: string | null;
  terms?: string | null;
  notes?: string | null;
}

export async function updateProductionOrderAction(
  id: string,
  patch: UpdateProductionOrderInput
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const current = await loadOrderBundle(admin, id);
    if (!current) return { success: false, error: "Sənəd tapılmadı" };

    const totalPrice =
      patch.total_project_price !== undefined ? num(patch.total_project_price) : current.total_project_price;
    const installFee =
      patch.installation_fee !== undefined ? num(patch.installation_fee) : current.installation_fee;
    const advance =
      patch.advance_payment !== undefined ? num(patch.advance_payment) : current.advance_payment;
    const advanceAccountId =
      patch.advance_account_id !== undefined
        ? patch.advance_account_id?.trim() || null
        : current.advance_account_id;

    if (advance > 0 && !advanceAccountId) {
      return { success: false, error: "Avans üçün kassa/bank hesabı seçilməlidir" };
    }

    const { error } = await mutateOmittingMissingColumns(
      async (payload) => {
        const result = await updateProductionOrders(admin, payload).eq("id", id).select("id").maybeSingle();
        return { data: result.data, error: result.error };
      },
      {
        project_name: patch.project_name?.trim() ?? current.project_name,
        customer_id: patch.customer_id === undefined ? current.customer_id : patch.customer_id,
        customer_name:
          patch.customer_name === undefined ? current.customer_name : patch.customer_name?.trim() || null,
        total_project_price: totalPrice,
        installation_fee: installFee,
        advance_payment: advance,
        advance_account_id: advanceAccountId,
        expected_delivery_date:
          patch.expected_delivery_date === undefined
            ? current.expected_delivery_date
            : patch.expected_delivery_date,
        project_scope:
          patch.project_scope === undefined ? current.project_scope : patch.project_scope?.trim() || null,
        terms: patch.terms === undefined ? current.terms : patch.terms,
        notes: patch.notes === undefined ? current.notes : patch.notes?.trim() || null,
        type: normalizeProductionType(current.type),
        status: current.status,
        updated_at: new Date().toISOString(),
      },
      { foldText: { project_scope: "notes", terms: "notes", terms_and_conditions: "notes" } }
    );

    if (error) return { success: false, error };

    if (current.custom_workflow === "subcontractor") {
      await recastContractorFee(admin, id, totalPrice);
    }

    const updatedOrder = await loadOrderBundle(admin, id);
    if (!updatedOrder) return { success: true, data: undefined };

    if (advance > 0 && !updatedOrder.advance_transaction_id) {
      const adv = await syncProductionAdvancePayment(admin, updatedOrder, {
        accountId: advanceAccountId,
        amount: advance,
      });
      if (!adv.ok) return { success: false, error: adv.error };
    }

    const order = await loadOrderBundle(admin, id);
    return { success: true, data: order || updatedOrder };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

async function runProductionMaterialIssueEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string,
  options?: { materialIds?: string[]; updateStatus?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin.rpc("process_production_material_issue_event", {
    p_order_id: orderId,
    p_material_ids: options?.materialIds?.length ? options.materialIds : null,
    p_update_status: options?.updateStatus ?? null,
  });

  if (error) return { ok: false, error: error.message };

  const payload = (data ?? null) as { success?: boolean; error?: string } | null;
  if (payload?.success === false && payload.error) {
    return { ok: false, error: String(payload.error) };
  }

  return { ok: true };
}

async function runProductionReadyEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin.rpc("process_production_ready_event", {
    p_order_id: orderId,
  });

  if (error) return { ok: false, error: error.message };

  const payload = (data ?? null) as { success?: boolean; error?: string } | null;
  if (payload?.success === false && payload.error) {
    return { ok: false, error: String(payload.error) };
  }

  return { ok: true };
}

async function issueMaterialRow(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  material: ProductionMaterial,
  options?: { updateStatus?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  if (material.issued) return { ok: true };

  if (material.product_id && material.inventory_mode === POLYWOOD_INVENTORY_MODE) {
    const polywood = await allocateProductionMaterialPolywood(admin, {
      productId: material.product_id,
      warehouseId: material.warehouse_id || "",
      quantity: material.quantity,
      polywoodMode:
        material.polywood_sale_mode ||
        (material.inventory_mode === POLYWOOD_INVENTORY_MODE ? "linear_m" : null),
      referenceId: material.id,
    });
    if (!polywood.ok) return { ok: false, error: polywood.error };

    await updateMaterialOmittingMissingColumns(admin, material.id, {
      polywood_length_m: polywood.polywoodLengthM ?? material.polywood_length_m,
      polywood_cut_details: (polywood.cutDetails as unknown as Record<string, unknown>) ?? null,
    });
  }

  const issued = await runProductionMaterialIssueEvent(admin, material.production_order_id, {
    materialIds: [material.id],
    updateStatus: options?.updateStatus ?? false,
  });
  if (!issued.ok) {
    return {
      ok: false,
      error: issued.error?.startsWith("Material çıxışı:")
        ? issued.error
        : `Material çıxışı: ${issued.error || "xəta"}`,
    };
  }

  return { ok: true };
}

async function syncProductionReservations(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string
): Promise<{ ok: boolean; error?: string }> {
  const materials = await selectMaterialsForOrder(admin, { orderId });
  const rows = materials
    .filter((material) => !material.issued && material.product_id && num(material.quantity) > 0)
    .map((material) => ({
      production_order_id: orderId,
      production_material_id: material.id,
      product_id: material.product_id!,
      warehouse_id: material.warehouse_id || null,
      quantity: num(material.quantity),
      status: "reserved",
    }));
  if (!rows.length) return { ok: true };

  const { error } = await admin
    .from("production_stock_reservations")
    .upsert(rows, { onConflict: "production_material_id", ignoreDuplicates: true });
  if (error && !isMissingRelation(error)) return { ok: false, error: error.message };
  return { ok: true };
}

async function allocateOrderMaterials(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  order: ProductionOrder
): Promise<{ ok: boolean; error?: string }> {
  const pending = order.materials.filter((material) => !material.issued);

  if (!order.materials.length) {
    return { ok: false, error: "Material çıxışı: BOM material sətri tapılmadı" };
  }

  if (!pending.length) {
    return { ok: true };
  }

  for (const material of pending) {
    if (!material.product_id) continue;
    if (material.inventory_mode === POLYWOOD_INVENTORY_MODE) {
      const polywood = await allocateProductionMaterialPolywood(admin, {
        productId: material.product_id,
        warehouseId: material.warehouse_id || "",
        quantity: material.quantity,
        polywoodMode: material.polywood_sale_mode || "linear_m",
        referenceId: material.id,
      });
      if (!polywood.ok) {
        return {
          ok: false,
          error: `Material çıxışı: ${material.product_name || material.product_code}: ${polywood.error}`,
        };
      }
      await updateMaterialOmittingMissingColumns(admin, material.id, {
        polywood_length_m: polywood.polywoodLengthM ?? material.polywood_length_m,
        polywood_cut_details: (polywood.cutDetails as unknown as Record<string, unknown>) ?? null,
      });
    }
  }

  const issued = await runProductionMaterialIssueEvent(admin, order.id, { updateStatus: true });
  if (!issued.ok) {
    return {
      ok: false,
      error: issued.error?.startsWith("Material çıxışı:")
        ? issued.error
        : `Material çıxışı: ${issued.error || "xəta"}`,
    };
  }

  return { ok: true };
}

export async function updateProductionStatusAction(
  id: string,
  nextStatus: ProductionStatus,
  deliverOptions?: {
    advanceAccountId?: string | null;
    header?: UpdateProductionOrderInput;
  }
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();

    if (deliverOptions?.header && nextStatus === "Delivered") {
      const saved = await updateProductionOrderAction(id, deliverOptions.header);
      if (!saved.success) {
        return { success: false, error: saved.error || "Sifariş məlumatları saxlanılmadı" };
      }
    }

    const order = await loadOrderBundle(admin, id);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };

    const currentStatus = toProductionStatusDbKey(order.status);
    const next = toProductionStatusDbKey(nextStatus);
    const allowedNext = PRODUCTION_STATUS_NEXT[currentStatus];
    if (!allowedNext || allowedNext !== next) {
      return { success: false, error: "Status keçidi icazəli deyil" };
    }

    if (next === "In-Progress") {
      const alloc = await allocateOrderMaterials(admin, order);
      if (!alloc.ok) return { success: false, error: alloc.error || "Material çıxışı alınmadı" };
    }

    if (next === "Ready" && order.type === "Series") {
      const pendingMaterials = order.materials.filter((material) => !material.issued);
      if (pendingMaterials.length) {
        return {
          success: false,
          error: "Bütün BOM materialları verilməlidir (İstehsalda statusu)",
        };
      }
      if (!order.finished_goods_posted) {
        if (!order.finished_product_id) {
          return { success: false, error: "Hazır məhsul təyin edilməyib" };
        }
        const ready = await runProductionReadyEvent(admin, id);
        if (!ready.ok) {
          return { success: false, error: ready.error || "Hazır məhsul anbara yazılmadı" };
        }
        const updatedReady = await loadOrderBundle(admin, id);
        return { success: true, data: updatedReady || undefined };
      }
    }

    if (next === "Delivered") {
      const delivery = await completeProductionDelivery(
        admin,
        id,
        deliverOptions?.advanceAccountId ?? order.advance_account_id ?? null,
        order
      );
      if (!delivery.ok) {
        return { success: false, error: delivery.error || "Təhvil inteqrasiyası alınmadı" };
      }
      const updated = await loadOrderBundle(admin, id);
      return { success: true, data: updated || undefined };
    }

    if (next === "In-Progress") {
      const updatedInProgress = await loadOrderBundle(admin, id);
      return { success: true, data: updatedInProgress || undefined };
    }

    const { error } = await updateProductionOrders(admin, {
      status: next,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return { success: false, error: error.message };

    const updated = await loadOrderBundle(admin, id);
    return { success: true, data: updated || undefined };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

/** Manual delivery sync — runs atomic RPC without advancing workflow status first. */
export async function syncProductionDeliveryAction(
  id: string,
  accountId?: string | null
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const order = await loadOrderBundle(admin, id);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (normalizeProductionType(order.type) !== "Custom") {
      return { success: false, error: "Yalnız fərdi (Custom) sifarişlər üçün təhvil inteqrasiyası aktivdir" };
    }

    if (order.status === "Delivered" && !order.sale_id) {
      const { error: resetError } = await updateProductionOrders(admin, {
        status: "Ready",
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      if (resetError) return { success: false, error: resetError.message };
    }

    const effectiveAccountId = accountId ?? order.advance_account_id ?? null;
    const delivery = await completeProductionDelivery(admin, id, effectiveAccountId, {
      ...order,
      status: order.status === "Delivered" && !order.sale_id ? "Ready" : order.status,
    });
    if (!delivery.ok) {
      return { success: false, error: delivery.error || "Təhvil inteqrasiyası alınmadı" };
    }

    const updated = await loadOrderBundle(admin, id);
    return { success: true, data: updated || undefined };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export type { AddProductionMaterialInput } from "@/app/production/materialInsert";

export async function addProductionMaterialAction(
  orderId: string,
  input: AddProductionMaterialInput
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    const { user, profile } = await requireProductionIssuePermission();
    const admin = createSupabaseAdminClient();
    const order = await loadProductionOrderHeader(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.status === "Delivered") return { success: false, error: "Təhvil verilmiş sənədə material əlavə edilə bilməz" };

    const safeInput = sanitizeAddProductionMaterialInput(input);
    const qty = num(safeInput.quantity);
    if (qty <= 0) return { success: false, error: "Miqdar sıfırdan böyük olmalıdır" };

    const { data: product } = await admin
      .from("products")
      .select("id,code,name,unit,buy_price,warehouse_id,inventory_mode")
      .eq("id", safeInput.product_id)
      .maybeSingle();
    if (!product) return { success: false, error: "Məhsul tapılmadı" };
    const p = product as Product;
    const unitCost = num(p.buy_price);
    const inventoryMode = p.inventory_mode === POLYWOOD_INVENTORY_MODE ? POLYWOOD_INVENTORY_MODE : "standard";
    const stageNo = Math.max(1, Math.round(num(safeInput.stage_no) || 1));
    const issueNow = Boolean(safeInput.issue_now) || order.status !== "Draft";

    const insertedMaterial = await insertMaterialRow(admin, {
      production_order_id: orderId,
      product_id: p.id,
      product_code: p.code,
      product_name: p.name,
      warehouse_id: safeInput.warehouse_id || null,
      warehouse_name: safeInput.warehouse_name || null,
      quantity: qty,
      unit: inventoryMode === POLYWOOD_INVENTORY_MODE ? "Metr" : p.unit || "Ədəd",
      unit_cost: unitCost,
      polywood_sale_mode:
        inventoryMode === POLYWOOD_INVENTORY_MODE ? safeInput.polywood_sale_mode || "linear_m" : null,
      stage_no: stageNo,
      stage_label: safeInput.stage_label?.trim() || null,
      notes: safeInput.notes?.trim() || null,
      issued: false,
      created_by: user.id,
      created_by_name: actorName(profile),
    });

    if (insertedMaterial.error || !insertedMaterial.material) {
      return { success: false, error: formatProductionDbError(insertedMaterial.error || "Material əlavə edilmədi") };
    }
    let material = insertedMaterial.material;
    const reservationResult = await syncProductionReservations(admin, orderId);
    if (!reservationResult.ok) {
      await admin.from("production_materials").delete().eq("id", material.id);
      return { success: false, error: reservationResult.error || "Material rezervasiyası yaradılmadı" };
    }

    if (issueNow) {
      const alloc = await issueMaterialRow(admin, material);
      if (!alloc.ok) {
        await admin.from("production_materials").delete().eq("id", material.id);
        return { success: false, error: alloc.error || "Material çıxışı alınmadı" };
      }
      await updateProductionOrders(admin, { materials_allocated: true }).eq("id", orderId);
      const issuedMaterial = await selectMaterialRowById(admin, material.id);
      if (issuedMaterial) material = issuedMaterial;
    }

    return {
      success: true,
      data: orderCollectionDelta(order, {
        materials: [material],
        materials_allocated: issueNow ? true : order.materials_allocated,
      }),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function issueProductionStageAction(
  orderId: string,
  stageNo: number
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requireProductionIssuePermission();
    const admin = createSupabaseAdminClient();
    const order = await loadProductionOrderHeader(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.status === "Delivered") {
      return { success: false, error: "Təhvil verilmiş sənədə material verilə bilməz" };
    }

    const stage = Math.max(1, Math.round(stageNo));
    const pending = await selectMaterialsForOrder(admin, {
      orderId,
      stageNo: stage,
      issued: false,
    });
    if (!pending.length) return { success: false, error: "Bu mərhələdə verilməmiş material yoxdur" };

    for (const material of pending) {
      const result = await issueMaterialRow(admin, material);
      if (!result.ok) return { success: false, error: result.error || "Material çıxışı alınmadı" };
    }

    await updateProductionOrders(admin, { materials_allocated: true }).eq("id", orderId);
    const issuedMaterials = await selectMaterialsForOrder(admin, {
      orderId,
      ids: pending.map((row) => row.id),
    });
    return {
      success: true,
      data: orderCollectionDelta(order, {
        materials: issuedMaterials,
        materials_allocated: true,
      }),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function issueProductionMaterialAction(
  orderId: string,
  materialId: string
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requireProductionIssuePermission();
    const admin = createSupabaseAdminClient();
    const order = await loadProductionOrderHeader(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    const material = await selectMaterialRowById(admin, materialId);
    if (!material) return { success: false, error: "Material tapılmadı" };
    if (material.issued) {
      return { success: true, data: orderCollectionDelta(order, { materials: [material] }) };
    }

    const result = await issueMaterialRow(admin, material);
    if (!result.ok) return { success: false, error: result.error || "Material çıxışı alınmadı" };
    await updateProductionOrders(admin, { materials_allocated: true }).eq("id", orderId);
    const issuedMaterial = await selectMaterialRowById(admin, materialId);
    return {
      success: true,
      data: orderCollectionDelta(order, {
        materials: [issuedMaterial || material],
        materials_allocated: true,
      }),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function removeProductionMaterialAction(
  orderId: string,
  materialId: string
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requireProductionIssuePermission();
    const admin = createSupabaseAdminClient();
    const material = await selectMaterialRowById(admin, materialId);
    if (!material || material.production_order_id !== orderId) {
      return { success: false, error: "Material tapılmadı" };
    }
    if (material.issued) {
      return { success: false, error: "Anbardan çıxılmış material silinə bilməz" };
    }
    const { error } = await admin.from("production_materials").delete().eq("id", materialId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export interface AddOutsourcingInput {
  supplier_id?: string | null;
  supplier_name?: string | null;
  material_description: string;
  sqm_quantity: number;
  price_per_sqm: number;
  notes?: string | null;
}

export async function addProductionOutsourcingAction(
  orderId: string,
  input: AddOutsourcingInput
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const order = await loadProductionOrderHeader(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.type !== "Custom") return { success: false, error: "Xarici kəsim yalnız fərdi layihələrdədir" };

    const sqm = num(input.sqm_quantity);
    const price = num(input.price_per_sqm);
    if (!input.material_description.trim()) return { success: false, error: "Material təsviri tələb olunur" };
    if (sqm <= 0 || price < 0) return { success: false, error: "KV/m² və qiymət düzgün deyil" };

    const inserted = await insertOutsourcingRows(admin, [
      {
        production_order_id: orderId,
        supplier_id: input.supplier_id || null,
        supplier_name: input.supplier_name?.trim() || null,
        material_description: input.material_description.trim(),
        sqm_quantity: sqm,
        price_per_sqm: price,
        notes: input.notes?.trim() || null,
      },
    ]);
    if (inserted.error) return { success: false, error: inserted.error };

    return {
      success: true,
      data: orderCollectionDelta(order, { outsourcing: inserted.rows }),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function removeProductionOutsourcingAction(
  orderId: string,
  outsourcingId: string
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("production_outsourcing")
      .delete()
      .eq("id", outsourcingId)
      .eq("production_order_id", orderId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

async function postFinanceSideExpense(
  input: {
    amount: number;
    accountId: string;
    orderId: string;
    orderNo: string;
    description: string;
    category: ProductionExpenseCategory;
    expenseDate?: string | null;
    accountName?: string | null;
    notes?: string | null;
    actorName?: string | null;
  }
): Promise<{ ok: true; expenseId: string } | { ok: false; error: string }> {
  const notes = [input.notes, `İstehsalat ${input.orderNo}: ${input.description}`]
    .filter(Boolean)
    .join("\n")
    .slice(0, 500);
  const code = `EXP-${Math.floor(1000 + Math.random() * 9000)}`;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("create_production_expense_atomic", {
    p_production_order_id: input.orderId,
    p_code: code,
    p_category: input.category,
    p_description: input.description,
    p_amount: input.amount,
    p_expense_date: input.expenseDate || new Date().toISOString().slice(0, 10),
    p_account_id: input.accountId,
    p_account_name: input.accountName || null,
    p_notes: notes || null,
    p_actor_name: input.actorName || null,
  });
  if (error || !data) {
    return {
      ok: false,
      error:
        error?.message ||
        "Atomik istehsalat xərci yaradılmadı. production-migration.sql skriptini yenidən işə salın.",
    };
  }
  return { ok: true, expenseId: String(data) };
}

export interface AddProductionExpenseInput {
  category: ProductionExpenseCategory;
  description: string;
  amount: number;
  expense_date?: string | null;
  account_id?: string | null;
  account_name?: string | null;
  notes?: string | null;
}

export async function addProductionExpenseAction(
  orderId: string,
  input: AddProductionExpenseInput
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    const { user, profile } = await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const order = await loadProductionOrderHeader(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.status === "Delivered") {
      return { success: false, error: "Təhvil verilmiş sənədə xərc əlavə edilə bilməz" };
    }

    const description = input.description.trim();
    const amount = num(input.amount);
    if (!description) return { success: false, error: "Xərc təsviri tələb olunur" };
    if (amount <= 0) return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
    if (!(PRODUCTION_EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) {
      return { success: false, error: "Xərc kateqoriyası etibarsızdır" };
    }

    if (input.account_id) {
      const posted = await postFinanceSideExpense({
        amount,
        accountId: input.account_id,
        orderId,
        orderNo: order.order_no,
        description,
        category: input.category,
        expenseDate: input.expense_date,
        accountName: input.account_name,
        notes: input.notes,
        actorName: actorName(profile),
      });
      if (!posted.ok) return { success: false, error: posted.error };
      const { data: expenseRow } = await admin
        .from("production_expenses")
        .select(EXPENSE_FIELDS)
        .eq("id", posted.expenseId)
        .maybeSingle();
      if (!expenseRow) return { success: true };
      return {
        success: true,
        data: orderCollectionDelta(order, {
          expenses: [mapExpense(expenseRow as Record<string, unknown>)],
        }),
      };
    }

    const expensePayload = buildProductionExpenseInsertPayload({
      production_order_id: orderId,
      category: input.category,
      description,
      amount,
      expense_date: input.expense_date,
      account_id: input.account_id,
      account_name: input.account_name,
      notes: input.notes,
      created_by: user.id,
      created_by_name: actorName(profile),
    });
    const { data, error } = await admin
      .from("production_expenses")
      .insert([expensePayload] as never)
      .select(EXPENSE_FIELDS)
      .single();
    if (error || !data) return { success: false, error: error?.message || "Xərc əlavə edilmədi" };

    return {
      success: true,
      data: orderCollectionDelta(order, {
        expenses: [mapExpense(data as Record<string, unknown>)],
      }),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function removeProductionExpenseAction(
  orderId: string,
  expenseId: string
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const { data: expense } = await admin
      .from("production_expenses")
      .select("id,finance_expense_id")
      .eq("id", expenseId)
      .eq("production_order_id", orderId)
      .maybeSingle();
    if (!expense) return { success: false, error: "Xərc tapılmadı" };
    if ((expense as { finance_expense_id?: string | null }).finance_expense_id) {
      return {
        success: false,
        error: "Maliyyəyə yazılmış xərc silinə bilməz. Kassa/bank qeydini maliyyə modulundan idarə edin.",
      };
    }
    const { error } = await admin.from("production_expenses").delete().eq("id", expenseId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function assignProductionContractorAction(
  orderId: string,
  input: { contractor_id?: string | null; contractor_name: string; notes?: string | null }
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const order = await loadOrderBundle(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.type !== "Custom" || order.custom_workflow !== "subcontractor") {
      return { success: false, error: "Podratçı yalnız faizlə müqavilə iş axınında təyin olunur" };
    }
    if (!input.contractor_name.trim()) return { success: false, error: "Podratçı adı tələb olunur" };

    await admin.from("production_contractors").delete().eq("production_order_id", orderId);
    const fee = (order.total_project_price * DEFAULT_CONTRACTOR_COMMISSION) / 100;
    const { error } = await admin.from("production_contractors").insert([
      {
        production_order_id: orderId,
        contractor_id: input.contractor_id || null,
        contractor_name: input.contractor_name.trim(),
        commission_percentage: DEFAULT_CONTRACTOR_COMMISSION,
        calculated_fee: fee,
        notes: input.notes?.trim() || null,
      },
    ]);
    if (error) return { success: false, error: error.message };

    const updated = await loadOrderBundle(admin, orderId);
    return { success: true, data: updated || undefined };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function saveProductionContractAction(
  orderId: string
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const order = await loadOrderBundle(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.type !== "Custom") {
      return { success: false, error: "Seriya istehsalı pərakəndə satış fakturası ilə satılır" };
    }

    const contractNo = resolveContractNumber(order) || createDocNo("PC");
    const contractDate = formatContractDateYmd(order.contract?.contract_date, order.created_at);
    const terms = order.terms || DEFAULT_CONTRACT_TERMS_AZ;
    const projectScope = order.project_scope || order.notes || null;

    const contractSource = buildContractMappingSourceFromOrder(order, orderId, {
      contractNo,
      contractDate,
      terms,
      projectScope,
      projectName: order.project_name,
    });

    const written = await persistSanitizedContractRow(admin, {
      existingId: order.contract?.id || null,
      source: contractSource,
    });

    const payload = buildContractPayloadFromOrder(order, orderId, {
      contractNo,
      contractDate,
      terms,
      projectScope,
      projectName: order.project_name,
    });

    const syntheticOverrides = {
      contract_no: resolveContractNumber(payload) || resolveContractNumber(order) || contractNo,
      contract_date: formatContractDateYmd(payload.contract_date, contractDate),
      terms,
      project_scope: projectScope || undefined,
    };

    if (written.error) {
      if (
        isProductionContractsTableError({ message: written.error }) ||
        isMissingRelation({ message: written.error }) ||
        isProductionContractSchemaColumnError(written.error)
      ) {
        return {
          success: true,
          data: withPrintableProductionContract({
            ...order,
            terms: syntheticOverrides.terms,
            project_scope: syntheticOverrides.project_scope || order.project_scope,
            contract: buildSyntheticProductionContract(order, syntheticOverrides),
          }),
        };
      }
      return { success: false, error: formatProductionDbError(written.error) };
    }

    const persistedContract = await selectProductionContractForOrder(admin, orderId);
    const updated = await loadOrderBundle(admin, orderId);
    const base = updated || order;

    if (num(base.advance_payment) > 0 && !base.advance_transaction_id) {
      const adv = await syncProductionAdvancePayment(admin, base);
      if (!adv.ok) return { success: false, error: adv.error };
    }

    const afterAdvance = await loadOrderBundle(admin, orderId);
    const baseAfter = afterAdvance || base;
    const merged: ProductionOrder = {
      ...baseAfter,
      contract:
        persistedContract ||
        buildSyntheticProductionContract(order, syntheticOverrides),
    };

    return { success: true, data: withPrintableProductionContract(merged) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export interface SaveBomInput {
  finished_product_id: string;
  name: string;
  notes?: string | null;
  items: {
    product_id: string;
    product_code?: string | null;
    product_name: string;
    warehouse_id?: string | null;
    warehouse_name?: string | null;
    quantity: number;
    unit?: string | null;
    unit_cost: number;
  }[];
}

export async function listProductionBomsAction(): Promise<ProductionActionResult<ProductionBom[]>> {
  const lookups = await fetchProductionLookupsAction();
  if (!lookups.success) return { success: false, error: lookups.error || "Failed" };
  if (!lookups.data) return { success: false, error: "Failed" };
  return { success: true, data: lookups.data.boms };
}

export async function saveProductionBomAction(
  input: SaveBomInput
): Promise<ProductionActionResult<ProductionBom>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    if (!input.finished_product_id) return { success: false, error: "Hazır məhsul seçin" };
    if (!input.name.trim()) return { success: false, error: "BOM adı tələb olunur" };
    if (!input.items.length) return { success: false, error: "Ən azı bir xammal əlavə edin" };

    const { data: existing } = await admin
      .from("production_boms")
      .select("id")
      .eq("finished_product_id", input.finished_product_id)
      .maybeSingle();

    let bomId = existing?.id as string | undefined;
    if (bomId) {
      const { error } = await admin
        .from("production_boms")
        .update({
          name: input.name.trim(),
          notes: input.notes?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bomId);
      if (error) return { success: false, error: error.message };
      await admin.from("production_bom_items").delete().eq("bom_id", bomId);
    } else {
      const { data, error } = await admin
        .from("production_boms")
        .insert([
          {
            finished_product_id: input.finished_product_id,
            name: input.name.trim(),
            notes: input.notes?.trim() || null,
          },
        ])
        .select("id")
        .single();
      if (error || !data) return { success: false, error: error?.message || "BOM yaradılmadı" };
      bomId = data.id as string;
    }

    const rows = input.items.map((item) => ({
      bom_id: bomId,
      product_id: item.product_id,
      product_code: item.product_code || null,
      product_name: item.product_name,
      warehouse_id: item.warehouse_id || null,
      warehouse_name: item.warehouse_name || null,
      quantity: num(item.quantity),
      unit: item.unit || "Ədəd",
      unit_cost: num(item.unit_cost),
    }));
    const { error: itemsError } = await admin.from("production_bom_items").insert(rows);
    if (itemsError) return { success: false, error: itemsError.message };

    const { data: items } = await admin
      .from("production_bom_items")
      .select(BOM_ITEM_FIELDS)
      .eq("bom_id", bomId)
      .limit(2000);
    return {
      success: true,
      data: {
        id: bomId!,
        finished_product_id: input.finished_product_id,
        name: input.name.trim(),
        notes: input.notes?.trim() || null,
        items: ((items || []) as Record<string, unknown>[]).map(mapBomItem),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function deleteProductionBomAction(bomId: string): Promise<ProductionActionResult> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("production_boms").delete().eq("id", bomId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
