"use server";

import { syncPolywoodProductStockFromPieces } from "@/lib/inventory/polywoodStock";
import { isFullSheetLength } from "@/lib/polywood/constants";
import { isMetricProduct, resolveStandardBarLengthM } from "@/lib/polywood/metricReceive";
import { recordStockMovement } from "@/lib/inventory/stockMovements";
import { generatePieceBarcode } from "@/lib/products/generateBarcode";
import type { SaveInitialBalanceInput, InitialBalanceDocument } from "@/lib/initialBalance/types";
import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { Product } from "@/types/database.types";

export type InitialBalanceActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumberArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value * 1000) / 1000);
}

async function nextDocNo(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<string> {
  const { data, error } = await admin.rpc("next_initial_balance_doc_no");
  if (!error && typeof data === "string" && data.trim()) return data;
  const year = new Date().getFullYear();
  return `IQ-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function peekInitialBalanceDocNoAction(): Promise<InitialBalanceActionResult<string>> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("peek_next_initial_balance_doc_no");
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data as string) || "" };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function fetchInitialBalanceListAction(): Promise<
  InitialBalanceActionResult<InitialBalanceDocument[]>
> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("inventory_initial_balances")
      .select("*")
      .order("doc_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, data: (data as InitialBalanceDocument[]) || [] };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function fetchInitialBalanceByIdAction(
  id: string
): Promise<InitialBalanceActionResult<InitialBalanceDocument>> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();
    const { data: header, error: headerError } = await admin
      .from("inventory_initial_balances")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (headerError) return { success: false, error: headerError.message };
    if (!header) return { success: false, error: "Document not found" };

    const { data: items, error: itemsError } = await admin
      .from("inventory_initial_balance_items")
      .select("*")
      .eq("document_id", id)
      .order("line_no", { ascending: true });

    if (itemsError) return { success: false, error: itemsError.message };

    const mappedItems =
      (items || []).map((row) => ({
        id: row.id as string,
        product_id: row.product_id as string,
        product_code: (row.product_code as string) || "",
        product_name: row.product_name as string,
        unit: (row.unit as string) || "Ədəd",
        quantity: Number(row.quantity) || 0,
        unit_cost: Number(row.unit_cost) || 0,
        line_total: Number(row.line_total) || 0,
        is_metric: Boolean(row.is_metric),
        metric_total_meters: Number(row.metric_total_meters) || 0,
        piece_lengths_input: toNumberArray(row.piece_lengths).join(", "),
      })) || [];

    return {
      success: true,
      data: { ...(header as InitialBalanceDocument), items: mappedItems },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function saveInitialBalanceDraftAction(
  input: SaveInitialBalanceInput
): Promise<InitialBalanceActionResult<{ id: string; document_number: string }>> {
  try {
    const { user, profile } = await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();

    if (!input.items.length) {
      return { success: false, error: "At least one line item is required" };
    }
    if (!input.warehouse_id) {
      return { success: false, error: "Warehouse is required" };
    }

    const totalAmount = roundMoney(
      input.items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0)
    );

    let documentId = input.id || null;
    let documentNumber = "";

    if (documentId) {
      const { data: existing, error: existingError } = await admin
        .from("inventory_initial_balances")
        .select("id, document_number, status")
        .eq("id", documentId)
        .maybeSingle();

      if (existingError) return { success: false, error: existingError.message };
      if (!existing) return { success: false, error: "Document not found" };
      if (existing.status !== "draft") {
        return { success: false, error: "Only draft documents can be edited" };
      }

      documentNumber = existing.document_number as string;
      const { error: updateError } = await admin
        .from("inventory_initial_balances")
        .update({
          doc_date: input.doc_date,
          warehouse_id: input.warehouse_id,
          warehouse_name: input.warehouse_name,
          notes: input.notes?.trim() || null,
          total_amount: totalAmount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      if (updateError) return { success: false, error: updateError.message };
      await admin.from("inventory_initial_balance_items").delete().eq("document_id", documentId);
    } else {
      documentNumber = await nextDocNo(admin);
      const { data: created, error: createError } = await admin
        .from("inventory_initial_balances")
        .insert([
          {
            document_number: documentNumber,
            doc_date: input.doc_date,
            warehouse_id: input.warehouse_id,
            warehouse_name: input.warehouse_name,
            notes: input.notes?.trim() || null,
            status: "draft",
            total_amount: totalAmount,
            created_by: user.id,
            created_by_name: profile?.full_name || user.email || null,
          },
        ])
        .select("id")
        .single();

      if (createError || !created) {
        return { success: false, error: createError?.message || "Failed to create document" };
      }
      documentId = created.id as string;
    }

    const rows = input.items.map((item, index) => ({
      document_id: documentId,
      line_no: index + 1,
      product_id: item.product_id,
      product_code: item.product_code || null,
      product_name: item.product_name,
      unit: item.unit || "Ədəd",
      quantity: item.is_metric ? item.metric_total_meters || 0 : item.quantity,
      unit_cost: item.unit_cost,
      line_total: item.line_total,
      is_metric: item.is_metric,
      metric_total_meters: item.is_metric ? item.metric_total_meters : null,
      piece_lengths: item.is_metric ? item.piece_lengths : null,
    }));

    const { error: itemsError } = await admin.from("inventory_initial_balance_items").insert(rows);
    if (itemsError) return { success: false, error: itemsError.message };

    return { success: true, data: { id: documentId!, document_number: documentNumber } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

function calcWeightedBuyPrice(
  oldStock: number,
  oldBuy: number,
  addedQty: number,
  unitCost: number,
  newStock: number
): number {
  if (newStock <= 0) return unitCost;
  return roundMoney((oldStock * oldBuy + addedQty * unitCost) / newStock);
}

async function insertMetricPieces(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  productId: string,
  warehouseId: string,
  pieceLengths: number[],
  fullSheetLengthM: number
): Promise<number> {
  const now = new Date().toISOString();
  const rows = pieceLengths.map((length) => {
    const barcode = generatePieceBarcode();
    return {
      product_id: productId,
      warehouse_id: warehouseId,
      length_m: Math.round(length * 1000) / 1000,
      piece_type: isFullSheetLength(length, fullSheetLengthM) ? "full" : "cut",
      status: "available",
      notes: null,
      sale_item_id: null,
      barcode,
      qr_code: barcode,
      updated_at: now,
    };
  });

  if (rows.length === 0) return 0;
  const { error } = await admin.from("polywood_pieces").insert(rows);
  if (error) throw new Error(error.message);
  return pieceLengths.reduce((sum, length) => sum + length, 0);
}

export async function postInitialBalanceDocumentAction(
  documentId: string
): Promise<InitialBalanceActionResult<{ document_number: string }>> {
  try {
    const { user } = await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();

    const { data: header, error: headerError } = await admin
      .from("inventory_initial_balances")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();

    if (headerError) return { success: false, error: headerError.message };
    if (!header) return { success: false, error: "Document not found" };
    if (header.status === "posted") {
      return { success: false, error: "Document is already posted" };
    }
    if (header.status !== "draft") {
      return { success: false, error: "Only draft documents can be posted" };
    }

    const { data: items, error: itemsError } = await admin
      .from("inventory_initial_balance_items")
      .select("*")
      .eq("document_id", documentId)
      .order("line_no", { ascending: true });

    if (itemsError) return { success: false, error: itemsError.message };
    if (!items?.length) return { success: false, error: "Document has no line items" };

    const warehouseId = header.warehouse_id as string;

    for (const item of items) {
      const productId = item.product_id as string;
      const unitCost = Number(item.unit_cost) || 0;
      const isMetric = Boolean(item.is_metric);
      const pieceLengths = toNumberArray(item.piece_lengths);

      const { data: productRow } = await admin
        .from("products")
        .select("*")
        .eq("id", productId)
        .maybeSingle();

      const product = productRow as Product | null;
      if (!product) {
        return { success: false, error: `Product missing for line ${item.line_no}` };
      }

      const { data: stockBefore } = await admin
        .from("products")
        .select("stock, buy_price")
        .eq("id", productId)
        .maybeSingle();
      const oldStock = Number(stockBefore?.stock) || 0;
      const oldBuy = Number(stockBefore?.buy_price) || 0;

      if (isMetric || isMetricProduct(product)) {
        if (pieceLengths.length === 0) {
          return {
            success: false,
            error: `${item.product_name}: piece breakdown is required for metric products`,
          };
        }
        const barLengthM = resolveStandardBarLengthM(product);
        const addedQty = await insertMetricPieces(
          admin,
          productId,
          warehouseId,
          pieceLengths,
          barLengthM
        );
        const newStock = await syncPolywoodProductStockFromPieces(admin, productId, warehouseId);
        const newBuy = calcWeightedBuyPrice(oldStock, oldBuy, addedQty, unitCost, newStock);

        await admin
          .from("products")
          .update({ stock: newStock, buy_price: newBuy })
          .eq("id", productId);

        await admin.from("warehouse_stocks").upsert(
          {
            product_id: productId,
            warehouse_id: warehouseId,
            current_stock: newStock,
            piece_lengths: pieceLengths,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "product_id" }
        );

        await recordStockMovement(admin, {
          productId,
          warehouseId,
          movementType: "in",
          quantity: addedQty,
          unit: "Metr",
          referenceType: "initial_balance",
          referenceId: documentId,
          sourceLineId: item.id as string,
          description: `Initial balance ${header.document_number}`,
          createdBy: user.id,
        });

        await admin.rpc("create_inventory_batch", {
          p_product_id: productId,
          p_document_id: documentId,
          p_document_type: "initial_balance",
          p_unit_cost: unitCost,
          p_quantity: addedQty,
        });
      } else {
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) {
          return { success: false, error: `${item.product_name}: quantity must be greater than zero` };
        }

        const newStock = oldStock + qty;
        const newBuy = calcWeightedBuyPrice(oldStock, oldBuy, qty, unitCost, newStock);

        await admin
          .from("products")
          .update({ stock: newStock, buy_price: newBuy })
          .eq("id", productId);

        await admin.from("warehouse_stocks").upsert(
          {
            product_id: productId,
            warehouse_id: warehouseId,
            current_stock: newStock,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "product_id" }
        );

        await recordStockMovement(admin, {
          productId,
          warehouseId,
          movementType: "in",
          quantity: qty,
          unit: (item.unit as string) || "Ədəd",
          referenceType: "initial_balance",
          referenceId: documentId,
          sourceLineId: item.id as string,
          description: `Initial balance ${header.document_number}`,
          createdBy: user.id,
        });

        await admin.rpc("create_inventory_batch", {
          p_product_id: productId,
          p_document_id: documentId,
          p_document_type: "initial_balance",
          p_unit_cost: unitCost,
          p_quantity: qty,
        });
      }
    }

    const { error: postError } = await admin
      .from("inventory_initial_balances")
      .update({
        status: "posted",
        posted_at: new Date().toISOString(),
        posted_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (postError) return { success: false, error: postError.message };

    return {
      success: true,
      data: { document_number: header.document_number as string },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function cancelInitialBalanceDocumentAction(
  documentId: string
): Promise<InitialBalanceActionResult> {
  try {
    await requirePermissionAction("can_writeoff_inventory");
    const admin = createSupabaseAdminClient();
    const { data: header } = await admin
      .from("inventory_initial_balances")
      .select("status")
      .eq("id", documentId)
      .maybeSingle();

    if (!header) return { success: false, error: "Document not found" };
    if (header.status === "posted") {
      return { success: false, error: "Posted documents cannot be cancelled from the UI yet" };
    }

    const { error } = await admin
      .from("inventory_initial_balances")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", documentId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
