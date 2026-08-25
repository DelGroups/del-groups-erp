import { supabase } from "@/lib/supabase";
import type { SaleItem, SalePayment, WarehouseSlipStatus } from "@/types/database.types";

export interface SaleRecord {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  seller_name: string | null;
  warehouse_name: string | null;
  subtotal: number;
  discount_total: number;
  vat_total: number;
  total_amount: number;
  paid_amount: number;
  remaining_balance: number;
  delivery_address: string | null;
  delivery_type: string | null;
  delivery_fee: number;
  note: string | null;
  created_at: string | null;
  warehouse_sent: boolean;
  warehouse_slip_status: WarehouseSlipStatus | null;
  items: SaleItem[];
  payments: SalePayment[];
}

export async function fetchSalesList(): Promise<SaleRecord[]> {
  const { data, error } = await supabase
    .from("sales")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Sales fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    doc_no: row.doc_no,
    doc_date: row.doc_date,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    seller_name: row.seller_name,
    warehouse_name: row.warehouse_name,
    subtotal: Number(row.subtotal) || 0,
    discount_total: Number(row.discount_total) || 0,
    vat_total: Number(row.vat_total) || 0,
    total_amount: Number(row.total_amount) || 0,
    paid_amount: Number(row.paid_amount) || 0,
    remaining_balance:
      row.remaining_balance != null
        ? Number(row.remaining_balance)
        : Math.max(0, (Number(row.total_amount) || 0) - (Number(row.paid_amount) || 0)),
    delivery_address: row.delivery_address,
    delivery_type: row.delivery_type,
    delivery_fee: Number(row.delivery_fee) || 0,
    note: row.note,
    created_at: row.created_at,
    warehouse_sent: row.warehouse_sent === true,
    warehouse_slip_status: (row.warehouse_slip_status as WarehouseSlipStatus) || null,
    items: [],
    payments: [],
  }));
}

export async function fetchSaleById(id: string): Promise<SaleRecord | null> {
  const { data: sale, error } = await supabase.from("sales").select("*").eq("id", id).single();
  if (error || !sale) return null;

  const { data: itemRows } = await supabase.from("sale_items").select("*").eq("sale_id", id);

  const items: SaleItem[] = (itemRows || []).map((row) => ({
    id: row.id,
    product_id: row.product_id || "",
    product_code: row.product_code || "",
    product_name: row.product_name || "",
    warehouse_id: row.warehouse_id || "",
    warehouse_name: row.warehouse_name || "",
    quantity: Number(row.quantity) || 0,
    unit: row.unit || "Ədəd",
    unit_price: Number(row.unit_price) || 0,
    discount_percent: Number(row.discount_percent) || 0,
    vat_rate: Number(row.vat_rate) || 0,
    total: Number(row.line_total) || 0,
    extra_info: row.extra_info || "",
  }));

  let payments: SalePayment[] = [];
  if (sale.payments && Array.isArray(sale.payments)) {
    payments = sale.payments as unknown as SalePayment[];
  }

  return {
    id: sale.id,
    doc_no: sale.doc_no,
    doc_date: sale.doc_date,
    customer_id: sale.customer_id,
    customer_name: sale.customer_name,
    seller_name: sale.seller_name,
    warehouse_name: sale.warehouse_name,
    subtotal: Number(sale.subtotal) || 0,
    discount_total: Number(sale.discount_total) || 0,
    vat_total: Number(sale.vat_total) || 0,
    total_amount: Number(sale.total_amount) || 0,
    paid_amount: Number(sale.paid_amount) || 0,
    remaining_balance:
      sale.remaining_balance != null
        ? Number(sale.remaining_balance)
        : Math.max(0, (Number(sale.total_amount) || 0) - (Number(sale.paid_amount) || 0)),
    delivery_address: sale.delivery_address,
    delivery_type: sale.delivery_type,
    delivery_fee: Number(sale.delivery_fee) || 0,
    note: sale.note,
    created_at: sale.created_at,
    warehouse_sent: sale.warehouse_sent === true,
    warehouse_slip_status: (sale.warehouse_slip_status as WarehouseSlipStatus) || null,
    items,
    payments,
  };
}
