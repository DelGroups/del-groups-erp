import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, WarehouseSlip, WarehouseSlipItem } from "@/types/database.types";
import {
  generateWarehouseSlipNumber,
  mapWarehouseSlipFromRow,
} from "@/lib/warehouse/warehouseSlipMappers";
import { toWarehouseSlipItemsJson } from "@/types/database.types";

export type DocumentSourceType = "sale" | "purchase";

export interface SendDocumentToWarehouseParams {
  sourceType: DocumentSourceType;
  documentId: string;
  slipType: "inbound" | "outbound";
  documentNo: string;
  warehouseId?: string | null;
  warehouseName?: string | null;
  items: WarehouseSlipItem[];
  notes?: string | null;
  createdBy: string;
  autoApprove: boolean;
  approvedBy?: string;
  deliveryDueAt: string;
}

export interface SendDocumentToWarehouseResult {
  success: boolean;
  error?: string;
  slip?: WarehouseSlip;
}

export async function sendDocumentToWarehouse(
  admin: SupabaseClient<Database>,
  params: SendDocumentToWarehouseParams
): Promise<SendDocumentToWarehouseResult> {
  const validItems = params.items.filter((i) => i.product_id && i.quantity > 0);
  if (validItems.length === 0) {
    return { success: false, error: "Sənəddə anbara göndəriləcək məhsul yoxdur" };
  }

  const now = new Date().toISOString();
  const slipStatus: "pending" | "approved" = params.autoApprove ? "approved" : "pending";
  const sourceDocumentNo = params.documentNo.trim();

  const { data: slipRow, error: slipError } = await admin
    .from("warehouse_slips")
    .insert([
      {
        slip_number: generateWarehouseSlipNumber(params.slipType),
        type: params.slipType,
        status: slipStatus,
        source_document_id: params.documentId,
        source_document_no: sourceDocumentNo,
        source_type: params.sourceType,
        warehouse_id: params.warehouseId || null,
        warehouse_name: params.warehouseName || null,
        items: toWarehouseSlipItemsJson(validItems),
        notes: params.notes?.trim() || null,
        created_by: params.createdBy,
        approved_by: params.autoApprove ? params.approvedBy || params.createdBy : null,
        approved_at: params.autoApprove ? now : null,
        created_at: now,
        delivery_due_at: params.deliveryDueAt,
      },
    ])
    .select("*")
    .single();

  if (slipError || !slipRow) {
    return { success: false, error: slipError?.message || "Anbar qaiməsi yaradılmadı" };
  }

  const table = params.sourceType === "sale" ? "sales" : "purchases";
  const { error: docError } = await admin
    .from(table)
    .update({
      warehouse_sent: true,
      warehouse_slip_status: slipStatus,
    })
    .eq("id", params.documentId);

  if (docError) {
    await admin.from("warehouse_slips").delete().eq("id", slipRow.id);
    return { success: false, error: docError.message };
  }

  return {
    success: true,
    slip: mapWarehouseSlipFromRow(slipRow as Record<string, unknown>),
  };
}

export async function syncDocumentSlipStatus(
  admin: SupabaseClient<Database>,
  sourceType: "sale" | "purchase" | "writeoff",
  sourceDocumentId: string,
  slipStatus: "approved" | "rejected"
): Promise<void> {
  if (sourceType === "writeoff") return;

  const table = sourceType === "sale" ? "sales" : "purchases";
  await admin
    .from(table)
    .update({ warehouse_slip_status: slipStatus })
    .eq("id", sourceDocumentId);
}
