/**
 * LOT-3: a stock transfer through post_stock_transfer (20261115120000_lot_outbound.sql): header,
 * lines, stock and lots in one database transaction. Pure (no client), so `node --test` covers it.
 * The API route uses it while LOT_TRACKING is on; otherwise, or before the SQL runs, the old
 * request-by-request path writes the transfer.
 */
import type { StockTransferLineInput, SubmitStockTransferPayload } from "./stockTransfer";

export type TransferPath = "rpc" | "legacy";

/** Which path writes a transfer: the one-transaction function while lot tracking is on. */
export function transferPath(lotTrackingEnabled: boolean): TransferPath {
  return lotTrackingEnabled ? "rpc" : "legacy";
}

const cleanLots = (lots: StockTransferLineInput["lots"]) =>
  Array.isArray(lots) && lots.length
    ? lots.filter((l) => l && typeof l.lot_id === "string" && Number(l.qty) > 0).map((l) => ({ lot_id: l.lot_id, qty: Number(l.qty) }))
    : [];

/** p_payload of post_stock_transfer. A line sends "lots" only when lots were chosen. */
export function transferRpcPayload(payload: SubmitStockTransferPayload, lines: readonly StockTransferLineInput[], referenceNumber: string) {
  return {
    reference_number: referenceNumber,
    from_warehouse_id: payload.from_warehouse_id,
    to_warehouse_id: payload.to_warehouse_id,
    transfer_date: payload.transfer_date,
    notes: payload.notes?.trim() || null,
    created_by: payload.created_by ?? null,
    items: lines.map((line) => {
      const lots = line.offcut_id ? [] : cleanLots(line.lots);
      return {
        product_id: line.product_id,
        offcut_id: line.offcut_id || null,
        quantity: line.quantity,
        product_code: line.product_code,
        product_name: line.product_name,
        unit: line.unit,
        barcode: line.barcode || null,
        available_stock: line.available_stock,
        ...(lots.length ? { lots } : {}),
      };
    }),
  };
}

/** PostgREST answers PGRST202 while a function does not exist yet (migration not applied). */
export function isMissingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === "PGRST202" || /could not find the function/i.test(error.message || "")));
}

/** The transfer id of post_stock_transfer's answer ({success, transfer_id, reference_number}). */
export function transferIdFromRpc(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as Record<string, unknown>).transfer_id;
  return typeof id === "string" && id ? id : null;
}
