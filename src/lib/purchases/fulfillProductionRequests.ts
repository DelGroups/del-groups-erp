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
    .in("status", ["pending", "ordered", "auto_triggered"]);

  if (updateError) return { ok: false, error: updateError.message };

  const { data: items } = await supabase
    .from("purchase_items")
    .select("product_id")
    .eq("purchase_id", purchaseId);

  const productIds = [...new Set((items || []).map((row) => row.product_id).filter(Boolean))] as string[];
  if (productIds.length > 0) {
    await supabase
      .from("purchase_requests")
      .update({
        status: "fulfilled",
        purchase_id: purchaseId,
        updated_at: new Date().toISOString(),
      })
      .in("product_id", productIds)
      .eq("source", "safety_stock")
      .in("status", ["auto_triggered", "pending", "ordered"]);
  }

  return { ok: true };
}
