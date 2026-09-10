"use server";

import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { createPartnerPayment, type CreatePartnerPaymentInput } from "@/lib/accounting";

export type PartnerPaymentActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export async function createPartnerPaymentAction(
  input: CreatePartnerPaymentInput
): Promise<
  PartnerPaymentActionResult<{
    paymentId: string;
    journalEntryId?: string;
    transactionId?: string;
  }>
> {
  try {
    await requirePermissionAction("can_manage_finance");
    const result = await createPartnerPayment(input, { useAdmin: true });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: {
        paymentId: result.paymentId,
        journalEntryId: result.journalEntryId,
        transactionId: result.transactionId,
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Ödəniş qeydə alınmadı" };
  }
}
