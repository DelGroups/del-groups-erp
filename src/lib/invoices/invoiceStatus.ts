const CANCELLED_STATUSES = new Set([
  "cancelled",
  "ləğv edildi",
  "legv edildi",
  "void",
  "voided",
]);

export type SalesDocumentStatus = "draft" | "posted" | "cancelled";
export type SalesPaymentType = "cash" | "credit" | "bank_transfer";
export type SalesCurrency = "AZN" | "USD" | "EUR";

export function isInvoiceCancelled(status: string | null | undefined): boolean {
  if (!status) return false;
  return CANCELLED_STATUSES.has(status.trim().toLowerCase());
}

/** Legacy invoices with a blank status were created by the posting RPC. */
export function isSalesPosted(status: string | null | undefined): boolean {
  if (!status || !status.trim()) return true;
  return status.trim().toLowerCase() === "posted";
}

export function isSalesDraft(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "draft";
}

export function normalizeSalesDocumentStatus(
  status: string | null | undefined
): SalesDocumentStatus {
  if (isInvoiceCancelled(status)) return "cancelled";
  if (isSalesDraft(status)) return "draft";
  return "posted";
}

export type PurchaseDocumentStatus = "draft" | "posted" | "cancelled";

/** Legacy purchase invoices with blank or debtor/paid labels were posted immediately. */
export function isPurchasePosted(status: string | null | undefined): boolean {
  if (!status || !status.trim()) return true;
  const normalized = status.trim().toLowerCase();
  if (normalized === "draft") return false;
  if (isInvoiceCancelled(status)) return false;
  return true;
}

export function isPurchaseDraft(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "draft";
}

export function normalizePurchaseDocumentStatus(
  status: string | null | undefined
): PurchaseDocumentStatus {
  if (isInvoiceCancelled(status)) return "cancelled";
  if (isPurchaseDraft(status)) return "draft";
  return "posted";
}
