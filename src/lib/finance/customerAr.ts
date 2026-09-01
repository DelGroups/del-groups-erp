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

/** Void/cancel open AR on a sale and resync the linked customer balance. */
export async function voidSaleInvoice(
  saleId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("void_sale_atomic", {
    p_sale_id: saleId,
    p_reason: reason || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (data && typeof data === "object" && (data as { success?: boolean }).success === false) {
    return { success: false, error: String((data as { error?: string }).error || "Satış ləğv edilmədi") };
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
