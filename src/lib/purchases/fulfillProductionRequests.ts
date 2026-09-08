import { supabase } from "@/lib/supabase";

/** Mark linked production purchase requests fulfilled after a purchase invoice is approved. */
export async function fulfillProductionPurchaseRequestsByPurchaseId(
  purchaseId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!purchaseId.trim()) return { ok: true };

  const { data: purchase, error: purchaseError } = await supabase
    .from("purchases")
    .select("id, status")
    .eq("id", purchaseId)
    .maybeSingle();

  if (purchaseError) return { ok: false, error: purchaseError.message };
  if (!purchase) return { ok: true };

  const purchaseStatus = String(purchase.status || "").toLowerCase();
  if (purchaseStatus === "draft" || purchaseStatus === "cancelled") {
    return { ok: true };
  }

  const { error: updateError } = await supabase
    .from("purchase_requests")
    .update({ status: "fulfilled", updated_at: new Date().toISOString() })
    .eq("purchase_id", purchaseId)
    .in("status", ["pending", "ordered"]);

  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}
