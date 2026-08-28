"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import { DEFAULT_CONTRACT_TERMS_AZ } from "@/lib/production/constants";
import {
  allocateProductionMaterial,
  fetchProductById,
  incrementStandardStock,
} from "@/lib/production/inventory";
import {
  DEFAULT_CONTRACTOR_COMMISSION,
  remainingBalance,
  type CustomWorkflow,
  type ProductionBom,
  type ProductionBomItem,
  type ProductionContract,
  type ProductionContractor,
  type ProductionMaterial,
  type ProductionOrder,
  type ProductionOrderType,
  type ProductionOutsourcing,
  type ProductionStatus,
} from "@/lib/production/types";
import type { Customer, Employee, Product, Supplier, Warehouse } from "@/types/database.types";
import { normalizeEmployee } from "@/types/database.types";

export type ProductionActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

function createDocNo(prefix: string): string {
  return `${prefix}-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asOrder(row: Record<string, unknown>, extras?: Partial<ProductionOrder>): ProductionOrder {
  return {
    id: String(row.id),
    order_no: String(row.order_no || ""),
    type: (row.type as ProductionOrderType) || "custom",
    custom_workflow: (row.custom_workflow as CustomWorkflow) || null,
    status: (row.status as ProductionStatus) || "draft",
    project_name: String(row.project_name || ""),
    customer_id: (row.customer_id as string) || null,
    customer_name: (row.customer_name as string) || null,
    finished_product_id: (row.finished_product_id as string) || null,
    finished_product_name: (row.finished_product_name as string) || null,
    quantity: num(row.quantity) || 1,
    warehouse_id: (row.warehouse_id as string) || null,
    warehouse_name: (row.warehouse_name as string) || null,
    total_project_price: num(row.total_project_price),
    installation_fee: num(row.installation_fee),
    advance_payment: num(row.advance_payment),
    remaining_balance: num(row.remaining_balance),
    expected_delivery_date: (row.expected_delivery_date as string) || null,
    project_scope: (row.project_scope as string) || null,
    terms: (row.terms as string) || null,
    notes: (row.notes as string) || null,
    materials_allocated: Boolean(row.materials_allocated),
    finished_goods_posted: Boolean(row.finished_goods_posted),
    created_at: (row.created_at as string) || null,
    materials: extras?.materials || [],
    outsourcing: extras?.outsourcing || [],
    contractors: extras?.contractors || [],
    contract: extras?.contract || null,
  };
}

function mapMaterial(row: Record<string, unknown>): ProductionMaterial {
  return {
    id: String(row.id),
    production_order_id: String(row.production_order_id),
    product_id: (row.product_id as string) || null,
    product_code: (row.product_code as string) || null,
    product_name: String(row.product_name || ""),
    warehouse_id: (row.warehouse_id as string) || null,
    warehouse_name: (row.warehouse_name as string) || null,
    quantity: num(row.quantity),
    unit: (row.unit as string) || "Ədəd",
    unit_cost: num(row.unit_cost),
    line_cost: num(row.line_cost),
    inventory_mode: (row.inventory_mode as string) || "standard",
    polywood_sale_mode: (row.polywood_sale_mode as ProductionMaterial["polywood_sale_mode"]) || null,
    polywood_length_m: row.polywood_length_m == null ? null : num(row.polywood_length_m),
  };
}

function mapOutsourcing(row: Record<string, unknown>): ProductionOutsourcing {
  return {
    id: String(row.id),
    production_order_id: String(row.production_order_id),
    supplier_id: (row.supplier_id as string) || null,
    supplier_name: (row.supplier_name as string) || null,
    material_description: String(row.material_description || ""),
    sqm_quantity: num(row.sqm_quantity),
    price_per_sqm: num(row.price_per_sqm),
    total_cost: num(row.total_cost),
    notes: (row.notes as string) || null,
  };
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
  return {
    id: String(row.id),
    production_order_id: String(row.production_order_id),
    contract_no: String(row.contract_no || ""),
    contract_date: String(row.contract_date || ""),
    customer_id: (row.customer_id as string) || null,
    customer_name: (row.customer_name as string) || null,
    project_name: (row.project_name as string) || null,
    project_scope: (row.project_scope as string) || null,
    expected_delivery_date: (row.expected_delivery_date as string) || null,
    total_project_price: num(row.total_project_price),
    installation_fee: num(row.installation_fee),
    advance_payment: num(row.advance_payment),
    remaining_balance: num(row.remaining_balance),
    terms: (row.terms as string) || null,
    notes: (row.notes as string) || null,
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

async function loadOrderBundle(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string
): Promise<ProductionOrder | null> {
  const { data: order, error } = await admin.from("production_orders").select("*").eq("id", id).maybeSingle();
  if (error || !order) return null;

  const [materialsRes, outsourcingRes, contractorsRes, contractRes] = await Promise.all([
    admin.from("production_materials").select("*").eq("production_order_id", id).order("created_at"),
    admin.from("production_outsourcing").select("*").eq("production_order_id", id).order("created_at"),
    admin.from("production_contractors").select("*").eq("production_order_id", id).order("created_at"),
    admin.from("production_contracts").select("*").eq("production_order_id", id).maybeSingle(),
  ]);

  return asOrder(order as Record<string, unknown>, {
    materials: ((materialsRes.data || []) as Record<string, unknown>[]).map(mapMaterial),
    outsourcing: ((outsourcingRes.data || []) as Record<string, unknown>[]).map(mapOutsourcing),
    contractors: ((contractorsRes.data || []) as Record<string, unknown>[]).map(mapContractor),
    contract: contractRes.data ? mapContract(contractRes.data as Record<string, unknown>) : null,
  });
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
  boms: ProductionBom[];
}

export async function fetchProductionLookupsAction(): Promise<
  ProductionActionResult<ProductionLookups>
> {
  try {
    await requirePermissionAction("can_view_production");
    const admin = createSupabaseAdminClient();
    const [customers, products, warehouses, suppliers, employees, bomsRes] = await Promise.all([
      admin.from("customers").select("*").order("full_name"),
      admin.from("products").select("*").order("name"),
      admin.from("warehouses").select("*").order("name"),
      admin.from("suppliers").select("*").order("full_name"),
      admin.from("employees").select("*").eq("status", "active").order("full_name"),
      admin.from("production_boms").select("*").order("name"),
    ]);

    const bomRows = (bomsRes.data || []) as Record<string, unknown>[];
    const bomIds = bomRows.map((row) => String(row.id));
    let itemRows: Record<string, unknown>[] = [];
    if (bomIds.length) {
      const { data } = await admin.from("production_bom_items").select("*").in("bom_id", bomIds);
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
    const { data, error } = await admin
      .from("production_orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return { success: false, error: error.message };

    const orders = ((data || []) as Record<string, unknown>[]).map((row) => asOrder(row));
    const ids = orders.map((o) => o.id);
    if (!ids.length) return { success: true, data: orders };

    const [materialsRes, outsourcingRes, contractorsRes] = await Promise.all([
      admin.from("production_materials").select("*").in("production_order_id", ids),
      admin.from("production_outsourcing").select("*").in("production_order_id", ids),
      admin.from("production_contractors").select("*").in("production_order_id", ids),
    ]);

    const materials = ((materialsRes.data || []) as Record<string, unknown>[]).map(mapMaterial);
    const outsourcing = ((outsourcingRes.data || []) as Record<string, unknown>[]).map(mapOutsourcing);
    const contractors = ((contractorsRes.data || []) as Record<string, unknown>[]).map(mapContractor);

    for (const order of orders) {
      order.materials = materials.filter((row) => row.production_order_id === order.id);
      order.outsourcing = outsourcing.filter((row) => row.production_order_id === order.id);
      order.contractors = contractors.filter((row) => row.production_order_id === order.id);
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
  type: ProductionOrderType;
  custom_workflow?: CustomWorkflow | null;
  project_name: string;
  customer_id?: string | null;
  customer_name?: string | null;
  finished_product_id?: string | null;
  quantity?: number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  total_project_price?: number;
  installation_fee?: number;
  advance_payment?: number;
  expected_delivery_date?: string | null;
  project_scope?: string | null;
  notes?: string | null;
}

export async function createProductionOrderAction(
  input: CreateProductionOrderInput
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    const { user } = await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();

    const projectName = input.project_name.trim();
    if (!projectName) return { success: false, error: "Layihə adı tələb olunur" };

    if (input.type === "custom" && !input.custom_workflow) {
      return { success: false, error: "Fərdi istehsalat üçün iş axını seçin" };
    }

    let finishedName: string | null = null;
    if (input.type === "series") {
      if (!input.finished_product_id) return { success: false, error: "Hazır məhsul seçin" };
      const { data: product } = await admin
        .from("products")
        .select("id, name")
        .eq("id", input.finished_product_id)
        .maybeSingle();
      if (!product) return { success: false, error: "Hazır məhsul tapılmadı" };
      finishedName = product.name as string;

      const { data: bom } = await admin
        .from("production_boms")
        .select("id")
        .eq("finished_product_id", input.finished_product_id)
        .maybeSingle();
      if (!bom) return { success: false, error: "Bu məhsul üçün BOM (resept) təyin edilməyib" };
    }

    const qty = Math.max(1, num(input.quantity) || 1);
    const totalPrice = num(input.total_project_price);
    const installFee = num(input.installation_fee);
    const advance = num(input.advance_payment);

    const { data: orderRow, error } = await admin
      .from("production_orders")
      .insert([
        {
          order_no: createDocNo(input.type === "series" ? "PRS" : "PRC"),
          type: input.type,
          custom_workflow: input.type === "custom" ? input.custom_workflow : null,
          status: "draft",
          project_name: projectName,
          customer_id: input.customer_id || null,
          customer_name: input.customer_name?.trim() || null,
          finished_product_id: input.finished_product_id || null,
          finished_product_name: finishedName,
          quantity: qty,
          warehouse_id: input.warehouse_id || null,
          warehouse_name: input.warehouse_name || null,
          total_project_price: totalPrice,
          installation_fee: installFee,
          advance_payment: advance,
          remaining_balance: remainingBalance(totalPrice, installFee, advance),
          expected_delivery_date: input.expected_delivery_date || null,
          project_scope: input.project_scope?.trim() || null,
          terms: input.type === "custom" ? DEFAULT_CONTRACT_TERMS_AZ : null,
          notes: input.notes?.trim() || null,
          created_by: user.id,
        },
      ])
      .select("*")
      .single();

    if (error || !orderRow) {
      return { success: false, error: error?.message || "Sənəd yaradılmadı" };
    }

    const orderId = orderRow.id as string;

    if (input.type === "series" && input.finished_product_id) {
      const { data: bom } = await admin
        .from("production_boms")
        .select("*")
        .eq("finished_product_id", input.finished_product_id)
        .maybeSingle();
      if (bom) {
        const { data: bomItems } = await admin
          .from("production_bom_items")
          .select("*")
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
            line_cost: lineQty * unitCost,
            inventory_mode: "standard",
          };
        });
        if (rows.length) {
          const { error: matError } = await admin.from("production_materials").insert(rows);
          if (matError) return { success: false, error: matError.message };
        }
      }
    }

    const order = await loadOrderBundle(admin, orderId);
    return { success: true, data: order || asOrder(orderRow as Record<string, unknown>) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export interface UpdateProductionOrderInput {
  project_name?: string;
  customer_id?: string | null;
  customer_name?: string | null;
  total_project_price?: number;
  installation_fee?: number;
  advance_payment?: number;
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

    const { error } = await admin
      .from("production_orders")
      .update({
        project_name: patch.project_name?.trim() ?? current.project_name,
        customer_id: patch.customer_id === undefined ? current.customer_id : patch.customer_id,
        customer_name:
          patch.customer_name === undefined ? current.customer_name : patch.customer_name?.trim() || null,
        total_project_price: totalPrice,
        installation_fee: installFee,
        advance_payment: advance,
        remaining_balance: remainingBalance(totalPrice, installFee, advance),
        expected_delivery_date:
          patch.expected_delivery_date === undefined
            ? current.expected_delivery_date
            : patch.expected_delivery_date,
        project_scope:
          patch.project_scope === undefined ? current.project_scope : patch.project_scope?.trim() || null,
        terms: patch.terms === undefined ? current.terms : patch.terms,
        notes: patch.notes === undefined ? current.notes : patch.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { success: false, error: error.message };

    if (current.custom_workflow === "subcontractor") {
      await recastContractorFee(admin, id, totalPrice);
    }

    const order = await loadOrderBundle(admin, id);
    return { success: true, data: order || undefined };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

async function allocateOrderMaterials(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  order: ProductionOrder
): Promise<{ ok: boolean; error?: string }> {
  if (order.materials_allocated) return { ok: true };

  for (const material of order.materials) {
    if (!material.product_id) continue;
    const product = await fetchProductById(admin, material.product_id);
    if (!product) return { ok: false, error: `${material.product_name}: məhsul tapılmadı` };
    if (product.inventory_mode !== POLYWOOD_INVENTORY_MODE) {
      const current = Number(product.stock) || 0;
      if (current + 1e-9 < material.quantity) {
        return { ok: false, error: `${product.name}: stok kifayət etmir (mövcud: ${current})` };
      }
    }
  }

  for (const material of order.materials) {
    if (!material.product_id) continue;
    const result = await allocateProductionMaterial(admin, {
      productId: material.product_id,
      warehouseId: material.warehouse_id || "",
      quantity: material.quantity,
      polywoodMode: material.polywood_sale_mode,
      referenceId: material.id,
    });
    if (!result.ok) return { ok: false, error: result.error };

    await admin
      .from("production_materials")
      .update({
        inventory_mode: result.inventoryMode,
        polywood_length_m: result.polywoodLengthM ?? material.polywood_length_m,
        polywood_cut_details: (result.cutDetails as unknown as Record<string, unknown>) ?? null,
      })
      .eq("id", material.id);
  }

  await admin.from("production_orders").update({ materials_allocated: true }).eq("id", order.id);
  return { ok: true };
}

export async function updateProductionStatusAction(
  id: string,
  nextStatus: ProductionStatus
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const order = await loadOrderBundle(admin, id);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };

    const allowed: Record<ProductionStatus, ProductionStatus[]> = {
      draft: ["in_progress"],
      in_progress: ["ready"],
      ready: ["delivered"],
      delivered: [],
    };
    if (!allowed[order.status].includes(nextStatus)) {
      return { success: false, error: "Status keçidi icazəli deyil" };
    }

    if (nextStatus === "in_progress") {
      const alloc = await allocateOrderMaterials(admin, order);
      if (!alloc.ok) return { success: false, error: alloc.error || "Material çıxışı alınmadı" };
    }

    if (nextStatus === "ready" && order.type === "series" && !order.finished_goods_posted) {
      if (!order.finished_product_id) {
        return { success: false, error: "Hazır məhsul təyin edilməyib" };
      }
      const posted = await incrementStandardStock(admin, order.finished_product_id, order.quantity);
      if (!posted.ok) return { success: false, error: posted.error || "Hazır məhsul anbara yazılmadı" };
      await admin.from("production_orders").update({ finished_goods_posted: true }).eq("id", id);
    }

    const { error } = await admin
      .from("production_orders")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { success: false, error: error.message };

    const updated = await loadOrderBundle(admin, id);
    return { success: true, data: updated || undefined };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export interface AddProductionMaterialInput {
  product_id: string;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  quantity: number;
  polywood_sale_mode?: "linear_m" | "full_sheet" | null;
}

export async function addProductionMaterialAction(
  orderId: string,
  input: AddProductionMaterialInput
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const order = await loadOrderBundle(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.status === "delivered") return { success: false, error: "Təhvil verilmiş sənədə material əlavə edilə bilməz" };

    const qty = num(input.quantity);
    if (qty <= 0) return { success: false, error: "Miqdar sıfırdan böyük olmalıdır" };

    const { data: product } = await admin.from("products").select("*").eq("id", input.product_id).maybeSingle();
    if (!product) return { success: false, error: "Məhsul tapılmadı" };
    const p = product as Product;
    const unitCost = num(p.buy_price);
    const inventoryMode = p.inventory_mode === POLYWOOD_INVENTORY_MODE ? POLYWOOD_INVENTORY_MODE : "standard";

    const { data: row, error } = await admin
      .from("production_materials")
      .insert([
        {
          production_order_id: orderId,
          product_id: p.id,
          product_code: p.code,
          product_name: p.name,
          warehouse_id: input.warehouse_id || null,
          warehouse_name: input.warehouse_name || null,
          quantity: qty,
          unit: inventoryMode === POLYWOOD_INVENTORY_MODE ? "Metr" : p.unit || "Ədəd",
          unit_cost: unitCost,
          line_cost: qty * unitCost,
          inventory_mode: inventoryMode,
          polywood_sale_mode: inventoryMode === POLYWOOD_INVENTORY_MODE ? input.polywood_sale_mode || "linear_m" : null,
        },
      ])
      .select("*")
      .single();

    if (error || !row) return { success: false, error: error?.message || "Material əlavə edilmədi" };

    if (order.materials_allocated || order.status !== "draft") {
      const alloc = await allocateProductionMaterial(admin, {
        productId: p.id,
        warehouseId: input.warehouse_id || "",
        quantity: qty,
        polywoodMode: input.polywood_sale_mode || "linear_m",
        referenceId: row.id as string,
      });
      if (!alloc.ok) {
        await admin.from("production_materials").delete().eq("id", String(row.id));
        return { success: false, error: alloc.error || "Material çıxışı alınmadı" };
      }
      await admin
        .from("production_materials")
        .update({
          polywood_length_m: alloc.polywoodLengthM ?? null,
          polywood_cut_details: (alloc.cutDetails as unknown as Record<string, unknown>) ?? null,
        })
        .eq("id", String(row.id));
    }

    const updated = await loadOrderBundle(admin, orderId);
    return { success: true, data: updated || undefined };
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
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const order = await loadOrderBundle(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.materials_allocated) {
      return { success: false, error: "Anbardan çıxılmış material silinə bilməz" };
    }
    const { error } = await admin.from("production_materials").delete().eq("id", materialId);
    if (error) return { success: false, error: error.message };
    const updated = await loadOrderBundle(admin, orderId);
    return { success: true, data: updated || undefined };
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
    const order = await loadOrderBundle(admin, orderId);
    if (!order) return { success: false, error: "Sənəd tapılmadı" };
    if (order.type !== "custom") return { success: false, error: "Xarici kəsim yalnız fərdi layihələrdədir" };

    const sqm = num(input.sqm_quantity);
    const price = num(input.price_per_sqm);
    if (!input.material_description.trim()) return { success: false, error: "Material təsviri tələb olunur" };
    if (sqm <= 0 || price < 0) return { success: false, error: "KV/m² və qiymət düzgün deyil" };

    const { error } = await admin.from("production_outsourcing").insert([
      {
        production_order_id: orderId,
        supplier_id: input.supplier_id || null,
        supplier_name: input.supplier_name?.trim() || null,
        material_description: input.material_description.trim(),
        sqm_quantity: sqm,
        price_per_sqm: price,
        total_cost: sqm * price,
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

export async function removeProductionOutsourcingAction(
  orderId: string,
  outsourcingId: string
): Promise<ProductionActionResult<ProductionOrder>> {
  try {
    await requirePermissionAction("can_manage_production");
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("production_outsourcing").delete().eq("id", outsourcingId);
    if (error) return { success: false, error: error.message };
    const updated = await loadOrderBundle(admin, orderId);
    return { success: true, data: updated || undefined };
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
    if (order.type !== "custom" || order.custom_workflow !== "subcontractor") {
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
    if (order.type !== "custom") {
      return { success: false, error: "Seriya istehsalı pərakəndə satış fakturası ilə satılır" };
    }

    const payload = {
      production_order_id: orderId,
      contract_no: order.contract?.contract_no || createDocNo("PC"),
      contract_date: order.contract?.contract_date || new Date().toISOString().slice(0, 10),
      customer_id: order.customer_id,
      customer_name: order.customer_name,
      project_name: order.project_name,
      project_scope: order.project_scope,
      expected_delivery_date: order.expected_delivery_date,
      total_project_price: order.total_project_price,
      installation_fee: order.installation_fee,
      advance_payment: order.advance_payment,
      remaining_balance: remainingBalance(
        order.total_project_price,
        order.installation_fee,
        order.advance_payment
      ),
      terms: order.terms || DEFAULT_CONTRACT_TERMS_AZ,
      notes: order.notes,
    };

    if (order.contract) {
      const { error } = await admin.from("production_contracts").update(payload).eq("id", order.contract.id);
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await admin.from("production_contracts").insert([payload]);
      if (error) return { success: false, error: error.message };
    }

    const updated = await loadOrderBundle(admin, orderId);
    return { success: true, data: updated || undefined };
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

    const { data: items } = await admin.from("production_bom_items").select("*").eq("bom_id", bomId);
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
