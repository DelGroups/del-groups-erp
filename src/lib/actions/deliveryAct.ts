"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { requirePermissionAction } from "@/lib/auth/serverActionAuth";
import { isValidUuid } from "@/lib/auth/validate";
import { loadCompanyProfile } from "@/lib/company/loadCompanyProfile";
import { isDeliveryActEnabled } from "@/lib/features/deliveryAct";
import type { ActInput } from "@/lib/deliveryAct/act";
import { contractFromRow, mapActSource, type ActSource } from "@/lib/deliveryAct/source";

type Result<T> = { success: true; data: T } | { success: false; error: string };

/**
 * Everything the delivery act of one sales invoice needs, read with the user's own session (RLS as in
 * the sales screens): the invoice and its lines, the customer, the linked contract and the company
 * profile. Nothing is written. The dialog sets the act date and builds the act in the browser.
 */
export async function loadDeliveryActAction(saleId: string): Promise<Result<Omit<ActInput, "actDate">>> {
  if (!isDeliveryActEnabled()) return { success: false, error: "deliveryAct.errors.off" };
  if (!isValidUuid(saleId)) return { success: false, error: "deliveryAct.errors.notFound" };
  try {
    await requirePermissionAction("can_view_sales");
  } catch {
    return { success: false, error: "deliveryAct.errors.forbidden" };
  }
  const db = (await createSupabaseServerClient()) as unknown as SupabaseClient;

  const sale = await db.from("sales").select("id, doc_no, invoice_number, doc_date, is_official, contract_id, customer_id, customer_name").eq("id", saleId).maybeSingle();
  if (sale.error || !sale.data) return { success: false, error: "deliveryAct.errors.notFound" };
  const s = sale.data as ActSource["sale"];

  const lines = await db.from("sale_items").select("product_id, product_name, barcode, unit, unit_name, quantity").eq("sale_id", saleId).limit(500); // the same order as the invoice screen (fetchSaleById)
  if (lines.error) return { success: false, error: "deliveryAct.errors.loadFailed" };
  const items = (lines.data ?? []) as ActSource["lines"];

  // Barcodes missing on the line come from the product card.
  const missing = [...new Set(items.filter((l) => !l.barcode && l.product_id).map((l) => l.product_id as string))];
  const products = missing.length ? await db.from("products").select("id, barcode").in("id", missing) : { data: [] as Array<{ id: string; barcode: string | null }> };

  let customer: ActSource["customer"] = null;
  if (s.customer_id) {
    let c = await db.from("customers").select("full_name, company_name, entity_type, director_name").eq("id", s.customer_id).maybeSingle();
    if (c.error && /director_name/.test(c.error.message)) c = (await db.from("customers").select("full_name, company_name, entity_type").eq("id", s.customer_id).maybeSingle()) as typeof c;
    customer = (c.data as ActSource["customer"]) ?? null;
  }

  let contract: ActSource["contract"] = null;
  if (s.contract_id) {
    // The whole row: the contract's date column differs between installs (contract_date, or an older one).
    const k = await db.from("contracts").select("*").eq("id", s.contract_id).maybeSingle();
    contract = k.data ? contractFromRow(k.data as Record<string, unknown>) : null;
  }

  const { profile } = await loadCompanyProfile(db).catch(() => ({ profile: null }));
  return {
    success: true,
    data: mapActSource({ sale: s, lines: items, productBarcodes: (products.data ?? []) as ActSource["productBarcodes"], customer, contract, company: profile ? { legalName: profile.legalName || profile.displayName, directorName: profile.directorName } : null }),
  };
}
