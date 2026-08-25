"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { sendDocumentToWarehouse } from "@/lib/warehouse/sendDocumentToWarehouse";
import type { WarehouseSlip, WarehouseSlipItem } from "@/types/database.types";
import { isAdminRole } from "@/types/database.types";

export type SendToWarehouseResult =
  | { success: true; slip: WarehouseSlip; autoApproved: boolean }
  | { success: false; error: string };

async function loadSaleForWarehouse(saleId: string) {
  const client = await createSupabaseServerClient();
  const { data: sale, error } = await client.from("sales").select("*").eq("id", saleId).single();
  if (error || !sale) return null;

  const { data: items } = await client.from("sale_items").select("*").eq("sale_id", saleId);
  return { sale, items: items || [] };
}

async function loadPurchaseForWarehouse(purchaseId: string) {
  const client = await createSupabaseServerClient();
  const { data: purchase, error } = await client
    .from("purchases")
    .select("*, warehouses(name)")
    .eq("id", purchaseId)
    .single();
  if (error || !purchase) return null;

  const { data: items } = await client
    .from("purchase_items")
    .select("*")
    .eq("purchase_id", purchaseId);

  return { purchase, items: items || [] };
}

export async function sendSaleToWarehouseAction(
  saleId: string,
  deliveryDueAt: string,
  forceResend = false
): Promise<SendToWarehouseResult> {
  try {
    const { user, profile } = await requirePermissionAction("can_send_to_warehouse");
    if (!isValidUuid(saleId)) {
      return { success: false, error: "Etibarsız sənəd identifikatoru" };
    }

    const parsedDue = new Date(deliveryDueAt);
    if (Number.isNaN(parsedDue.getTime())) {
      return { success: false, error: "Təhvil tarixi və saatı düzgün deyil" };
    }

    const loaded = await loadSaleForWarehouse(saleId);
    if (!loaded) {
      return { success: false, error: "Satış fakturası tapılmadı" };
    }

    const { sale, items } = loaded;
    const warehouseSent = sale.warehouse_sent === true;

    if (warehouseSent && !forceResend) {
      if (!isAdminRole(profile?.role)) {
        return { success: false, error: "Bu faktura artıq anbara göndərilib" };
      }
      return { success: false, error: "RESEND_CONFIRM_REQUIRED" };
    }

    const slipItems: WarehouseSlipItem[] = items
      .filter((row) => row.product_id && Number(row.quantity) > 0)
      .map((row) => ({
        product_id: row.product_id as string,
        product_code: (row.product_code as string) || "",
        product_name: (row.product_name as string) || "",
        quantity: Number(row.quantity) || 0,
        unit: (row.unit as string) || "Ədəd",
        unit_price: Number(row.unit_price) || 0,
      }));

    const primaryItem = items.find((i) => i.warehouse_id);
    const autoApprove = isAdminRole(profile?.role);
    const documentNo = String(sale.doc_no ?? "").trim() || String(saleId);

    const admin = createSupabaseAdminClient();
    const result = await sendDocumentToWarehouse(admin, {
      sourceType: "sale",
      documentId: saleId,
      slipType: "outbound",
      documentNo,
      warehouseId: (primaryItem?.warehouse_id as string) || null,
      warehouseName:
        (primaryItem?.warehouse_name as string) || (sale.warehouse_name as string) || null,
      items: slipItems,
      notes: (sale.note as string) || (sale.notes as string) || null,
      createdBy: user.id,
      autoApprove,
      approvedBy: user.id,
      deliveryDueAt: parsedDue.toISOString(),
    });

    if (!result.success || !result.slip) {
      return { success: false, error: result.error || "Göndərmə uğursuz oldu" };
    }

    return { success: true, slip: result.slip, autoApproved: autoApprove };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Göndərmə uğursuz oldu",
    };
  }
}

export async function sendPurchaseToWarehouseAction(
  purchaseId: string,
  deliveryDueAt: string,
  forceResend = false
): Promise<SendToWarehouseResult> {
  try {
    const { user, profile } = await requirePermissionAction("can_send_to_warehouse");
    if (!isValidUuid(purchaseId)) {
      return { success: false, error: "Etibarsız sənəd identifikatoru" };
    }

    const parsedDue = new Date(deliveryDueAt);
    if (Number.isNaN(parsedDue.getTime())) {
      return { success: false, error: "Təhvil tarixi və saatı düzgün deyil" };
    }

    const loaded = await loadPurchaseForWarehouse(purchaseId);
    if (!loaded) {
      return { success: false, error: "Alış fakturası tapılmadı" };
    }

    const { purchase, items } = loaded;
    const warehouseSent = purchase.warehouse_sent === true;

    if (warehouseSent && !forceResend) {
      if (!isAdminRole(profile?.role)) {
        return { success: false, error: "Bu faktura artıq anbara göndərilib" };
      }
      return { success: false, error: "RESEND_CONFIRM_REQUIRED" };
    }

    const slipItems: WarehouseSlipItem[] = items
      .filter((row) => row.product_id && Number(row.quantity) > 0)
      .map((row) => ({
        product_id: row.product_id as string,
        product_code: (row.product_code as string) || "",
        product_name: (row.product_name as string) || "",
        quantity: Number(row.quantity) || 0,
        unit: (row.unit as string) || "Ədəd",
        unit_price: Number(row.unit_price) || 0,
      }));

    const warehouseJoin = purchase.warehouses as { name?: string } | null;
    const autoApprove = isAdminRole(profile?.role);
    const documentNo =
      String(purchase.invoice_number ?? "").trim() || String(purchaseId);

    const admin = createSupabaseAdminClient();
    const result = await sendDocumentToWarehouse(admin, {
      sourceType: "purchase",
      documentId: purchaseId,
      slipType: "inbound",
      documentNo,
      warehouseId: (purchase.warehouse_id as string) || null,
      warehouseName: warehouseJoin?.name || null,
      items: slipItems,
      notes: (purchase.notes as string) || null,
      createdBy: user.id,
      autoApprove,
      approvedBy: user.id,
      deliveryDueAt: parsedDue.toISOString(),
    });

    if (!result.success || !result.slip) {
      return { success: false, error: result.error || "Göndərmə uğursuz oldu" };
    }

    return { success: true, slip: result.slip, autoApproved: autoApprove };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Göndərmə uğursuz oldu",
    };
  }
}
