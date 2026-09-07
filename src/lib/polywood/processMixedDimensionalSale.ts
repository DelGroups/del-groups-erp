import { supabase } from "@/lib/supabase";
import type {
  Json,
  ProcessMixedDimensionalSaleRpcArgs,
  ProcessMixedDimensionalSaleRpcReturns,
} from "@/types/database.types";

export type MixedDimensionalItemType = "dimensional" | "accessory" | "service";
export type MixedDimensionalSaleMode = "full_sheet" | "meter" | "linear_m";

export interface ProcessMixedDimensionalSaleInput {
  productId: string;
  warehouseId: string | null;
  itemType: MixedDimensionalItemType;
  saleMode?: MixedDimensionalSaleMode | null;
  /** Metres per piece (meter mode), total sheet count (full_sheet mode), or qty (accessory) */
  amount: number;
  /** How many identical cuts/pieces are needed (meter mode only). Defaults to 1. */
  pieceCount?: number;
  saleItemId?: string | null;
}

export interface MixedDimensionalCutStep {
  piece_id: string;
  action: "consume" | "partial" | "split_full";
  used_length?: number;
  remaining_on_piece?: number;
  scrap_length?: number;
}

export interface ProcessMixedDimensionalSaleData {
  ok: boolean;
  item_type: MixedDimensionalItemType;
  steps?: MixedDimensionalCutStep[];
  scrap_created?: { piece_id: string; length_m: number }[];
  deducted?: number;
}

export interface ProcessMixedDimensionalSaleResult {
  ok: boolean;
  error?: string;
  data?: ProcessMixedDimensionalSaleData;
}

function isJsonRecord(value: Json): value is Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, Json | undefined>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(
  record: Record<string, Json | undefined>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function parseCutSteps(value: Json | undefined): MixedDimensionalCutStep[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const steps: MixedDimensionalCutStep[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    const pieceId = readString(entry, "piece_id");
    const action = readString(entry, "action");
    if (!pieceId || !action) continue;
    if (action !== "consume" && action !== "partial" && action !== "split_full") continue;

    steps.push({
      piece_id: pieceId,
      action,
      used_length: readNumber(entry, "used_length"),
      remaining_on_piece: readNumber(entry, "remaining_on_piece"),
      scrap_length: readNumber(entry, "scrap_length"),
    });
  }

  return steps.length > 0 ? steps : undefined;
}

function parseScrapCreated(
  value: Json | undefined
): { piece_id: string; length_m: number }[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const scrap: { piece_id: string; length_m: number }[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    const pieceId = readString(entry, "piece_id");
    const lengthM = readNumber(entry, "length_m");
    if (!pieceId || lengthM == null) continue;
    scrap.push({ piece_id: pieceId, length_m: lengthM });
  }

  return scrap.length > 0 ? scrap : undefined;
}

function parseMixedDimensionalSaleData(
  data: ProcessMixedDimensionalSaleRpcReturns
): ProcessMixedDimensionalSaleData | undefined {
  if (!isJsonRecord(data) || data.ok !== true) return undefined;

  const itemType = readString(data, "item_type");
  if (
    itemType !== "dimensional" &&
    itemType !== "accessory" &&
    itemType !== "service"
  ) {
    return undefined;
  }

  return {
    ok: true,
    item_type: itemType,
    steps: parseCutSteps(data.steps),
    scrap_created: parseScrapCreated(data.scrap_created),
    deducted: readNumber(data, "deducted"),
  };
}

function toRpcArgs(input: ProcessMixedDimensionalSaleInput): ProcessMixedDimensionalSaleRpcArgs {
  return {
    p_product_id: input.productId,
    p_warehouse_id: input.warehouseId ?? "",
    p_item_type: input.itemType,
    p_sale_mode: input.saleMode ?? undefined,
    p_amount: input.amount,
    p_piece_count: input.pieceCount || 1,
    p_sale_item_id: input.saleItemId ?? undefined,
  };
}

/**
 * Atomically deducts inventory for one mixed-invoice line via the
 * `process_mixed_dimensional_sale` Postgres RPC:
 * - dimensional (full_sheet | meter/linear_m): auto-cut with off-cut/remnant handling
 * - accessory: plain products.stock deduction
 * - service: no inventory effect (cutting fee, labor, etc.)
 */
export async function processMixedDimensionalSaleRpc(
  input: ProcessMixedDimensionalSaleInput
): Promise<ProcessMixedDimensionalSaleResult> {
  const { data, error } = await supabase.rpc(
    "process_mixed_dimensional_sale",
    toRpcArgs(input)
  );

  if (error) return { ok: false, error: error.message };

  const parsed = parseMixedDimensionalSaleData(data);
  if (!parsed) {
    return { ok: false, error: "Unexpected RPC response from process_mixed_dimensional_sale" };
  }

  return { ok: true, data: parsed };
}

/** Reverses a previously-applied dimensional cut (used when voiding a sale). */
export async function rollbackMixedDimensionalSaleRpc(
  saleItemId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("rollback_mixed_dimensional_sale", {
    p_sale_item_id: saleItemId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
