"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { mapWarehouseSlipFromRow } from "@/lib/warehouse/warehouseSlipMappers";
import { syncDocumentSlipStatus } from "@/lib/warehouse/sendDocumentToWarehouse";
import type { WarehouseSlip, WarehouseSlipStatus } from "@/types/database.types";

export type WarehouseSlipActionResult =
  | { success: true; slip: WarehouseSlip }
  | { success: false; error: string };

export type FetchWarehouseSlipsResult =
  | { success: true; slips: WarehouseSlip[] }
  | { success: false; error: string };

function mapRow(row: Record<string, unknown>): WarehouseSlip {
  return mapWarehouseSlipFromRow(row);
}

export async function fetchWarehouseSlipsAction(
  status?: WarehouseSlipStatus
): Promise<FetchWarehouseSlipsResult> {
  try {
    await requirePermissionAction("can_view_warehouse_slips");

    const admin = createSupabaseAdminClient();
    let query = admin
      .from("warehouse_slips")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      slips: (data || []).map((row) => mapRow(row as Record<string, unknown>)),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Qaimələr yüklənmədi",
    };
  }
}

async function updateSlipStatus(
  slipId: string,
  status: "approved" | "rejected"
): Promise<WarehouseSlipActionResult> {
  try {
    const { user } = await requirePermissionAction("can_approve_warehouse_slips");

    if (!isValidUuid(slipId)) {
      return { success: false, error: "Etibarsız qaimə identifikatoru" };
    }

    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();

    const { data, error } = await admin
      .from("warehouse_slips")
      .update({
        status,
        approved_at: now,
        approved_by: user.id,
      })
      .eq("id", slipId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }
    if (!data) {
      return { success: false, error: "Qaimə tapılmadı və ya artıq işlənib" };
    }

    const slip = mapRow(data as Record<string, unknown>);
    if (slip.source_document_id && slip.source_type && slip.source_type !== "writeoff") {
      try {
        const admin = createSupabaseAdminClient();
        await syncDocumentSlipStatus(
          admin,
          slip.source_type,
          slip.source_document_id,
          status
        );
      } catch {
        // Non-fatal: slip approved even if document sync fails
      }
    }

    return { success: true, slip };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Əməliyyat uğursuz oldu",
    };
  }
}

export async function approveWarehouseSlipAction(
  slipId: string
): Promise<WarehouseSlipActionResult> {
  return updateSlipStatus(slipId, "approved");
}

export async function rejectWarehouseSlipAction(
  slipId: string
): Promise<WarehouseSlipActionResult> {
  return updateSlipStatus(slipId, "rejected");
}
