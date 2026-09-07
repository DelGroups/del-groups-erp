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

const SALES_LIST_SELECT =
  "id, doc_no, doc_date, customer_id, customer_name, seller_name, warehouse_name, subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance, delivery_address, delivery_type, delivery_fee, note, notes, created_at, warehouse_sent, warehouse_slip_status, payments, sale_items (warehouse_name)";

const SALES_LIST_SELECT_NO_ITEMS =
  "id, doc_no, doc_date, customer_id, customer_name, seller_name, warehouse_name, subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance, delivery_address, delivery_type, delivery_fee, note, notes, created_at, warehouse_sent, warehouse_slip_status, payments";

const SALES_LIST_SELECT_NO_ITEMS_LEGACY =
  "id, doc_no, doc_date, customer_id, customer_name, seller_name, warehouse_name, subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance, delivery_address, delivery_type, delivery_fee, note, notes, created_at, payments";

const SALES_LIST_SELECT_LEGACY =
  "id, doc_no, doc_date, customer_id, customer_name, seller_name, warehouse_name, subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance, delivery_address, delivery_type, delivery_fee, note, notes, created_at, payments, sale_items (warehouse_name)";

type SalesListRow = Record<string, unknown>;

function normalizeWarehouseSlipStatus(value: unknown): WarehouseSlipStatus | null {
  if (value === "pending" || value === "approved" || value === "rejected") {
    return value;
  }
  return null;
}

function toAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function getSaleRemaining(
  sale: Pick<SaleRecord, "total_amount" | "paid_amount" | "remaining_balance"> | null | undefined
): number {
  if (!sale) return 0;

  const total = toAmount(sale.total_amount);
  const paid = toAmount(sale.paid_amount);
  const computed = Math.max(0, total - paid);
  const stored = toAmount(sale.remaining_balance);

  if (stored > 0) return stored;
  return computed;
}

export function formatSaleAmount(amount: number, currencyLabel = "AZN"): string {
  return `${toAmount(amount).toFixed(2)} ${currencyLabel}`;
}

function resolveSaleWarehouseName(row: SalesListRow): string | null {
  const headerName =
    typeof row.warehouse_name === "string" ? row.warehouse_name.trim() : "";
  if (headerName) return headerName;

  const items = row.sale_items;
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const name =
      typeof (item as Record<string, unknown>).warehouse_name === "string"
        ? String((item as Record<string, unknown>).warehouse_name).trim()
        : "";
    if (name) return name;
  }

  return null;
}

function normalizePayments(value: unknown): SalePayment[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((row): row is SalePayment => row != null && typeof row === "object");
  }
  return [];
}

function mapSaleRow(row: SalesListRow): SaleRecord | null {
  const id = typeof row.id === "string" ? row.id : null;
  if (!id) return null;

  const totalAmount = toAmount(row.total_amount);
  const paidAmount = toAmount(row.paid_amount);

  return {
    id,
    doc_no: typeof row.doc_no === "string" ? row.doc_no : null,
    doc_date: typeof row.doc_date === "string" ? row.doc_date : null,
    customer_id: typeof row.customer_id === "string" ? row.customer_id : null,
    customer_name: typeof row.customer_name === "string" ? row.customer_name : null,
    seller_name: typeof row.seller_name === "string" ? row.seller_name : null,
    warehouse_name: resolveSaleWarehouseName(row),
    subtotal: toAmount(row.subtotal),
    discount_total: toAmount(row.discount_total),
    vat_total: toAmount(row.vat_total),
    total_amount: totalAmount,
    paid_amount: paidAmount,
    remaining_balance:
      row.remaining_balance != null
        ? toAmount(row.remaining_balance)
        : Math.max(0, totalAmount - paidAmount),
    delivery_address: typeof row.delivery_address === "string" ? row.delivery_address : null,
    delivery_type: typeof row.delivery_type === "string" ? row.delivery_type : null,
    delivery_fee: toAmount(row.delivery_fee),
    note:
      typeof row.note === "string"
        ? row.note
        : typeof row.notes === "string"
          ? row.notes
          : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    warehouse_sent: row.warehouse_sent === true,
    warehouse_slip_status: normalizeWarehouseSlipStatus(row.warehouse_slip_status),
    items: [],
    payments: normalizePayments(row.payments),
  };
}

function mapSaleItemRow(row: Record<string, unknown>): SaleItem {
  return {
    id: typeof row.id === "string" ? row.id : "",
    product_id: typeof row.product_id === "string" ? row.product_id : "",
    product_code: typeof row.product_code === "string" ? row.product_code : "",
    product_name: typeof row.product_name === "string" ? row.product_name : "",
    warehouse_id: typeof row.warehouse_id === "string" ? row.warehouse_id : "",
    warehouse_name: typeof row.warehouse_name === "string" ? row.warehouse_name : "",
    quantity: Number(row.quantity) || 0,
    unit: typeof row.unit === "string" ? row.unit : "Ədəd",
    unit_price: Number(row.unit_price) || 0,
    discount_percent: Number(row.discount_percent) || 0,
    vat_rate: Number(row.vat_rate) || 0,
    total: Number(row.line_total) || 0,
    extra_info: typeof row.extra_info === "string" ? row.extra_info : "",
  };
}

export type FetchSalesListResult = {
  sales: SaleRecord[];
  error?: string;
};

export async function fetchSalesList(): Promise<SaleRecord[]> {
  const result = await fetchSalesListWithMeta();
  return result.sales;
}

export async function fetchSalesListWithMeta(): Promise<FetchSalesListResult> {
  try {
    const selectAttempts = [
      SALES_LIST_SELECT,
      SALES_LIST_SELECT_LEGACY,
      SALES_LIST_SELECT_NO_ITEMS,
      SALES_LIST_SELECT_NO_ITEMS_LEGACY,
    ];

    let data: unknown[] | null = null;
    let error: { message: string } | null = null;

    for (const select of selectAttempts) {
      const result = await supabase
        .from("sales")
        .select(select)
        .order("created_at", { ascending: false });

      if (!result.error) {
        data = result.data;
        error = null;
        break;
      }

      error = result.error;
    }

    if (error) {
      console.error("Sales fetch error:", error.message);
      return { sales: [], error: error.message };
    }

    const sales = (data || [])
      .map((row) => mapSaleRow(row as SalesListRow))
      .filter((row): row is SaleRecord => row != null);

    return { sales };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sales fetch error";
    console.error("Sales fetch exception:", message);
    return { sales: [], error: message };
  }
}

export async function fetchSaleById(id: string): Promise<SaleRecord | null> {
  if (!id?.trim()) return null;

  try {
    const { data: sale, error } = await supabase.from("sales").select("*").eq("id", id).single();
    if (error || !sale) {
      if (error) console.error("Sale fetch error:", error.message);
      return null;
    }

    const { data: itemRows, error: itemsError } = await supabase
      .from("sale_items")
      .select("*")
      .eq("sale_id", id);

    if (itemsError) {
      console.error("Sale items fetch error:", itemsError.message);
    }

    const mapped = mapSaleRow(sale as SalesListRow);
    if (!mapped) return null;

    const items = (itemRows || []).map((row) => mapSaleItemRow(row as Record<string, unknown>));
    const warehouseFromItems = items.find((item) => item.warehouse_name?.trim())?.warehouse_name?.trim();

    return {
      ...mapped,
      warehouse_name: mapped.warehouse_name || warehouseFromItems || null,
      items,
      payments: normalizePayments(sale.payments),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sale fetch error";
    console.error("Sale fetch exception:", message);
    return null;
  }
}
