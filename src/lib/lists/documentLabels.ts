/**
 * i18n keys of document states as text, for list cells and Excel exports (prompt 24c), where a
 * badge cannot be used. Same states as the classic badges and the new UI's options.
 */
import { DOC_STATUS_OPTIONS, WAREHOUSE_STATE_OPTIONS, warehouseState } from "../invoices/documentStates";

export function docStatusLabelKey(status: string): string {
  return DOC_STATUS_OPTIONS.find((o) => o.value === status)?.labelKey ?? "invoice.statusPosted";
}

export function warehouseStateLabelKey(sent: unknown, slipStatus: unknown): string {
  const state = warehouseState(sent, slipStatus);
  return WAREHOUSE_STATE_OPTIONS.find((o) => o.value === state)?.labelKey ?? "warehouseSend.notSent";
}

const PAYMENT_TYPE_KEYS: Record<string, string> = {
  cash: "invoice.paymentTypeCash",
  credit: "invoice.paymentTypeCredit",
  bank_transfer: "invoice.paymentTypeBank",
};

export function paymentTypeLabelKey(type: string | null | undefined): string | null {
  return type ? PAYMENT_TYPE_KEYS[type] ?? null : null;
}
