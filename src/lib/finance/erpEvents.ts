/** Stable idempotency keys for Phase 2 atomic ERP event RPCs (network retry safe). */

export function erpIdempotencyKey(scope: string, ...parts: (string | null | undefined)[]): string {
  return [scope, ...parts.filter((p): p is string => Boolean(p && String(p).trim()))].join(":");
}

export function saleInvoiceIdempotencyKey(docNo: string): string {
  return erpIdempotencyKey("sale_invoice", docNo.trim());
}

export function purchaseReceiptIdempotencyKey(invoiceNumber: string): string {
  return erpIdempotencyKey("purchase_receipt", invoiceNumber.trim());
}

export function invoicePaymentIdempotencyKey(
  documentType: "sale" | "purchase",
  documentId: string,
  paymentId: string
): string {
  return erpIdempotencyKey("invoice_payment", documentType, documentId, paymentId);
}

export function newClientPaymentId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function productionMaterialIssueIdempotencyKey(
  orderId: string,
  materialIds?: string[] | null
): string {
  if (materialIds?.length) {
    return erpIdempotencyKey("production_material_issue", orderId, materialIds.slice().sort().join(","));
  }
  return erpIdempotencyKey("production_material_issue", orderId);
}

export function productionReadyIdempotencyKey(orderId: string): string {
  return erpIdempotencyKey("production_ready", orderId);
}

export function productionDeliveryIdempotencyKey(orderId: string): string {
  return erpIdempotencyKey("production_delivery", orderId);
}

export function productionAdvanceIdempotencyKey(orderId: string): string {
  return erpIdempotencyKey("production_advance", orderId);
}
