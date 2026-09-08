import { supabase } from "@/lib/supabase";

export type CustomerArDiscrepancy = {
  customer_id: string;
  customer_name: string;
  stored_balance: number;
  ledger_balance: number;
  delta: number;
};

export type CustomerArCheckResult = {
  success: boolean;
  error?: string;
  discrepancyCount?: number;
  discrepancies?: CustomerArDiscrepancy[];
};

export type CustomerArReconcileResult = {
  success: boolean;
  error?: string;
  customersChecked?: number;
  customersAdjusted?: number;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Recompute customers.balance from SUM(sales.remaining_balance) for one customer. */
export async function refreshCustomerArBalance(
  customerId: string
): Promise<{ success: boolean; error?: string; balance?: number }> {
  const { data, error } = await supabase.rpc("refresh_customer_ar_balance", {
    p_customer_id: customerId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, balance: num(data) };
}

/** Read-only mismatch report between customers.balance and open sales totals. */
export async function checkCustomerArDiscrepancies(): Promise<CustomerArCheckResult> {
  const { data, error } = await supabase.rpc("check_customer_ar_discrepancies");

  if (error) {
    return { success: false, error: error.message };
  }

  const payload = (data ?? {}) as {
    discrepancy_count?: number;
    discrepancies?: CustomerArDiscrepancy[];
  };

  return {
    success: true,
    discrepancyCount: num(payload.discrepancy_count),
    discrepancies: (payload.discrepancies || []).map((row) => ({
      customer_id: String(row.customer_id),
      customer_name: String(row.customer_name || ""),
      stored_balance: num(row.stored_balance),
      ledger_balance: num(row.ledger_balance),
      delta: num(row.delta),
    })),
  };
}

/** Fix customers.balance to match open sales AR ledger (one or all customers). */
export async function reconcileCustomerArBalances(
  customerId?: string | null
): Promise<CustomerArReconcileResult> {
  const { data, error } = await supabase.rpc("reconcile_customer_ar_balances", {
    p_customer_id: customerId || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const payload = (data ?? {}) as {
    customers_checked?: number;
    customers_adjusted?: number;
  };

  return {
    success: true,
    customersChecked: num(payload.customers_checked),
    customersAdjusted: num(payload.customers_adjusted),
  };
}

/** Void/cancel a sale invoice via direct Supabase queries (no RPC). */
export async function voidSaleInvoice(
  saleId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  if (!saleId?.trim()) {
    return { success: false, error: "Satış tapılmadı" };
  }

  const { data: sale, error: fetchError } = await supabase
    .from("sales")
    .select("id, status, doc_no, invoice_number, customer_id, notes, note")
    .eq("id", saleId)
    .single();

  if (fetchError || !sale) {
    return { success: false, error: fetchError?.message || "Satış fakturası tapılmadı" };
  }

  if (
    sale.status &&
    ["cancelled", "ləğv edildi", "legv edildi", "void", "voided"].includes(
      sale.status.trim().toLowerCase()
    )
  ) {
    return { success: true };
  }

  const docLabel = sale.doc_no || sale.invoice_number || saleId;
  const voidNote = (reason || "").trim() || "Satış fakturası ləğv edildi";

  const { data: items } = await supabase
    .from("sale_items")
    .select("product_id, quantity, polywood_sale_mode")
    .eq("sale_id", saleId);

  for (const item of items || []) {
    if (!item.product_id || item.polywood_sale_mode) continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    const { data: product } = await supabase
      .from("products")
      .select("stock")
      .eq("id", item.product_id)
      .single();

    if (!product) continue;
    await supabase
      .from("products")
      .update({ stock: (Number(product.stock) || 0) + qty })
      .eq("id", item.product_id);
  }

  await supabase.from("transactions").delete().eq("source_type", "sale").eq("source_id", saleId);

  if (docLabel) {
    await supabase
      .from("transactions")
      .delete()
      .is("source_type", null)
      .is("source_id", null)
      .ilike("notes", `%${docLabel}%`);
  }

  const existingNotes = sale.notes || sale.note || "";
  const { error: updateError } = await supabase
    .from("sales")
    .update({
      status: "cancelled",
      paid_amount: 0,
      remaining_balance: 0,
      payments: [],
      warehouse_sent: false,
      warehouse_slip_status: null,
      note: voidNote,
      notes: existingNotes ? `${existingNotes}\n${voidNote}` : voidNote,
    })
    .eq("id", saleId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true };
}

/** Sum of customers.balance (canonical AR master total). */
export async function sumCustomerArBalances(): Promise<number> {
  const { data, error } = await supabase.from("customers").select("balance");
  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + Math.max(0, num(row.balance)), 0);
}

/** Sum of sales.remaining_balance (ledger cross-check). */
export async function sumSalesOpenAr(): Promise<number> {
  const { data, error } = await supabase.from("sales").select("remaining_balance");
  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + Math.max(0, num(row.remaining_balance)), 0);
}
