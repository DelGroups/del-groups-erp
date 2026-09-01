import { supabase } from "@/lib/supabase";

export const OPENING_BALANCE_CATEGORY = "İlkin Qalıq";

export type ReconcileAccountResultRow = {
  account_id: string;
  account_name: string | null;
  account_code: string | null;
  previous_balance: number;
  ledger_balance: number;
  adjusted: boolean;
};

export type ReconcileAccountBalancesResult = {
  success: boolean;
  error?: string;
  accountsChecked?: number;
  accountsAdjusted?: number;
  results?: ReconcileAccountResultRow[];
};

type ReconcileRpcPayload = {
  accounts_checked?: number;
  accounts_adjusted?: number;
  results?: ReconcileAccountResultRow[];
};

/**
 * Re-sync `accounts.balance` from the transaction journal:
 * SUM(Mədaxil) - SUM(Məxaric) per account.
 * @param accountId When omitted, reconciles all accounts.
 */
export async function reconcileAccountBalances(
  accountId?: string | null
): Promise<ReconcileAccountBalancesResult> {
  const { data, error } = await supabase.rpc("reconcile_account_balance_atomic", {
    p_account_id: accountId || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const payload = (data ?? {}) as ReconcileRpcPayload;
  return {
    success: true,
    accountsChecked: Number(payload.accounts_checked) || 0,
    accountsAdjusted: Number(payload.accounts_adjusted) || 0,
    results: (payload.results || []) as ReconcileAccountResultRow[],
  };
}

export function validateCashPaymentsRequireAccount(
  payments: Array<{ account_id?: string | null; amount?: number | null }>
): { ok: true } | { ok: false; error: string } {
  for (const pay of payments) {
    const amount = Number(pay.amount) || 0;
    if (amount <= 0) continue;
    if (!pay.account_id) {
      return { ok: false, error: "Ödəniş məbləği üçün kassa/bank hesabı seçilməlidir" };
    }
  }
  return { ok: true };
}

/** Post a single cash movement through the ledger helper RPC. */
export async function postCashTransaction(input: {
  accountId: string;
  type: "Mədaxil" | "Məxaric";
  amount: number;
  category: string;
  notes?: string | null;
  productionOrderId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}): Promise<{ success: boolean; error?: string; transactionId?: string }> {
  const { data, error } = await supabase.rpc("post_cash_transaction", {
    p_account_id: input.accountId,
    p_type: input.type,
    p_amount: input.amount,
    p_category: input.category,
    p_notes: input.notes || null,
    p_production_order_id: input.productionOrderId || null,
    p_source_type: input.sourceType || null,
    p_source_id: input.sourceId || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, transactionId: data ? String(data) : undefined };
}

export type { JournalEntryPayload, JournalEntryLinePayload, JournalEntryWithLines } from "@/lib/finance/journal";
export { getCashTransactionJournal, getJournalBySource, postJournalEntry } from "@/lib/finance/journal";
