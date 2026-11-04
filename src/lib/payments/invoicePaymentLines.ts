import type { SupabaseClient } from "@supabase/supabase-js";
import { invoicePaymentIdempotencyKey, newClientPaymentId } from "@/lib/finance/erpEvents";
import type { TreasuryPaymentSplit } from "@/lib/finance/officialTransaction";

/**
 * A sales / purchase invoice payment from several accounts as ONE payment event (IMP-5):
 * process_invoice_payment_event with payload.lines, one journal entry for all of them.
 *
 * Before migration 20261105100000_imports_stages_pay.sql the database ignores "lines" and finds
 * no account (account_id is left out on purpose, so it can never pay everything from one
 * account): `legacy` is then true and the caller posts each line on its own, as before.
 */
export async function processInvoicePaymentLines(
  client: SupabaseClient,
  input: {
    documentType: "sale" | "purchase";
    documentId: string;
    splits: readonly TreasuryPaymentSplit[];
    notes?: string;
    paymentDate?: string;
  }
): Promise<{ success: boolean; error?: string; legacy?: boolean }> {
  const paymentId = newClientPaymentId();
  const { data, error } = await client.rpc("process_invoice_payment_event", {
    p_payload: {
      idempotency_key: invoicePaymentIdempotencyKey(input.documentType, input.documentId, paymentId),
      document_type: input.documentType,
      document_id: input.documentId,
      payment_id: paymentId,
      payment_date: input.paymentDate,
      notes: input.notes || undefined,
      lines: input.splits
        .filter((s) => s.amount > 0)
        .map((s) => ({ account_id: s.accountId.trim(), amount: Math.round(s.amount * 100) / 100, method: s.method, note: s.notes || s.label || null })),
    },
  });
  if (error) {
    if (isLegacyLinesError(error.message)) return { success: false, legacy: true };
    return { success: false, error: error.message };
  }
  const result = (data ?? null) as { success?: boolean; error?: string; transaction_id?: string } | null;
  if (result && result.success === false && result.error) return { success: false, error: String(result.error) };
  if (!result?.transaction_id) return { success: false, error: "Ödəniş kassa/bank hesabına köçürülmədi (transaction_id yoxdur)" };
  return { success: true };
}

/** The answer of a database without payment lines (it looked for the one account_id). */
export function isLegacyLinesError(message: string | null | undefined): boolean {
  return /Kassa\/bank hesabı seçilməlidir|account_required/i.test(message ?? "");
}
