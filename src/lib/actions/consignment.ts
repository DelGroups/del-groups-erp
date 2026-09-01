"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { incrementStandardStock } from "@/lib/production/inventory";
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
  type ConsignmentSoldItem,
} from "@/lib/consignment/types";
import type { Customer, Product, Warehouse } from "@/types/database.types";

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
  return {
    id: str(row.id),
    report_no: str(row.report_no),
    partner_id: str(row.partner_id),
    partner_name: partnerName || null,
    report_period: str(row.report_period),
    sold_items,
    total_amount: num(row.total_amount),
    invoice_id: (row.invoice_id as string) || null,
    notes: (row.notes as string) || null,
    created_at: (row.created_at as string) || null,
  };
}

export interface ConsignmentLookups {
  partners: ConsignmentPartner[];
  products: Product[];
  warehouses: Warehouse[];
  customers: Customer[];
}

export async function fetchConsignmentLookupsAction(): Promise<
  ConsignmentActionResult<ConsignmentLookups>
> {
  try {
    await requirePermissionAction("can_view_consignments");
    const admin = createSupabaseAdminClient();
    const [partners, products, warehouses, customers] = await Promise.all([
      admin.from("consignment_partners").select("*").order("name"),
      admin.from("products").select("*").order("name"),
      admin.from("warehouses").select("*").order("name"),
      admin.from("customers").select("*").order("full_name"),
    ]);
    return {
      success: true,
      data: {
        partners: ((partners.data || []) as Record<string, unknown>[]).map(mapPartner),
        products: (products.data as Product[]) || [],
        warehouses: (warehouses.data as Warehouse[]) || [],
        customers: (customers.data as Customer[]) || [],
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

export async function createConsignmentDispatchAction(input: {
  partner_id: string;
  warehouse_id: string;
  warehouse_name?: string | null;
  dispatch_date: string;
  notes?: string | null;
  items: ConsignmentDispatchItem[];
}): Promise<ConsignmentActionResult<ConsignmentDispatch>> {
  try {
    const { user } = await requirePermissionAction("can_manage_consignments");
    const admin = createSupabaseAdminClient();
    const items = input.items.filter((item) => item.product_id && item.quantity > 0);
    if (!input.partner_id) return { success: false, error: "Tərəfdaş seçin" };
    if (!input.warehouse_id) return { success: false, error: "Anbar seçin" };
    if (!items.length) return { success: false, error: "Ən azı bir məhsul əlavə edin" };

    for (const item of items) {
      const { data: product } = await admin
        .from("products")
        .select("id, name, stock")
        .eq("id", item.product_id)
        .maybeSingle();
      if (!product) return { success: false, error: `${item.product_name}: məhsul tapılmadı` };
      const stock = num((product as { stock?: number }).stock);
      if (stock + 1e-9 < item.quantity) {
        return {
          success: false,
          error: `${item.product_name}: anbar stoku kifayət etmir (mövcud: ${stock})`,
        };
      }
    }

    for (const item of items) {
      const { data: product } = await admin
        .from("products")
        .select("stock")
        .eq("id", item.product_id)
        .maybeSingle();
      const current = num((product as { stock?: number } | null)?.stock);
      const { error } = await admin
        .from("products")
        .update({ stock: current - item.quantity })
        .eq("id", item.product_id);
      if (error) return { success: false, error: error.message };
    }

    const dispatchNo = createDocNo("CD");
    const { data: dispatch, error } = await admin
      .from("consignment_dispatches")
      .insert([
        {
          dispatch_no: dispatchNo,
          partner_id: input.partner_id,
          warehouse_id: input.warehouse_id,
          warehouse_name: input.warehouse_name || null,
          dispatch_date: input.dispatch_date,
          status: "delivered",
          items,
          notes: input.notes?.trim() || null,
          created_by: user.id,
        },
      ])
      .select("*")
      .single();
    if (error || !dispatch) return { success: false, error: error?.message || "Qaimə yazılmadı" };

    const now = new Date().toISOString();
    for (const item of items) {
      const { data: existing } = await admin
        .from("consignment_inventory")
        .select("*")
        .eq("partner_id", input.partner_id)
        .eq("product_id", item.product_id)
        .maybeSingle();

      if (existing) {
        const row = existing as Record<string, unknown>;
        const delivered = num(row.delivered_qty) + item.quantity;
        const sold = num(row.sold_qty);
        const returned = num(row.returned_qty);
        await admin
          .from("consignment_inventory")
          .update({
            delivered_qty: delivered,
            remaining_qty: remainingAfterMovement(delivered, sold, returned),
            unit_price: item.unit_price || num(row.unit_price),
            product_name: item.product_name,
            product_code: item.product_code,
            category: item.category,
            unit: item.unit,
            last_dispatch_at: now,
            updated_at: now,
          })
          .eq("id", str(row.id));
      } else {
        await admin.from("consignment_inventory").insert([
          {
            partner_id: input.partner_id,
            product_id: item.product_id,
            product_code: item.product_code,
            product_name: item.product_name,
            category: item.category,
            unit: item.unit || "Ədəd",
            delivered_qty: item.quantity,
            sold_qty: 0,
            returned_qty: 0,
            remaining_qty: item.quantity,
            unit_price: item.unit_price,
            last_dispatch_at: now,
            updated_at: now,
          },
        ]);
      }
    }

    const { data: partner } = await admin
      .from("consignment_partners")
      .select("name, company_name")
      .eq("id", input.partner_id)
      .maybeSingle();
    return {
      success: true,
      data: mapDispatch(
        dispatch as Record<string, unknown>,
        str((partner as { company_name?: string; name?: string } | null)?.company_name ||
          (partner as { name?: string } | null)?.name)
      ),
    };
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
      const restored = await incrementStandardStock(admin, item.product_id, item.quantity);
      if (!restored.ok) return { success: false, error: restored.error || "Anbara qaytarılmadı" };
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

export async function saveConsignmentMonthlyReportAction(input: {
  partner_id: string;
  report_period: string;
  notes?: string | null;
  sold_items: { product_id: string; quantity_sold: number; unit_price?: number }[];
}): Promise<ConsignmentActionResult<ConsignmentMonthlyReport>> {
  try {
    const { user } = await requirePermissionAction("can_manage_consignments");
    const admin = createSupabaseAdminClient();
    if (!input.partner_id) return { success: false, error: "Tərəfdaş seçin" };
    if (!/^\d{4}-\d{2}$/.test(input.report_period)) {
      return { success: false, error: "Dövr YYYY-MM formatında olmalıdır" };
    }

    const { data: existing } = await admin
      .from("consignment_monthly_reports")
      .select("id")
      .eq("partner_id", input.partner_id)
      .eq("report_period", input.report_period)
      .maybeSingle();
    if (existing) return { success: false, error: "Bu tərəfdaş üçün həmin ay artıq hesabat yazılıb" };

    const soldItems: ConsignmentSoldItem[] = [];
    for (const line of input.sold_items.filter((item) => item.quantity_sold > 0)) {
      const { data: inv } = await admin
        .from("consignment_inventory")
        .select("*")
        .eq("partner_id", input.partner_id)
        .eq("product_id", line.product_id)
        .maybeSingle();
      if (!inv) return { success: false, error: "Məhsul tərəfdaş stokunda yoxdur" };
      const row = inv as Record<string, unknown>;
      const remaining = remainingAfterMovement(
        num(row.delivered_qty),
        num(row.sold_qty),
        num(row.returned_qty)
      );
      if (line.quantity_sold - remaining > 1e-9) {
        return {
          success: false,
          error: `${str(row.product_name)}: satılan miqdar qalıqdan (${remaining}) çoxdur`,
        };
      }
      const unitPrice = line.unit_price != null ? num(line.unit_price) : num(row.unit_price);
      soldItems.push({
        product_id: line.product_id,
        product_code: (row.product_code as string) || null,
        product_name: str(row.product_name),
        quantity_sold: line.quantity_sold,
        unit_price: unitPrice,
        total_price: line.quantity_sold * unitPrice,
      });
    }

    if (!soldItems.length) return { success: false, error: "Satılan məhsul daxil edin" };
    const totalAmount = soldItems.reduce((sum, item) => sum + item.total_price, 0);

    const { data: partner } = await admin
      .from("consignment_partners")
      .select("*")
      .eq("id", input.partner_id)
      .maybeSingle();
    if (!partner) return { success: false, error: "Tərəfdaş tapılmadı" };
    const partnerRow = partner as Record<string, unknown>;
    const partnerName = str(partnerRow.company_name || partnerRow.name);

    const now = new Date().toISOString();
    for (const item of soldItems) {
      const { data: inv } = await admin
        .from("consignment_inventory")
        .select("*")
        .eq("partner_id", input.partner_id)
        .eq("product_id", item.product_id)
        .maybeSingle();
      const row = inv as Record<string, unknown>;
      const sold = num(row.sold_qty) + item.quantity_sold;
      const delivered = num(row.delivered_qty);
      const returned = num(row.returned_qty);
      await admin
        .from("consignment_inventory")
        .update({
          sold_qty: sold,
          remaining_qty: remainingAfterMovement(delivered, sold, returned),
          updated_at: now,
        })
        .eq("id", str(row.id));
    }

    const invoiceNo = createDocNo("CNS");
    const { data: sale, error: saleError } = await admin
      .from("sales")
      .insert([
        {
          doc_no: invoiceNo,
          invoice_number: invoiceNo,
          doc_date: `${input.report_period}-01`,
          customer_id: (partnerRow.customer_id as string) || null,
          customer_name: partnerName,
          warehouse_name: `Əmanət / ${partnerName}`,
          subtotal: totalAmount,
          discount_total: 0,
          vat_total: 0,
          total_amount: totalAmount,
          paid_amount: 0,
          remaining_balance: totalAmount,
          note: `Əmanət satış hesabatı ${input.report_period}`,
          notes: `Consignment settlement ${input.report_period}`,
        },
      ])
      .select("id")
      .single();
    if (saleError || !sale) return { success: false, error: saleError?.message || "Faktura yaradılmadı" };

    const saleId = str((sale as Record<string, unknown>).id);
    const { error: itemsError } = await admin.from("sale_items").insert(
      soldItems.map((item) => ({
        sale_id: saleId,
        product_id: item.product_id,
        product_code: item.product_code,
        product_name: item.product_name,
        warehouse_id: null,
        warehouse_name: `Əmanət / ${partnerName}`,
        quantity: item.quantity_sold,
        unit: "Ədəd",
        unit_price: item.unit_price,
        discount_percent: 0,
        vat_rate: 0,
        line_total: item.total_price,
        extra_info: null,
      })) as never
    );
    if (itemsError) return { success: false, error: itemsError.message };

    if (partnerRow.customer_id) {
      const { error: arError } = await admin.rpc("refresh_customer_ar_balance", {
        p_customer_id: String(partnerRow.customer_id),
      });
      if (arError) {
        return { success: false, error: arError.message };
      }
    }

    const reportNo = createDocNo("CM");
    const { data: report, error } = await admin
      .from("consignment_monthly_reports")
      .insert([
        {
          report_no: reportNo,
          partner_id: input.partner_id,
          report_period: input.report_period,
          sold_items: soldItems,
          total_amount: totalAmount,
          invoice_id: saleId,
          notes: input.notes?.trim() || null,
          created_by: user.id,
        },
      ])
      .select("*")
      .single();
    if (error || !report) return { success: false, error: error?.message || "Hesabat yazılmadı" };

    return { success: true, data: mapReport(report as Record<string, unknown>, partnerName) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
