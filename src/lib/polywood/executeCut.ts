import { supabase } from "@/lib/supabase";
import type { PolywoodSaleMode } from "@/lib/polywood/constants";
import { planPolywoodSaleCut } from "@/lib/polywood/cutting";
import {
  fetchAvailablePolywoodPieces,
  syncPolywoodProductStock,
} from "@/lib/polywood/inventory";
import type { PolywoodCutResult } from "@/lib/polywood/types";

export interface ExecutePolywoodCutInput {
  productId: string;
  warehouseId: string;
  saleItemId: string;
  mode: PolywoodSaleMode;
  quantity: number;
  fullSheetLengthM: number;
}

export interface ExecutePolywoodCutResult {
  ok: boolean;
  error?: string;
  cutResult?: PolywoodCutResult;
}

export async function executePolywoodCut(
  input: ExecutePolywoodCutInput
): Promise<ExecutePolywoodCutResult> {
  try {
    const pieces = await fetchAvailablePolywoodPieces(input.productId, input.warehouseId);
    const cutResult = planPolywoodSaleCut(
      input.mode,
      input.quantity,
      pieces,
      input.fullSheetLengthM
    );

    const now = new Date().toISOString();
    const scrapPieceIds: string[] = [];

    for (const step of cutResult.steps) {
      if (step.action === "consume") {
        const { error } = await supabase
          .from("polywood_pieces")
          .update({
            status: "sold",
            sale_item_id: input.saleItemId,
            updated_at: now,
          })
          .eq("id", step.pieceId)
          .eq("status", "available");

        if (error) return { ok: false, error: error.message };
        continue;
      }

      if (step.action === "partial") {
        const { error: updateError } = await supabase
          .from("polywood_pieces")
          .update({
            length_m: step.remainingOnPiece,
            piece_type: "cut",
            updated_at: now,
          })
          .eq("id", step.pieceId)
          .eq("status", "available");

        if (updateError) return { ok: false, error: updateError.message };
        continue;
      }

      if (step.action === "split_full") {
        const { error: consumeError } = await supabase
          .from("polywood_pieces")
          .update({
            status: "consumed",
            sale_item_id: input.saleItemId,
            updated_at: now,
          })
          .eq("id", step.pieceId)
          .eq("status", "available");

        if (consumeError) return { ok: false, error: consumeError.message };

        if (step.scrapLength && step.scrapLength > 0) {
          const { data: scrapRow, error: scrapError } = await supabase
            .from("polywood_pieces")
            .insert([
              {
                product_id: input.productId,
                warehouse_id: input.warehouseId,
                length_m: step.scrapLength,
                piece_type: "cut",
                status: "available",
                notes: `Cut remainder from sale item ${input.saleItemId}`,
                sale_item_id: null,
                updated_at: now,
              },
            ])
            .select("id")
            .single();

          if (scrapError) return { ok: false, error: scrapError.message };
          if (scrapRow?.id) scrapPieceIds.push(scrapRow.id as string);
        }
      }
    }

    const { error: detailError } = await supabase
      .from("sale_items")
      .update({
        polywood_cut_details: {
          steps: cutResult.steps,
          scrap_created: cutResult.scrapCreated,
          scrap_piece_ids: scrapPieceIds,
        },
      })
      .eq("id", input.saleItemId);

    if (detailError) return { ok: false, error: detailError.message };

    await syncPolywoodProductStock(input.productId, input.warehouseId);
    return { ok: true, cutResult };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Polywood cut failed",
    };
  }
}

export async function rollbackPolywoodCut(
  saleItemId: string,
  cutDetails: {
    steps?: {
      pieceId: string;
      action: string;
      usedLength?: number;
      remainingOnPiece?: number;
      scrapLength?: number;
    }[];
    scrap_piece_ids?: string[];
  } | null
): Promise<void> {
  if (!cutDetails) return;
  const now = new Date().toISOString();

  if (cutDetails.scrap_piece_ids?.length) {
    await supabase.from("polywood_pieces").delete().in("id", cutDetails.scrap_piece_ids);
  }

  for (const step of cutDetails.steps || []) {
    if (step.action === "consume") {
      await supabase
        .from("polywood_pieces")
        .update({ status: "available", sale_item_id: null, updated_at: now })
        .eq("id", step.pieceId);
      continue;
    }

    if (step.action === "partial" && step.remainingOnPiece !== undefined) {
      const restoredLength = step.remainingOnPiece + (step.usedLength || 0);
      await supabase
        .from("polywood_pieces")
        .update({
          length_m: restoredLength,
          piece_type: "cut",
          status: "available",
          sale_item_id: null,
          updated_at: now,
        })
        .eq("id", step.pieceId);
      continue;
    }

    if (step.action === "split_full") {
      await supabase
        .from("polywood_pieces")
        .update({ status: "available", sale_item_id: null, updated_at: now })
        .eq("id", step.pieceId);
    }
  }

  await supabase
    .from("sale_items")
    .update({ polywood_cut_details: null })
    .eq("id", saleItemId);
}
