"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { POLYWOOD_WAREHOUSE_TYPE } from "@/lib/polywood/constants";

type AuditType = "standard" | "polywood";

export interface InventoryAuditDraftItemInput {
  product_id: string;
  product_code: string;
  product_name: string;
  unit: string;
  system_qty: number;
  actual_qty: number;
  variance_qty: number;
  full_sheet_length_m?: number | null;
  system_full_sheet_count?: number | null;
  system_cut_pieces?: number[] | null;
  actual_full_sheet_count?: number | null;
  actual_cut_pieces?: number[] | null;
}

export interface SaveInventoryAuditDraftInput {
  audit_type: AuditType;
  warehouse_id: string;
  warehouse_name: string;
  audit_date: string;
  auditor_name: string;
  notes?: string;
  items: InventoryAuditDraftItemInput[];
}

export type InventoryAuditActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

function createDocNo(prefix: string): string {
  return `${prefix}-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
}

export async function saveInventoryAuditDraftAction(
  input: SaveInventoryAuditDraftInput
): Promise<InventoryAuditActionResult<{ auditId: string; documentNo: string }>> {
  try {
    const { user } = await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();

    if (!input.items.length) {
      return { success: false, error: "Audit items are empty" };
    }

    const documentNo = createDocNo("IA");
    const { data: auditRow, error: auditError } = await admin
      .from("inventory_audits")
      .insert([
        {
          document_number: documentNo,
          audit_type: input.audit_type,
          warehouse_id: input.warehouse_id,
          warehouse_name: input.warehouse_name,
          audit_date: input.audit_date,
          auditor_name: input.auditor_name.trim(),
          notes: input.notes?.trim() || null,
          status: "draft",
          created_by: user.id,
        },
      ])
      .select("id")
      .single();

    if (auditError || !auditRow) {
      return { success: false, error: auditError?.message || "Failed to create inventory audit" };
    }

    const rows = input.items.map((item) => ({
      audit_id: auditRow.id,
      product_id: item.product_id,
      product_code: item.product_code || null,
      product_name: item.product_name,
      unit: item.unit || "Ədəd",
      system_qty: Number(item.system_qty) || 0,
      actual_qty: Number(item.actual_qty) || 0,
      variance_qty: Number(item.variance_qty) || 0,
      full_sheet_length_m: item.full_sheet_length_m ?? null,
      system_full_sheet_count: item.system_full_sheet_count ?? null,
      system_cut_pieces: item.system_cut_pieces ?? null,
      actual_full_sheet_count: item.actual_full_sheet_count ?? null,
      actual_cut_pieces: item.actual_cut_pieces ?? null,
    }));

    const { error: itemsError } = await admin.from("inventory_audit_items").insert(rows);
    if (itemsError) {
      return { success: false, error: itemsError.message };
    }

    return { success: true, data: { auditId: auditRow.id as string, documentNo } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

function toNumberArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v * 1000) / 1000);
}

export async function applyInventoryAuditAdjustmentsAction(
  auditId: string
): Promise<InventoryAuditActionResult<{ voucherId: string; voucherNo: string }>> {
  try {
    const { user } = await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();

    const { data: audit, error: auditError } = await admin
      .from("inventory_audits")
      .select("*")
      .eq("id", auditId)
      .single();

    if (auditError || !audit) {
      return { success: false, error: auditError?.message || "Audit not found" };
    }
    if ((audit.status as string) === "applied") {
      return { success: false, error: "Audit has already been applied" };
    }

    const { data: items, error: itemsError } = await admin
      .from("inventory_audit_items")
      .select("*")
      .eq("audit_id", auditId)
      .order("created_at", { ascending: true });

    if (itemsError) return { success: false, error: itemsError.message };
    const rows = items || [];
    const nowIso = new Date().toISOString();

    for (const row of rows) {
      const productId = row.product_id as string;
      const actualQty = Number(row.actual_qty) || 0;

      if ((audit.audit_type as AuditType) === "polywood") {
        const fullSheetLength = Number(row.full_sheet_length_m) || 4;
        const fullCount = Number(row.actual_full_sheet_count) || 0;
        const cutPieces = toNumberArray(row.actual_cut_pieces);

        await admin
          .from("polywood_pieces")
          .delete()
          .eq("product_id", productId)
          .eq("warehouse_id", audit.warehouse_id as string)
          .eq("status", "available");

        const newPieces = [
          ...Array.from({ length: fullCount }).map(() => ({
            product_id: productId,
            warehouse_id: audit.warehouse_id as string,
            length_m: fullSheetLength,
            piece_type: "full",
            status: "available",
            notes: `Audit ${audit.document_number} applied`,
            updated_at: nowIso,
          })),
          ...cutPieces.map((lengthM) => ({
            product_id: productId,
            warehouse_id: audit.warehouse_id as string,
            length_m: lengthM,
            piece_type: "cut",
            status: "available",
            notes: `Audit ${audit.document_number} applied`,
            updated_at: nowIso,
          })),
        ];

        if (newPieces.length > 0) {
          const { error: pieceInsertError } = await admin.from("polywood_pieces").insert(newPieces);
          if (pieceInsertError) return { success: false, error: pieceInsertError.message };
        }
      }

      const { error: updateStockError } = await admin
        .from("products")
        .update({ stock: actualQty })
        .eq("id", productId);

      if (updateStockError) return { success: false, error: updateStockError.message };
    }

    const voucherNo = createDocNo("IAV");
    const voucherItems = rows.map((row) => ({
      product_id: row.product_id,
      product_code: row.product_code,
      product_name: row.product_name,
      unit: row.unit,
      system_qty: Number(row.system_qty) || 0,
      actual_qty: Number(row.actual_qty) || 0,
      variance_qty: Number(row.variance_qty) || 0,
      full_sheet_length_m: row.full_sheet_length_m,
      system_full_sheet_count: row.system_full_sheet_count,
      actual_full_sheet_count: row.actual_full_sheet_count,
      system_cut_pieces: row.system_cut_pieces,
      actual_cut_pieces: row.actual_cut_pieces,
    }));

    const { data: voucher, error: voucherError } = await admin
      .from("inventory_adjustment_vouchers")
      .insert([
        {
          voucher_number: voucherNo,
          audit_id: auditId,
          audit_type: audit.audit_type,
          warehouse_id: audit.warehouse_id,
          warehouse_name: audit.warehouse_name,
          audit_date: audit.audit_date,
          auditor_name: audit.auditor_name,
          notes: audit.notes,
          items: voucherItems,
          applied_by: user.id,
          applied_at: nowIso,
        },
      ])
      .select("id")
      .single();

    if (voucherError || !voucher) {
      return { success: false, error: voucherError?.message || "Failed to create voucher" };
    }

    const { error: statusError } = await admin
      .from("inventory_audits")
      .update({
        status: "applied",
        applied_at: nowIso,
        applied_by: user.id,
        voucher_id: voucher.id,
      })
      .eq("id", auditId);
    if (statusError) return { success: false, error: statusError.message };

    return { success: true, data: { voucherId: voucher.id as string, voucherNo } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function fetchInventoryAuditVouchersAction(): Promise<
  InventoryAuditActionResult<
    Array<{
      id: string;
      voucher_number: string;
      audit_type: AuditType;
      warehouse_name: string;
      audit_date: string;
      auditor_name: string;
      applied_at: string;
      items: unknown[];
    }>
  >
> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from("inventory_adjustment_vouchers")
      .select("*")
      .order("applied_at", { ascending: false })
      .limit(40);

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: (data || []).map((row) => ({
        id: row.id as string,
        voucher_number: (row.voucher_number as string) || "",
        audit_type: (row.audit_type as AuditType) || "standard",
        warehouse_name: (row.warehouse_name as string) || "",
        audit_date: (row.audit_date as string) || "",
        auditor_name: (row.auditor_name as string) || "",
        applied_at: (row.applied_at as string) || "",
        items: Array.isArray(row.items) ? (row.items as unknown[]) : [],
      })),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function fetchWarehousesForAuditAction(): Promise<
  InventoryAuditActionResult<Array<{ id: string; name: string; warehouse_type: string | null }>>
> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("warehouses").select("id,name,warehouse_type");
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: (data || []).map((row) => ({
        id: row.id as string,
        name: (row.name as string) || "",
        warehouse_type:
          row.warehouse_type === POLYWOOD_WAREHOUSE_TYPE
            ? POLYWOOD_WAREHOUSE_TYPE
            : ((row.warehouse_type as string | null) || null),
      })),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
