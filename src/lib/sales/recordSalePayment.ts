import {
  invoicePaymentIdempotencyKey,
  newClientPaymentId,
} from "@/lib/finance/erpEvents";
import { assertPaymentAccountId } from "@/lib/forms/paymentValidation";
import { supabase } from "@/lib/supabase";
import type { SalePayment } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecordSalePaymentInput {
  saleId: string;
  docNo: string;
  customerId?: string | null;
  amount: number;
  accountId: string;
  method: string;
  notes?: string;
  currentPaid: number;
  totalAmount: number;
  existingPayments: SalePayment[];
}

type ProcessInvoicePaymentEventResponse = {
  document_type?: string;
  paid_amount?: number;
  remaining_balance?: number;
  transaction_id?: string;
  journal_entry_id?: string;
  event_id?: string;
  success?: boolean;
  error?: string;
};

export async function recordSalePaymentWithClient(
  client: SupabaseClient,
  input: RecordSalePaymentInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const accountError = assertPaymentAccountId(input.accountId);
    if (accountError) {
      return { success: false, error: accountError };
    }

    const remaining = Math.max(0, input.totalAmount - input.currentPaid);
    if (input.amount <= 0) {
      return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
    }
    if (input.amount > remaining + 0.001) {
      return { success: false, error: `Qalan borc: ${remaining.toFixed(2)} AZN` };
    }

    const paymentId = newClientPaymentId();
    const accountId = input.accountId.trim();

    const { data, error } = await client.rpc("process_invoice_payment_event", {
      p_payload: {
        idempotency_key: invoicePaymentIdempotencyKey("sale", input.saleId, paymentId),
        document_type: "sale",
        document_id: input.saleId,
        amount: input.amount,
        account_id: accountId,
        method: input.method,
        notes: input.notes || `Satış fakturası ${input.docNo} — ${input.method}`,
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

export async function recordSalePayment(
  input: RecordSalePaymentInput
): Promise<{ success: boolean; error?: string }> {
  return recordSalePaymentWithClient(supabase, input);
}
