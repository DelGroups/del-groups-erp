const CANCELLED_STATUSES = new Set([
  "cancelled",
  "ləğv edildi",
  "legv edildi",
  "void",
  "voided",
]);

export function isInvoiceCancelled(status: string | null | undefined): boolean {
  if (!status) return false;
  return CANCELLED_STATUSES.has(status.trim().toLowerCase());
}
