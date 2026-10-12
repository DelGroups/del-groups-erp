/** Writes a stock transfer (server only: the inventory transfers API route). */
import { recordStockMovement } from "@/lib/inventory/stockMovements";
import { adjustProductStockAtWarehouse } from "@/lib/inventory/warehouseProductStock";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { generateStockTransferDocumentNumber } from "@/types/database.types";
import {
  STOCK_TRANSFER_IN_REF,
  STOCK_TRANSFER_OUT_REF,
  type SubmitStockTransferPayload,
  type SubmitStockTransferResult,
} from "./stockTransfer";

export async function submitStockTransfer(
  payload: SubmitStockTransferPayload
): Promise<SubmitStockTransferResult> {
  if (!payload.from_warehouse_id || !payload.to_warehouse_id) {
    return { success: false, error: "Anbarları seçin" };
  }
  if (payload.from_warehouse_id === payload.to_warehouse_id) {
    return { success: false, error: "Çıxış və giriş anbarı eyni ola bilməz" };
  }

  const lines = payload.items.filter((row) => row.product_id && row.quantity > 0);
  if (lines.length === 0) {
    return { success: false, error: "Ən azı bir sətir əlavə edin" };
  }

  for (const line of lines) {
    if (line.quantity > line.available_stock) {
      return {
        success: false,
        error: `${line.product_name}: transfer miqdarı mövcud qalıqdan çoxdur`,
      };
    }
  }

  const admin = await createSupabaseAdminClient();
  const referenceNumber = payload.reference_number?.trim() || generateStockTransferDocumentNumber();

  const { data: header, error: headerError } = await admin
    .from("stock_transfers")
    .insert([
      {
        reference_number: referenceNumber,
        from_warehouse_id: payload.from_warehouse_id,
        to_warehouse_id: payload.to_warehouse_id,
        transfer_date: payload.transfer_date,
        status: "completed",
        notes: payload.notes?.trim() || null,
        created_by: payload.created_by ?? null,
      },
    ])
    .select("id")
    .single();

  if (headerError || !header?.id) {
    return { success: false, error: headerError?.message || "Transfer sənədi yaradılmadı" };
  }

  const transferId = header.id as string;

  try {
    for (const line of lines) {
      const { error: itemError } = await admin.from("stock_transfer_items").insert([
        {
          transfer_id: transferId,
          product_id: line.product_id,
          offcut_id: line.offcut_id || null,
          quantity: line.quantity,
          product_code: line.product_code,
          product_name: line.product_name,
          unit: line.unit,
          barcode: line.barcode || null,
        },
      ]);
      if (itemError) throw new Error(itemError.message);

      if (line.offcut_id) {
        const { error: pieceError } = await admin
          .from("polywood_pieces")
          .update({ warehouse_id: payload.to_warehouse_id })
          .eq("id", line.offcut_id);
        if (pieceError) throw new Error(pieceError.message);
      } else {
        await adjustProductStockAtWarehouse(
          admin,
          line.product_id,
          payload.from_warehouse_id,
          -line.quantity
        );
        await adjustProductStockAtWarehouse(
          admin,
          line.product_id,
          payload.to_warehouse_id,
          line.quantity
        );
      }

      const { data: productRow } = await admin
        .from("products")
        .select("unit")
        .eq("id", line.product_id)
        .maybeSingle();

      await recordStockMovement(admin, {
        productId: line.product_id,
        warehouseId: payload.from_warehouse_id,
        movementType: "out",
        quantity: line.quantity,
        unit: productRow?.unit || line.unit,
        referenceType: STOCK_TRANSFER_OUT_REF,
        referenceId: transferId,
        description: `Anbarlar arası transfer — ${referenceNumber}`,
        createdBy: payload.created_by ?? null,
      });

      await recordStockMovement(admin, {
        productId: line.product_id,
        warehouseId: payload.to_warehouse_id,
        movementType: "in",
        quantity: line.quantity,
        unit: productRow?.unit || line.unit,
        referenceType: STOCK_TRANSFER_IN_REF,
        referenceId: transferId,
        description: `Anbarlar arası transfer — ${referenceNumber}`,
        createdBy: payload.created_by ?? null,
      });
    }
  } catch (error) {
    await admin.from("stock_transfers").delete().eq("id", transferId);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Transfer tamamlanmadı",
    };
  }

  const [{ data: fromWh }, { data: toWh }] = await Promise.all([
    admin.from("warehouses").select("name").eq("id", payload.from_warehouse_id).maybeSingle(),
    admin.from("warehouses").select("name").eq("id", payload.to_warehouse_id).maybeSingle(),
  ]);

  return {
    success: true,
    transferId,
    print: {
      reference_number: referenceNumber,
      transfer_date: payload.transfer_date,
      from_warehouse_name: fromWh?.name || "—",
      to_warehouse_name: toWh?.name || "—",
      notes: payload.notes,
      items: lines.map((line) => ({
        product_code: line.product_code,
        product_name: line.product_name,
        barcode: line.barcode,
        unit: line.unit,
        quantity: line.quantity,
      })),
    },
  };
}
