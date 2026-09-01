import { supabase } from "@/lib/supabase";
import type {
  Json,
  WarehouseSlip,
  WarehouseSlipInsert,
  WarehouseSlipItem,
  WarehouseSlipStatus,
  WarehouseSlipType,
} from "@/types/database.types";
import { toWarehouseSlipItemsJson } from "@/types/database.types";
import {
  generateWarehouseSlipNumber,
  mapWarehouseSlipFromRow,
  parseWarehouseSlipItems,
} from "@/lib/warehouse/warehouseSlipMappers";

export { generateWarehouseSlipNumber, parseWarehouseSlipItems } from "@/lib/warehouse/warehouseSlipMappers";

export interface CreateWarehouseSlipPayload {
  type: WarehouseSlipType;
  sourceDocumentId: string;
  sourceDocumentNo: string;
  sourceType: "purchase" | "sale" | "writeoff" | "production";
  warehouseId?: string | null;
  warehouseName?: string | null;
  items: WarehouseSlipItem[];
  notes?: string | null;
  createdBy?: string | null;
}

export interface CreateWarehouseSlipResult {
  success: boolean;
  error?: string;
  slipId?: string;
}

async function resolveWarehouseName(warehouseId: string | null | undefined): Promise<string | null> {
  if (!warehouseId) return null;
  const { data } = await supabase
    .from("warehouses")
    .select("name")
    .eq("id", warehouseId)
    .maybeSingle();
  return (data?.name as string) || null;
}

async function resolveCreatedBy(explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function createWarehouseSlip(
  payload: CreateWarehouseSlipPayload
): Promise<CreateWarehouseSlipResult> {
  const validItems = payload.items.filter((i) => i.product_id && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, error: "Anbar qaiməsi üçün məhsul siyahısı boşdur" };
  }

  const warehouseName =
    payload.warehouseName?.trim() ||
    (await resolveWarehouseName(payload.warehouseId)) ||
    null;

  const insertPayload: WarehouseSlipInsert = {
    slip_number: generateWarehouseSlipNumber(payload.type),
    type: payload.type,
    status: "pending",
    source_document_id: payload.sourceDocumentId,
    source_document_no: payload.sourceDocumentNo,
    source_type: payload.sourceType,
    warehouse_id: payload.warehouseId || null,
    warehouse_name: warehouseName,
    items: toWarehouseSlipItemsJson(validItems) as Json,
    notes: payload.notes?.trim() || null,
    created_by: await resolveCreatedBy(payload.createdBy),
  };

  const { data, error } = await supabase
    .from("warehouse_slips")
    .insert([insertPayload])
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, slipId: data?.id as string };
}

export async function fetchWarehouseSlips(
  status?: WarehouseSlipStatus
): Promise<WarehouseSlip[]> {
  let query = supabase
    .from("warehouse_slips")
    .select("*")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Warehouse slips fetch error:", error.message);
    return [];
  }

  return (data || []).map((row) => mapWarehouseSlipFromRow(row as Record<string, unknown>));
}

export async function fetchWarehouseSlipById(id: string): Promise<WarehouseSlip | null> {
  const { data, error } = await supabase
    .from("warehouse_slips")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return mapWarehouseSlipFromRow(data as Record<string, unknown>);
}

export function getWarehouseSlipTypeLabel(type: WarehouseSlipType): string {
  switch (type) {
    case "inbound":
      return "Giriş (Alış)";
    case "outbound":
      return "Çıxış (Satış)";
    case "waste":
      return "Zədələnmə / Tullantı";
  }
}

export function getWarehouseSlipStatusLabel(status: WarehouseSlipStatus): string {
  switch (status) {
    case "pending":
      return "Gözləyir";
    case "approved":
      return "Təsdiqlənib";
    case "rejected":
      return "Rədd edilib";
  }
}
