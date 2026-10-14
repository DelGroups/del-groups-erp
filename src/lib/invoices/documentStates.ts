/**
 * States shown for invoice-like documents in the new UI (sales, purchases): payment state from
 * total / paid / remaining, and the warehouse send state exactly as the classic send badge.
 * Pure, no imports, so tests and every module can use it.
 */
export type PaymentState = "unpaid" | "partial" | "paid";
export type WarehouseState = "not_sent" | "pending" | "approved" | "rejected";

export function paymentState(total: number, paid: number, remaining: number): PaymentState {
  if (remaining <= 0.004) return "paid";
  return paid > 0 || remaining < total - 0.004 ? "partial" : "unpaid";
}

/** The classic send badge: not sent, waiting for approval, sent, else rejected. */
export function warehouseState(sent: unknown, slipStatus: unknown): WarehouseState {
  if (sent !== true) return "not_sent";
  if (slipStatus === "pending") return "pending";
  if (slipStatus === "approved") return "approved";
  return "rejected";
}

export const DOC_STATUS_OPTIONS = [
  { value: "draft", labelKey: "invoice.statusDraft", color: "#94a3b8" },
  { value: "posted", labelKey: "invoice.statusPosted", color: "#10b981" },
  { value: "cancelled", labelKey: "invoice.statusCancelled", color: "#f43f5e" },
] as const;
export const PAYMENT_STATE_OPTIONS = [
  { value: "unpaid", labelKey: "sales.engine.payment.unpaid", color: "#f43f5e" },
  { value: "partial", labelKey: "sales.engine.payment.partial", color: "#f59e0b" },
  { value: "paid", labelKey: "sales.engine.payment.paid", color: "#10b981" },
] as const;
export const WAREHOUSE_STATE_OPTIONS = [
  { value: "not_sent", labelKey: "warehouseSend.notSent", color: "#94a3b8" },
  { value: "pending", labelKey: "warehouseSend.pendingApproval", color: "#f59e0b" },
  { value: "approved", labelKey: "warehouseSend.sent", color: "#10b981" },
  { value: "rejected", labelKey: "warehouseSend.rejected", color: "#f43f5e" },
] as const;
