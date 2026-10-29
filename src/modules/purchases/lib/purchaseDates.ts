/**
 * Invoice date of a purchase: doc_date, or the day it was created for rows saved before
 * purchases had a doc_date column (fix F1 adds it and back-fills it the same way).
 */
export function purchaseDocumentDate(purchase: { doc_date?: string | null; created_at?: string | null }): string | null {
  if (purchase.doc_date) return purchase.doc_date.slice(0, 10);
  return purchase.created_at ? purchase.created_at.slice(0, 10) : null;
}
