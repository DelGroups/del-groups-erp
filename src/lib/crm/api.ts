import { supabase } from "@/lib/supabase";
import type {
  CrmDeal,
  CrmQuotation,
  DealStage,
  QuotationItem,
  QuotationStatus,
} from "@/types/database.types";

function mapItems(value: unknown): QuotationItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = (raw || {}) as Record<string, unknown>;
    return {
      product_id: (row.product_id as string) || null,
      product_code: String(row.product_code || ""),
      product_name: String(row.product_name || ""),
      unit: String(row.unit || "Ədəd"),
      quantity: Number(row.quantity) || 0,
      cost_price: Number(row.cost_price) || 0,
      margin_percent: Number(row.margin_percent) || 0,
      unit_price: Number(row.unit_price) || 0,
      line_total: Number(row.line_total) || 0,
    };
  });
}

function mapQuotation(row: Record<string, unknown>): CrmQuotation {
  return {
    id: row.id as string,
    deal_id: row.deal_id as string,
    quote_number: (row.quote_number as string) || "",
    total_amount: Number(row.total_amount) || 0,
    discount: Number(row.discount) || 0,
    tax: Number(row.tax) || 0,
    valid_until: (row.valid_until as string) || null,
    status: ((row.status as QuotationStatus) || "DRAFT") as QuotationStatus,
    items_json: mapItems(row.items_json),
    notes: (row.notes as string) || null,
    production_order_id: (row.production_order_id as string) || null,
    created_at: (row.created_at as string) || null,
  };
}

function mapDeal(row: Record<string, unknown>): CrmDeal {
  const quotations = Array.isArray(row.quotations)
    ? (row.quotations as Record<string, unknown>[]).map(mapQuotation)
    : [];
  return {
    id: row.id as string,
    client_id: (row.client_id as string) || null,
    title: (row.title as string) || "",
    stage: ((row.stage as DealStage) || "LEAD") as DealStage,
    expected_value: Number(row.expected_value) || 0,
    assigned_to: (row.assigned_to as string) || null,
    notes: (row.notes as string) || null,
    production_order_id: (row.production_order_id as string) || null,
    created_at: (row.created_at as string) || null,
    updated_at: (row.updated_at as string) || null,
    customers: row.customers as CrmDeal["customers"],
    profiles: row.profiles as CrmDeal["profiles"],
    quotations,
  };
}

export async function fetchCrmDeals(): Promise<CrmDeal[]> {
  const { data, error } = await supabase
    .from("deals")
    .select("*, customers(full_name, company_name), quotations(*)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("CRM deals fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => mapDeal(row as Record<string, unknown>));
}

export async function fetchCrmCustomers(): Promise<
  { id: string; full_name: string; company_name: string | null }[]
> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, name, company_name")
    .order("full_name")
    .limit(400);

  if (error) return [];
  return (data || []).map((row) => ({
    id: row.id as string,
    full_name: (row.full_name as string) || (row.name as string) || "",
    company_name: (row.company_name as string) || null,
  }));
}

export async function fetchCrmProducts(): Promise<
  {
    id: string;
    code: string;
    name: string;
    unit: string;
    buy_price: number;
    sell_price: number;
  }[]
> {
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, unit, buy_price, sell_price")
    .order("name")
    .limit(500);

  if (error) return [];
  return (data || []).map((row) => ({
    id: row.id as string,
    code: (row.code as string) || "",
    name: (row.name as string) || "",
    unit: (row.unit as string) || "Ədəd",
    buy_price: Number(row.buy_price) || 0,
    sell_price: Number(row.sell_price) || 0,
  }));
}
