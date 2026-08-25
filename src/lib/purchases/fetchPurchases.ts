import { supabase } from "@/lib/supabase";
import type {
  PurchaseInsert,
  PurchaseLineItem,
  PurchaseRecord,
  Product,
  Supplier,
  Warehouse,
  WarehouseSlipStatus,
} from "@/types/database.types";

function mapItemRow(row: {
  product_id: string | null;
  product_code?: string | null;
  product_name?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  total_price: number;
  id?: string;
}): PurchaseLineItem {
  return {
    id: row.id || `${row.product_id}-${row.quantity}`,
    product_id: row.product_id || "",
    product_code: row.product_code || "",
    product_name: row.product_name || "",
    quantity: Number(row.quantity) || 0,
    unit: row.unit || "Ədəd",
    unit_price: Number(row.unit_price) || 0,
    total: Number(row.total_price) || 0,
  };
}

export async function fetchPurchaseList(): Promise<PurchaseRecord[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("*, suppliers(full_name, company_name)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Purchases fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    supplier_id: row.supplier_id,
    warehouse_id: row.warehouse_id,
    doc_date: row.doc_date,
    responsible_id: row.responsible_id ?? null,
    responsible_name: row.responsible_name ?? null,
    total_amount: Number(row.total_amount) || 0,
    paid_amount: Number(row.paid_amount) || 0,
    debt_amount: Number(row.debt_amount) || 0,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
    warehouse_sent: row.warehouse_sent === true,
    warehouse_slip_status: (row.warehouse_slip_status as WarehouseSlipStatus) || null,
    supplier_name: (row.suppliers as Supplier | null)?.full_name || undefined,
    supplier_company: (row.suppliers as Supplier | null)?.company_name || undefined,
    items: [],
  }));
}

export async function fetchPurchaseById(id: string): Promise<PurchaseRecord | null> {
  const { data: purchase, error } = await supabase
    .from("purchases")
    .select("*, suppliers(full_name, company_name)")
    .eq("id", id)
    .single();

  if (error || !purchase) return null;

  const { data: itemRows } = await supabase
    .from("purchase_items")
    .select("*")
    .eq("purchase_id", id);

  let warehouse_name: string | undefined;
  if (purchase.warehouse_id) {
    const { data: wh } = await supabase
      .from("warehouses")
      .select("name")
      .eq("id", purchase.warehouse_id)
      .single();
    warehouse_name = wh?.name;
  }

  return {
    id: purchase.id,
    invoice_number: purchase.invoice_number,
    supplier_id: purchase.supplier_id,
    warehouse_id: purchase.warehouse_id,
    doc_date: purchase.doc_date,
    responsible_id: purchase.responsible_id ?? null,
    responsible_name: purchase.responsible_name ?? null,
    total_amount: Number(purchase.total_amount) || 0,
    paid_amount: Number(purchase.paid_amount) || 0,
    debt_amount: Number(purchase.debt_amount) || 0,
    status: purchase.status,
    notes: purchase.notes,
    created_at: purchase.created_at,
    warehouse_sent: purchase.warehouse_sent === true,
    warehouse_slip_status: (purchase.warehouse_slip_status as WarehouseSlipStatus) || null,
    supplier_name: (purchase.suppliers as Supplier | null)?.full_name || undefined,
    supplier_company: (purchase.suppliers as Supplier | null)?.company_name || undefined,
    warehouse_name,
    items: (itemRows || []).map(mapItemRow),
  };
}

export async function fetchPurchaseFormData(): Promise<{
  suppliers: Supplier[];
  products: Product[];
  warehouses: Warehouse[];
}> {
  const [{ data: suppliers }, { data: products }, { data: warehouses }] = await Promise.all([
    supabase.from("suppliers").select("*").order("full_name", { ascending: true }),
    supabase.from("products").select("*").order("name", { ascending: true }),
    supabase.from("warehouses").select("*").order("created_at", { ascending: true }),
  ]);

  return {
    suppliers: (suppliers as Supplier[]) || [],
    products: (products as Product[]) || [],
    warehouses: (warehouses as Warehouse[]) || [],
  };
}

export type { PurchaseInsert };
