import {
  invoicePaymentIdempotencyKey,
  newClientPaymentId,
} from "@/lib/finance/erpEvents";
import { assertPaymentAccountId } from "@/lib/forms/paymentValidation";
import { supabase } from "@/lib/supabase";
import type { SalePayment } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TreasuryPaymentSplit } from "@/lib/finance/officialTransaction";

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
  treasurySplits?: TreasuryPaymentSplit[];
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

async function processOneSalePayment(
  client: SupabaseClient,
  input: RecordSalePaymentInput,
  split: { amount: number; accountId: string; method: string; notes?: string; paymentId: string }
): Promise<{ success: boolean; error?: string }> {
  const accountError = assertPaymentAccountId(split.accountId);
  if (accountError) {
    return { success: false, error: accountError };
  }

  const { data, error } = await client.rpc("process_invoice_payment_event", {
    p_payload: {
      idempotency_key: invoicePaymentIdempotencyKey("sale", input.saleId, split.paymentId),
      document_type: "sale",
      document_id: input.saleId,
      amount: split.amount,
      account_id: split.accountId.trim(),
      method: split.method,
      notes: split.notes || `Satış fakturası ${input.docNo} — ${split.method}`,
      payment_id: split.paymentId,
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
}

export async function recordSalePaymentWithClient(
  client: SupabaseClient,
  input: RecordSalePaymentInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const remaining = Math.max(0, input.totalAmount - input.currentPaid);
    if (input.amount <= 0) {
      return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
    }
    if (input.amount > remaining + 0.001) {
      return { success: false, error: `Qalan borc: ${remaining.toFixed(2)} AZN` };
    }

    const splits = (input.treasurySplits || []).filter((s) => s.amount > 0);
    if (splits.length > 0) {
      const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
      if (Math.abs(splitTotal - input.amount) > 0.02) {
        return { success: false, error: "Əsas və ƏDV məbləğlərinin cəmi ödənişə uyğun gəlmir" };
      }

      for (const split of splits) {
        const paymentId = newClientPaymentId();
        const result = await processOneSalePayment(client, input, {
          amount: split.amount,
          accountId: split.accountId,
          method: split.method,
          notes: split.notes || `${input.notes || ""} (${split.label})`.trim(),
          paymentId,
        });
        if (!result.success) return result;
      }
      return { success: true };
    }

    const accountError = assertPaymentAccountId(input.accountId);
    if (accountError) {
      return { success: false, error: accountError };
    }

    const paymentId = newClientPaymentId();
    return await processOneSalePayment(client, input, {
      amount: input.amount,
      accountId: input.accountId,
      method: input.method,
      notes: input.notes,
      paymentId,
    });
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
