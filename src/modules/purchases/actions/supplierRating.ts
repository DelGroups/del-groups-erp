"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";

export async function rateSupplierDeliveryAction(input: {
  purchaseId: string;
  qualityScore: number;
  deliverySpeedScore: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermissionAction("can_create_purchase");

    if (!isValidUuid(input.purchaseId)) {
      return { success: false, error: "Etibarlı alış fakturası seçin" };
    }

    const quality = Math.round(Number(input.qualityScore));
    const speed = Math.round(Number(input.deliverySpeedScore));
    if (quality < 1 || quality > 5 || speed < 1 || speed > 5) {
      return { success: false, error: "Qiymət 1-5 ulduz arasında olmalıdır" };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("rate_supplier_delivery", {
      p_purchase_id: input.purchaseId,
      p_quality: quality,
      p_speed: speed,
      p_notes: null,
    });

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Qiymətləndirmə saxlanılmadı",
    };
  }
}
