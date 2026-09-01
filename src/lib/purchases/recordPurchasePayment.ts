import {
  invoicePaymentIdempotencyKey,
  newClientPaymentId,
} from "@/lib/finance/erpEvents";
import { assertPaymentAccountId } from "@/lib/forms/paymentValidation";
import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecordPurchasePaymentInput {
  purchaseId: string;
  invoiceNumber: string;
  supplierId: string | null;
  amount: number;
  accountId: string;
  method: string;
  notes?: string;
  currentPaid: number;
  totalAmount: number;
  currentDebt: number;
}

type ProcessInvoicePaymentEventResponse = {
  document_type?: string;
  paid_amount?: number;
  debt_amount?: number;
  status?: string;
  transaction_id?: string;
  journal_entry_id?: string;
  event_id?: string;
  success?: boolean;
  error?: string;
};

export async function recordPurchasePaymentWithClient(
  client: SupabaseClient,
  input: RecordPurchasePaymentInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const accountError = assertPaymentAccountId(input.accountId);
    if (accountError) {
      return { success: false, error: accountError };
    }

    if (input.amount <= 0) {
      return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
    }
    if (input.amount > input.currentDebt + 0.001) {
      return { success: false, error: `Qalan borc: ${input.currentDebt.toFixed(2)} AZN` };
    }

    const paymentId = newClientPaymentId();
    const accountId = input.accountId.trim();

    const { data, error } = await client.rpc("process_invoice_payment_event", {
      p_payload: {
        idempotency_key: invoicePaymentIdempotencyKey(
          "purchase",
          input.purchaseId,
          paymentId
        ),
        document_type: "purchase",
        document_id: input.purchaseId,
        amount: input.amount,
        account_id: accountId,
        method: input.method,
        notes: input.notes || `Alış fakturası ${input.invoiceNumber} — ${input.method}`,
        payment_id: paymentId,
      },
    });

    if (error) {
      console.error("PAYMENT_SUBMIT_ERROR:", error);
      return { success: false, error: error.message };
    }

    const result = (data ?? null) as ProcessInvoicePaymentEventResponse | null;
    if (result && result.success === false && result.error) {
      console.error("PAYMENT_SUBMIT_ERROR:", result.error);
      return { success: false, error: String(result.error) };
    }

    if (!result?.transaction_id) {
      console.error("PAYMENT_SUBMIT_ERROR: missing transaction_id", { data, result });
      return {
        success: false,
        error: "Ödəniş kassa/bank hesabına köçürülmədi (transaction_id yoxdur)",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("PAYMENT_SUBMIT_ERROR:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ödəniş qeydə alınmadı",
    };
  }
}

export async function recordPurchasePayment(
  input: RecordPurchasePaymentInput
): Promise<{ success: boolean; error?: string }> {
  return recordPurchasePaymentWithClient(supabase, input);
}
