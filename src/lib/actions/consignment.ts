"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { adjustProductStockAtWarehouse, getProductStockAtWarehouse } from "@/lib/inventory/warehouseProductStock";
import {
  agingDays,
  remainingAfterMovement,
  CONSIGNMENT_AGING_DAYS,
  type ConsignmentDispatch,
  type ConsignmentDispatchItem,
  type ConsignmentInventoryRow,
  type ConsignmentMonthlyReport,
  type ConsignmentPartner,
  type ConsignmentReturn,
  type ConsignmentReturnedItem,
  type ConsignmentSoldItem,
} from "@/lib/consignment/types";
import type { Customer, Employee, Product, Warehouse } from "@/types/database.types";

export type ConsignmentActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

function createDocNo(prefix: string): string {
  return `${prefix}-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return String(value ?? "");
}

function mapPartner(row: Record<string, unknown>): ConsignmentPartner {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    company_name: (row.company_name as string) || null,
    phone: (row.phone as string) || null,
    address: (row.address as string) || null,
    voen: (row.voen as string) || null,
    customer_id: (row.customer_id as string) || null,
    notes: (row.notes as string) || null,
    is_active: row.is_active !== false,
    created_at: (row.created_at as string) || null,
  };
}

function parseItems(raw: unknown): ConsignmentDispatchItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = (item || {}) as Record<string, unknown>;
    return {
      product_id: str(row.product_id),
      product_code: (row.product_code as string) || null,
      product_name: str(row.product_name),
      category: (row.category as string) || null,
      unit: (row.unit as string) || "Ədəd",
      quantity: num(row.quantity),
      unit_price: num(row.unit_price),
    };
  });
}

function mapDispatch(row: Record<string, unknown>, partnerName?: string | null): ConsignmentDispatch {
  return {
    id: str(row.id),
    dispatch_no: str(row.dispatch_no),
    partner_id: str(row.partner_id),
    partner_name: partnerName || null,
    warehouse_id: (row.warehouse_id as string) || null,
    warehouse_name: (row.warehouse_name as string) || null,
    dispatch_date: str(row.dispatch_date),
    status: (row.status as ConsignmentDispatch["status"]) || "delivered",
    items: parseItems(row.items),
    notes: (row.notes as string) || null,
    sales_rep_id: (row.sales_rep_id as string) || null,
    sales_rep_name: (row.sales_rep_name as string) || null,
    created_at: (row.created_at as string) || null,
  };
}

function mapInventory(
  row: Record<string, unknown>,
  partnerName?: string | null
): ConsignmentInventoryRow {
  const last = (row.last_dispatch_at as string) || null;
  const days = agingDays(last);
  const remaining = remainingAfterMovement(
    num(row.delivered_qty),
    num(row.sold_qty),
    num(row.returned_qty)
  );
  return {
    id: str(row.id),
    partner_id: str(row.partner_id),
    partner_name: partnerName || null,
    product_id: str(row.product_id),
    product_code: (row.product_code as string) || null,
    product_name: str(row.product_name),
    category: (row.category as string) || null,
    unit: (row.unit as string) || "Ədəd",
    delivered_qty: num(row.delivered_qty),
    sold_qty: num(row.sold_qty),
    returned_qty: num(row.returned_qty),
    remaining_qty: remaining,
    unit_price: num(row.unit_price),
    last_dispatch_at: last,
    aging_days: days,
    is_aging: remaining > 0 && days >= CONSIGNMENT_AGING_DAYS,
  };
}

function mapReturn(row: Record<string, unknown>, partnerName?: string | null): ConsignmentReturn {
  return {
    id: str(row.id),
    return_no: str(row.return_no),
    partner_id: str(row.partner_id),
    partner_name: partnerName || null,
    warehouse_id: (row.warehouse_id as string) || null,
    warehouse_name: (row.warehouse_name as string) || null,
    return_date: str(row.return_date),
    items: parseItems(row.items),
    notes: (row.notes as string) || null,
    created_at: (row.created_at as string) || null,
  };
}

function mapReport(row: Record<string, unknown>, partnerName?: string | null): ConsignmentMonthlyReport {
  const soldRaw = Array.isArray(row.sold_items) ? row.sold_items : [];
  const sold_items: ConsignmentSoldItem[] = soldRaw.map((item) => {
    const r = (item || {}) as Record<string, unknown>;
    return {
      product_id: str(r.product_id),
      product_code: (r.product_code as string) || null,
      product_name: str(r.product_name),
      quantity_sold: num(r.quantity_sold),
      unit_price: num(r.unit_price),
      total_price: num(r.total_price),
    };
  });
  const returnedRaw = Array.isArray(row.returned_items) ? row.returned_items : [];
  const returned_items: ConsignmentReturnedItem[] = returnedRaw.map((item) => {
    const r = (item || {}) as Record<string, unknown>;
    return {
      product_id: str(r.product_id),
      product_code: (r.product_code as string) || null,
      product_name: str(r.product_name),
      quantity: num(r.quantity),
      unit: (r.unit as string) || null,
      unit_price: num(r.unit_price),
    };
  });
  return {
    id: str(row.id),
    report_no: str(row.report_no),
    partner_id: str(row.partner_id),
    partner_name: partnerName || null,
    report_period: str(row.report_period),
    sold_items,
    returned_items,
    total_amount: num(row.total_amount),
    invoice_id: (row.invoice_id as string) || null,
    notes: (row.notes as string) || null,
    sales_rep_id: (row.sales_rep_id as string) || null,
    sales_rep_name: (row.sales_rep_name as string) || null,
    created_at: (row.created_at as string) || null,
  };
}

export interface ConsignmentLookups {
  partners: ConsignmentPartner[];
  products: Product[];
  warehouses: Warehouse[];
  customers: Customer[];
  salesReps: Employee[];
}

export async function fetchConsignmentLookupsAction(): Promise<
  ConsignmentActionResult<ConsignmentLookups>
> {
  try {
    await requirePermissionAction("can_view_consignments");
    const admin = createSupabaseAdminClient();
    const [partners, products, warehouses, customers, employees] = await Promise.all([
      admin.from("consignment_partners").select("*").order("name"),
      admin.from("products").select("*").order("name"),
      admin.from("warehouses").select("*").order("name"),
      admin.from("customers").select("*").order("full_name"),
      admin.from("employees").select("*").eq("status", "active").order("full_name"),
    ]);
    return {
      success: true,
      data: {
        partners: ((partners.data || []) as Record<string, unknown>[]).map(mapPartner),
        products: (products.data as Product[]) || [],
        warehouses: (warehouses.data as Warehouse[]) || [],
        customers: (customers.data as Customer[]) || [],
        salesReps: (employees.data as Employee[]) || [],
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function saveConsignmentPartnerAction(input: {
  id?: string;
  name: string;
  company_name?: string | null;
  phone?: string | null;
  address?: string | null;
  voen?: string | null;
  customer_id?: string | null;
  notes?: string | null;
  is_active?: boolean;
}): Promise<ConsignmentActionResult<ConsignmentPartner>> {
  try {
    await requirePermissionAction("can_manage_consignments");
    const admin = createSupabaseAdminClient();
    const name = input.name.trim();
    if (!name) return { success: false, error: "Tərəfdaş adı tələb olunur" };

    if (input.id) {
      const { data, error } = await admin
        .from("consignment_partners")
        .update({
          name,
          company_name: input.company_name?.trim() || null,
          phone: input.phone?.trim() || null,
          address: input.address?.trim() || null,
          voen: input.voen?.trim() || null,
          customer_id: input.customer_id || null,
          notes: input.notes?.trim() || null,
          is_active: input.is_active !== false,
        })
        .eq("id", input.id)
        .select("*")
        .single();
      if (error || !data) return { success: false, error: error?.message || "Yenilənmədi" };
      return { success: true, data: mapPartner(data as Record<string, unknown>) };
    }

    const { data, error } = await admin
      .from("consignment_partners")
      .insert([
        {
          code: createDocNo("CP"),
          name,
          company_name: input.company_name?.trim() || null,
          phone: input.phone?.trim() || null,
          address: input.address?.trim() || null,
          voen: input.voen?.trim() || null,
          customer_id: input.customer_id || null,
          notes: input.notes?.trim() || null,
          is_active: true,
        },
      ])
      .select("*")
      .single();
    if (error || !data) return { success: false, error: error?.message || "Yaradılmadı" };
    return { success: true, data: mapPartner(data as Record<string, unknown>) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function listConsignmentDispatchesAction(): Promise<
  ConsignmentActionResult<ConsignmentDispatch[]>
> {
  try {
    await requirePermissionAction("can_view_consignments");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("consignment_dispatches")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return { success: false, error: error.message };
    const { data: partners } = await admin.from("consignment_partners").select("id, name, company_name");
    const nameById = new Map(
      ((partners || []) as Record<string, unknown>[]).map((p) => [
        str(p.id),
        str(p.company_name || p.name),
      ])
    );
    return {
      success: true,
      data: ((data || []) as Record<string, unknown>[]).map((row) =>
        mapDispatch(row, nameById.get(str(row.partner_id)))
      ),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function listConsignmentReturnsAction(): Promise<
  ConsignmentActionResult<ConsignmentReturn[]>
> {
  try {
    await requirePermissionAction("can_view_consignments");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("consignment_returns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return { success: false, error: error.message };
    const { data: partners } = await admin.from("consignment_partners").select("id, name, company_name");
    const nameById = new Map(
      ((partners || []) as Record<string, unknown>[]).map((p) => [
        str(p.id),
        str(p.company_name || p.name),
      ])
    );
    return {
      success: true,
      data: ((data || []) as Record<string, unknown>[]).map((row) =>
        mapReturn(row, nameById.get(str(row.partner_id)))
      ),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function createConsignmentDispatchAtomicAction(input: {
  dispatch_no?: string | null;
  partner_id: string;
  warehouse_id: string;
  warehouse_name?: string | null;
  dispatch_date: string;
  notes?: string | null;
  items: ConsignmentDispatchItem[];
  sales_rep_id?: string | null;
  sales_rep_name?: string | null;
}): Promise<ConsignmentActionResult<ConsignmentDispatch>> {
  try {
    const { user } = await requirePermissionAction("can_manage_consignments");
    const admin = createSupabaseAdminClient();
    const items = input.items.filter((item) => item.product_id && item.quantity > 0);
    if (!input.partner_id) return { success: false, error: "Tərəfdaş seçin" };
    if (!input.warehouse_id) return { success: false, error: "Anbar seçin" };
    if (!items.length) return { success: false, error: "Ən azı bir məhsul əlavə edin" };

    const { data, error } = await admin.rpc("create_consignment_dispatch_atomic", {
      p_payload: {
        dispatch_no: input.dispatch_no || null,
        partner_id: input.partner_id,
        warehouse_id: input.warehouse_id,
        warehouse_name: input.warehouse_name || null,
        dispatch_date: input.dispatch_date,
        notes: input.notes || null,
        sales_rep_id: input.sales_rep_id || null,
        sales_rep_name: input.sales_rep_name || null,
        items,
        created_by: user.id,
      },
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: mapDispatch(data as Record<string, unknown>, (data as Record<string, unknown>)?.partner_name as string) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function listConsignmentInventoryAction(filters?: {
  partnerId?: string;
  category?: string;
}): Promise<ConsignmentActionResult<ConsignmentInventoryRow[]>> {
  try {
    await requirePermissionAction("can_view_consignments");
    const admin = createSupabaseAdminClient();
    let query = admin.from("consignment_inventory").select("*").order("product_name");
    if (filters?.partnerId) query = query.eq("partner_id", filters.partnerId);
    const { data, error } = await query;
    if (error) return { success: false, error: error.message };

    const { data: partners } = await admin.from("consignment_partners").select("id, name, company_name");
    const nameById = new Map(
      ((partners || []) as Record<string, unknown>[]).map((p) => [
        str(p.id),
        str(p.company_name || p.name),
      ])
    );
    let rows = ((data || []) as Record<string, unknown>[]).map((row) =>
      mapInventory(row, nameById.get(str(row.partner_id)))
    );
    if (filters?.category && filters.category !== "all") {
      rows = rows.filter((row) => (row.category || "") === filters.category);
    }
    return { success: true, data: rows };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function createConsignmentReturnAction(input: {
  partner_id: string;
  warehouse_id: string;
  warehouse_name?: string | null;
  return_date: string;
  notes?: string | null;
  items: { product_id: string; quantity: number }[];
}): Promise<ConsignmentActionResult<ConsignmentReturn>> {
  try {
    const { user } = await requirePermissionAction("can_manage_consignments");
    const admin = createSupabaseAdminClient();
    const wanted = input.items.filter((item) => item.product_id && item.quantity > 0);
    if (!wanted.length) return { success: false, error: "Qaytarılacaq məhsul seçin" };
    if (!input.warehouse_id) return { success: false, error: "Anbar seçin" };

    const snapshot: ConsignmentDispatchItem[] = [];
    for (const item of wanted) {
      const { data: inv } = await admin
        .from("consignment_inventory")
        .select("*")
        .eq("partner_id", input.partner_id)
        .eq("product_id", item.product_id)
        .maybeSingle();
      if (!inv) return { success: false, error: "Tərəfdaş stokunda bu məhsul yoxdur" };
      const row = inv as Record<string, unknown>;
      const remaining = remainingAfterMovement(
        num(row.delivered_qty),
        num(row.sold_qty),
        num(row.returned_qty)
      );
      if (item.quantity - remaining > 1e-9) {
        return {
          success: false,
          error: `${str(row.product_name)}: qalıq ${remaining} ədəddir`,
        };
      }
      snapshot.push({
        product_id: item.product_id,
        product_code: (row.product_code as string) || null,
        product_name: str(row.product_name),
        category: (row.category as string) || null,
        unit: (row.unit as string) || "Ədəd",
        quantity: item.quantity,
        unit_price: num(row.unit_price),
      });
    }

    const now = new Date().toISOString();
    for (const item of wanted) {
      const { data: inv } = await admin
        .from("consignment_inventory")
        .select("*")
        .eq("partner_id", input.partner_id)
        .eq("product_id", item.product_id)
        .maybeSingle();
      const row = inv as Record<string, unknown>;
      const returned = num(row.returned_qty) + item.quantity;
      const delivered = num(row.delivered_qty);
      const sold = num(row.sold_qty);
      await admin
        .from("consignment_inventory")
        .update({
          returned_qty: returned,
          remaining_qty: remainingAfterMovement(delivered, sold, returned),
          updated_at: now,
        })
        .eq("id", str(row.id));
      await adjustProductStockAtWarehouse(admin, item.product_id, input.warehouse_id, item.quantity);
    }

    const { data: ret, error } = await admin
      .from("consignment_returns")
      .insert([
        {
          return_no: createDocNo("CR"),
          partner_id: input.partner_id,
          warehouse_id: input.warehouse_id,
          warehouse_name: input.warehouse_name || null,
          return_date: input.return_date,
          items: snapshot,
          notes: input.notes?.trim() || null,
          created_by: user.id,
        },
      ])
      .select("*")
      .single();
    if (error || !ret) return { success: false, error: error?.message || "Qaytarma yazılmadı" };

    const { data: partner } = await admin
      .from("consignment_partners")
      .select("name, company_name")
      .eq("id", input.partner_id)
      .maybeSingle();

    return {
      success: true,
      data: {
        id: str((ret as Record<string, unknown>).id),
        return_no: str((ret as Record<string, unknown>).return_no),
        partner_id: input.partner_id,
        partner_name: str(
          (partner as { company_name?: string; name?: string } | null)?.company_name ||
            (partner as { name?: string } | null)?.name
        ),
        warehouse_id: input.warehouse_id,
        warehouse_name: input.warehouse_name || null,
        return_date: input.return_date,
        items: snapshot,
        notes: input.notes?.trim() || null,
        created_at: now,
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function listConsignmentReportsAction(): Promise<
  ConsignmentActionResult<ConsignmentMonthlyReport[]>
> {
  try {
    await requirePermissionAction("can_view_consignments");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("consignment_monthly_reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return { success: false, error: error.message };
    const { data: partners } = await admin.from("consignment_partners").select("id, name, company_name");
    const nameById = new Map(
      ((partners || []) as Record<string, unknown>[]).map((p) => [
        str(p.id),
        str(p.company_name || p.name),
      ])
    );
    return {
      success: true,
      data: ((data || []) as Record<string, unknown>[]).map((row) =>
        mapReport(row, nameById.get(str(row.partner_id)))
      ),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function settleConsignmentPartnerAtomicAction(input: {
  report_no?: string | null;
  partner_id: string;
  report_period: string;
  notes?: string | null;
  return_warehouse_id?: string | null;
  lines: { product_id: string; quantity_sold: number; quantity_returned: number; unit_price?: number }[];
  sales_rep_id?: string | null;
  sales_rep_name?: string | null;
}): Promise<ConsignmentActionResult<ConsignmentMonthlyReport>> {
  try {
    const { user } = await requirePermissionAction("can_manage_consignments");
    const admin = createSupabaseAdminClient();
    if (!input.partner_id) return { success: false, error: "Tərəfdaş seçin" };
    if (!/^\d{4}-\d{2}$/.test(input.report_period)) {
      return { success: false, error: "Dövr YYYY-MM formatında olmalıdır" };
    }
    const lines = input.lines.filter(
      (line) => line.product_id && (line.quantity_sold > 0 || line.quantity_returned > 0)
    );
    if (!lines.length) return { success: false, error: "Satılan və ya qaytarılan məhsul daxil edin" };

    const { data, error } = await admin.rpc("settle_consignment_partner_atomic", {
      p_payload: {
        report_no: input.report_no || null,
        partner_id: input.partner_id,
        report_period: input.report_period,
        notes: input.notes || null,
        return_warehouse_id: input.return_warehouse_id || null,
        sales_rep_id: input.sales_rep_id || null,
        sales_rep_name: input.sales_rep_name || null,
        lines,
        created_by: user.id,
      },
    });
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: mapReport(data as Record<string, unknown>, (data as Record<string, unknown>)?.partner_name as string),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export interface ConsignmentBarcodeLine {
  product_id: string;
  product_code: string | null;
  product_name: string;
  category: string | null;
  unit: string;
  sell_price: number;
  available_stock: number;
}

// "Mövcud Qalıq" (live stock at the selected warehouse) as a server action, not
// a direct client-side call to an admin-client helper - createSupabaseAdminClient()
// must never run in the browser (see src/lib/supabaseAdmin.ts).
export async function fetchConsignmentSourceStockAction(
  productId: string,
  warehouseId: string
): Promise<ConsignmentActionResult<number>> {
  try {
    await requirePermissionAction("can_view_consignments");
    if (!productId || !warehouseId) return { success: true, data: 0 };
    const admin = createSupabaseAdminClient();
    const stock = await getProductStockAtWarehouse(admin, productId, warehouseId);
    return { success: true, data: stock };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function resolveConsignmentBarcodeAction(
  barcode: string,
  warehouseId: string
): Promise<ConsignmentActionResult<ConsignmentBarcodeLine>> {
  try {
    await requirePermissionAction("can_view_consignments");
    const trimmed = barcode.trim();
    if (!trimmed) return { success: false, error: "Barkod boşdur" };
    if (!warehouseId) return { success: false, error: "Əvvəlcə anbar seçin" };

    const admin = createSupabaseAdminClient();
    const { data: product } = await admin
      .from("products")
      .select("id, code, name, category, unit, sell_price, barcode, is_service")
      .eq("barcode", trimmed)
      .maybeSingle();
    const p = (product || {}) as Record<string, unknown>;
    if (!product || p.is_service) {
      return { success: false, error: "Məhsul tapılmadı" };
    }

    const available = await getProductStockAtWarehouse(admin, str(p.id), warehouseId);
    return {
      success: true,
      data: {
        product_id: str(p.id),
        product_code: (p.code as string) || null,
        product_name: str(p.name),
        category: (p.category as string) || null,
        unit: (p.unit as string) || "Ədəd",
        sell_price: num(p.sell_price),
        available_stock: available,
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export interface ConsignmentProductLookup {
  product_id: string;
  product_code: string | null;
  product_name: string;
  category: string | null;
  unit: string;
  sell_price: number;
}

// Initial-balance entry has no source warehouse (nothing is being deducted
// from anywhere - the stock already left the main warehouse in the past),
// so this is a plain barcode->product lookup with no stock check at all.
export async function resolveConsignmentProductBarcodeAction(
  barcode: string
): Promise<ConsignmentActionResult<ConsignmentProductLookup>> {
  try {
    await requirePermissionAction("can_view_consignments");
    const trimmed = barcode.trim();
    if (!trimmed) return { success: false, error: "Barkod boşdur" };

    const admin = createSupabaseAdminClient();
    const { data: product } = await admin
      .from("products")
      .select("id, code, name, category, unit, sell_price, barcode, is_service")
      .eq("barcode", trimmed)
      .maybeSingle();
    const p = (product || {}) as Record<string, unknown>;
    if (!product || p.is_service) {
      return { success: false, error: "Məhsul tapılmadı" };
    }

    return {
      success: true,
      data: {
        product_id: str(p.id),
        product_code: (p.code as string) || null,
        product_name: str(p.name),
        category: (p.category as string) || null,
        unit: (p.unit as string) || "Ədəd",
        sell_price: num(p.sell_price),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function setConsignmentInitialBalanceAtomicAction(input: {
  dispatch_no?: string | null;
  partner_id: string;
  balance_date: string;
  notes?: string | null;
  items: ConsignmentDispatchItem[];
}): Promise<ConsignmentActionResult<ConsignmentDispatch>> {
  try {
    const { user } = await requirePermissionAction("can_manage_consignments");
    const admin = createSupabaseAdminClient();
    const items = input.items.filter((item) => item.product_id && item.quantity > 0);
    if (!input.partner_id) return { success: false, error: "Tərəfdaş seçin" };
    if (!items.length) return { success: false, error: "Ən azı bir məhsul əlavə edin" };

    const { data, error } = await admin.rpc("set_consignment_initial_balance_atomic", {
      p_payload: {
        dispatch_no: input.dispatch_no || null,
        partner_id: input.partner_id,
        balance_date: input.balance_date,
        notes: input.notes || null,
        items,
        created_by: user.id,
      },
    });
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: mapDispatch(data as Record<string, unknown>, (data as Record<string, unknown>)?.partner_name as string),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
