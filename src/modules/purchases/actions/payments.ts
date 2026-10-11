"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  recordPurchasePaymentWithClient,
  type RecordPurchasePaymentInput,
} from "../lib/recordPurchasePayment";

export async function recordPurchasePaymentAction(
  input: RecordPurchasePaymentInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await createSupabaseServerClient();
    return await recordPurchasePaymentWithClient(client, input);
  } catch (error) {
    console.error("PAYMENT_SUBMIT_ERROR:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ödəniş qeydə alınmadı",
    };
  }
}
