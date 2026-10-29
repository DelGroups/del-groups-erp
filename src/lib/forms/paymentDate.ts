/** Today's date in the user's local time zone, as YYYY-MM-DD (the value of an <input type="date">). */
export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type PaymentDateIssue = "date_required" | "date_in_future" | "before_document_date";

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * A payment date must be a real YYYY-MM-DD date, today or earlier, and (when the invoice date
 * is known) not before the invoice date. The database checks the same rules (fix F1).
 */
export function validatePaymentDate(
  value: string,
  today: string = todayLocalDate(),
  documentDate?: string | null
): PaymentDateIssue | null {
  if (!isIsoDate(value)) return "date_required";
  if (value > today) return "date_in_future";
  if (documentDate && isIsoDate(documentDate) && value < documentDate) return "before_document_date";
  return null;
}

/** Default payment date: today, or the invoice date when that is later (a future-dated invoice). */
export function defaultPaymentDate(documentDate?: string | null, today: string = todayLocalDate()): string {
  if (documentDate && isIsoDate(documentDate) && documentDate > today) return documentDate;
  return today;
}

/** The invoice is dated before today: its accounting entries use that date. */
export function isBackdatedDocument(documentDate: string | null | undefined, today: string = todayLocalDate()): boolean {
  return Boolean(documentDate && isIsoDate(documentDate) && documentDate < today);
}

/** dd.mm.yyyy for messages. */
export function formatDayMonthYear(value: string): string {
  return isIsoDate(value) ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : value;
}
