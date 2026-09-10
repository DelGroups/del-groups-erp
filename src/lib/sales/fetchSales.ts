import { supabase } from "@/lib/supabase";
import { isInvoiceCancelled } from "@/lib/invoices/invoiceStatus";
import type { SaleItem, SalePayment, WarehouseSlipStatus } from "@/types/database.types";

export interface SaleRecord {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  seller_name: string | null;
  seller_id?: string | null;
  created_by?: string | null;
  issued_by?: string | null;
  created_by_name?: string | null;
  issued_by_name?: string | null;
  warehouse_name: string | null;
  warehouses?: { name?: string | null } | null;
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
  status?: string | null;
  is_official?: boolean;
  contract_id?: string | null;
  vat_mode?: "exclusive" | "inclusive" | "none" | null;
  subtotal_amount?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  grand_total?: number | null;
  items: SaleItem[];
  payments: SalePayment[];
}

const SALES_LIST_SELECT =
  "id, doc_no, doc_date, customer_id, customer_name, seller_id, seller_name, created_by, issued_by, warehouse_name, subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance, delivery_address, delivery_type, delivery_fee, note, notes, created_at, warehouse_sent, warehouse_slip_status, status, payments, is_official, contract_id, vat_mode, subtotal_amount, vat_rate, vat_amount, grand_total, sale_items (warehouse_name)";

const SALES_LIST_SELECT_NO_ITEMS =
  "id, doc_no, doc_date, customer_id, customer_name, seller_name, warehouse_name, subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance, delivery_address, delivery_type, delivery_fee, note, notes, created_at, warehouse_sent, warehouse_slip_status, status, payments, is_official, contract_id, vat_mode, subtotal_amount, vat_rate, vat_amount, grand_total";

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

export const DEFAULT_SALE_WAREHOUSE_LABEL = "Əsas Anbar";

export function formatSaleAmount(amount: unknown, currencyLabel = "AZN"): string {
  return `${Number(amount || 0).toFixed(2)} ${currencyLabel}`;
}

export function getSaleWarehouseLabel(
  sale: Pick<SaleRecord, "warehouse_name" | "items" | "warehouses"> | null | undefined
): string {
  if (!sale) return DEFAULT_SALE_WAREHOUSE_LABEL;

  const headerName = sale.warehouse_name?.trim();
  if (headerName) return headerName;

  const joinedName = sale.warehouses?.name?.trim();
  if (joinedName) return joinedName;

  const itemName = (sale.items ?? []).find((item) => item.warehouse_name?.trim())?.warehouse_name?.trim();
  if (itemName) return itemName;

  return DEFAULT_SALE_WAREHOUSE_LABEL;
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
    seller_id: typeof row.seller_id === "string" ? row.seller_id : null,
    seller_name: typeof row.seller_name === "string" ? row.seller_name : null,
    created_by: typeof row.created_by === "string" ? row.created_by : null,
    issued_by: typeof row.issued_by === "string" ? row.issued_by : null,
    created_by_name:
      typeof row.created_by_name === "string" ? row.created_by_name : null,
    issued_by_name:
      typeof row.issued_by_name === "string" ? row.issued_by_name : null,
    warehouse_name: resolveSaleWarehouseName(row) ?? DEFAULT_SALE_WAREHOUSE_LABEL,
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
    status: typeof row.status === "string" ? row.status : null,
    is_official: row.is_official === true,
    contract_id: typeof row.contract_id === "string" ? row.contract_id : null,
    vat_mode:
      row.vat_mode === "exclusive" || row.vat_mode === "inclusive" || row.vat_mode === "none"
        ? row.vat_mode
        : null,
    subtotal_amount: row.subtotal_amount != null ? toAmount(row.subtotal_amount) : null,
    vat_rate: row.vat_rate != null ? toAmount(row.vat_rate) : null,
    vat_amount: row.vat_amount != null ? toAmount(row.vat_amount) : null,
    grand_total: row.grand_total != null ? toAmount(row.grand_total) : null,
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
    sale_item_type:
      row.sale_item_type === "dimensional" ||
      row.sale_item_type === "accessory" ||
      row.sale_item_type === "service" ||
      row.sale_item_type === "standard"
        ? row.sale_item_type
        : undefined,
    piece_count: row.piece_count != null ? Number(row.piece_count) || 1 : undefined,
    polywood_sale_mode:
      typeof row.polywood_sale_mode === "string" ? row.polywood_sale_mode : null,
    polywood_length_m:
      row.polywood_length_m != null ? Number(row.polywood_length_m) || null : null,
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
      .filter((row): row is SaleRecord => row != null)
      .filter((row) => !isInvoiceCancelled(row.status));

    return { sales };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sales fetch error";
    console.error("Sales fetch exception:", message);
    return { sales: [], error: message };
  }
}

async function enrichSaleAuditTrail(sale: SaleRecord): Promise<SaleRecord> {
  const profileIds = [sale.created_by, sale.issued_by].filter(
    (value, index, array): value is string =>
      typeof value === "string" && value.length > 0 && array.indexOf(value) === index
  );
  if (profileIds.length === 0) {
    return {
      ...sale,
      issued_by_name: sale.seller_name,
    };
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", profileIds);

  const nameById = new Map<string, string>();
  for (const row of data || []) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    const label =
      (typeof row.full_name === "string" && row.full_name.trim()) ||
      (typeof row.email === "string" && row.email.trim()) ||
      "";
    if (label) nameById.set(id, label);
  }

  return {
    ...sale,
    issued_by_name:
      (sale.issued_by ? nameById.get(sale.issued_by) : null) || sale.seller_name || null,
    created_by_name: sale.created_by ? nameById.get(sale.created_by) || null : null,
  };
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

    return enrichSaleAuditTrail({
      ...mapped,
      warehouse_name:
        mapped.warehouse_name || warehouseFromItems || DEFAULT_SALE_WAREHOUSE_LABEL,
      items,
      payments: normalizePayments(sale.payments),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sale fetch error";
    console.error("Sale fetch exception:", message);
    return null;
  }
}
