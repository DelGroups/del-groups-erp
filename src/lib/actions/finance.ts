"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { clampString, isValidUuid } from "@/lib/auth/validate";
import {
  computeAccountLedgerBalances,
  mapUnifiedLedgerRow,
  summarizeUnifiedLedger,
  UNIFIED_LEDGER_SELECT_ATTEMPTS,
  type AccountLedgerBalance,
  type FinancialCategoryOption,
  type UnifiedLedgerSummary,
  type UnifiedLedgerTransaction,
  type UnifiedTransactionType,
} from "@/lib/finance/unifiedLedger";

export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

const ACCOUNT_TYPES = new Set(["Kassa", "Bank"]);

export interface CreateExpenseInput {
  category: string;
  amount: number;
  accountId: string;
  notes?: string;
  description?: string;
}

export interface CreateAccountInput {
  code?: string;
  name: string;
  type: string;
  balance?: number;
}

export interface UpdateAccountInput {
  accountId: string;
  code?: string;
  name: string;
  type: string;
}

async function fetchTransactionsRaw(
  filter?: { type?: UnifiedTransactionType }
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  const admin = createSupabaseAdminClient();

  for (const fields of UNIFIED_LEDGER_SELECT_ATTEMPTS) {
    let query = admin.from("transactions").select(fields).order("created_at", { ascending: false }).limit(2000);

    if (filter?.type && fields.includes("unified_type")) {
      query = query.eq("unified_type", filter.type);
    }

    const { data, error } = await query;
    if (!error) {
      let rows = (data || []) as Record<string, unknown>[];
      if (filter?.type && !fields.includes("unified_type")) {
        rows = rows.filter((row) => mapUnifiedLedgerRow(row).type === filter.type);
      }
      return { rows, error: null };
    }

    if (!/column|schema cache/i.test(error.message || "")) {
      return { rows: [], error: error.message };
    }
  }

  return { rows: [], error: "transactions schema mismatch" };
}

export async function fetchFinancialCategoriesAction(): Promise<
  ActionResult<FinancialCategoryOption[]>
> {
  try {
    await requirePermissionAction("can_view_finance");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("financial_categories")
      .select("id,name,type,is_active")
      .eq("is_active", true)
      .order("name")
      .limit(200);

    if (!error && data?.length) {
      return {
        success: true,
        data: data.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          type: String(row.type) as UnifiedTransactionType,
        })),
      };
    }

    const fallback = [
      { id: "icare", name: "İcarə", type: "EXPENSE" as const },
      { id: "elektrik", name: "Elektrik", type: "EXPENSE" as const },
      { id: "yanacaq", name: "Yanacaq", type: "EXPENSE" as const },
      { id: "internet", name: "İnternet", type: "EXPENSE" as const },
      { id: "reklam", name: "Reklam", type: "EXPENSE" as const },
      { id: "temir", name: "Təmir", type: "EXPENSE" as const },
      { id: "maas", name: "Maaş", type: "EXPENSE" as const },
      { id: "diger", name: "Digər", type: "EXPENSE" as const },
    ];
    return { success: true, data: fallback };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function fetchUnifiedLedgerAction(input?: {
  type?: UnifiedTransactionType;
}): Promise<
  ActionResult<{
    transactions: UnifiedLedgerTransaction[];
    summary: UnifiedLedgerSummary;
  }>
> {
  try {
    await requirePermissionAction("can_view_finance");
    const { rows, error } = await fetchTransactionsRaw(input);
    if (error) return { success: false, error };

    const transactions = rows.map(mapUnifiedLedgerRow);
    return {
      success: true,
      data: {
        transactions,
        summary: summarizeUnifiedLedger(transactions),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function fetchAccountLedgerBalancesAction(): Promise<
  ActionResult<{
    accounts: AccountLedgerBalance[];
    recentTransactions: UnifiedLedgerTransaction[];
  }>
> {
  try {
    await requirePermissionAction("can_view_finance");
    const admin = createSupabaseAdminClient();
    const [accountsRes, ledger] = await Promise.all([
      admin.from("accounts").select("id,code,name,type,balance").order("name"),
      fetchUnifiedLedgerAction(),
    ]);

    if (!ledger.success || !ledger.data) {
      return { success: false, error: ledger.error || "Ledger yüklənmədi" };
    }

    const balances = computeAccountLedgerBalances(
      (accountsRes.data || []) as Record<string, unknown>[],
      ledger.data.transactions
    );

    return {
      success: true,
      data: {
        accounts: balances,
        recentTransactions: ledger.data.transactions.slice(0, 30),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function createExpenseAction(
  input: CreateExpenseInput
): Promise<ActionResult<{ expenseId: string; transactionId?: string }>> {
  try {
    const { user } = await requirePermissionAction("can_manage_expenses");

    const category = clampString(input.category, 100);
    const amount = Number(input.amount);
    const accountId = input.accountId?.trim() ?? "";
    const notes = clampString(input.notes ?? "", 500);
    const description = clampString(input.description ?? input.notes ?? "", 500);

    if (!category) return { success: false, error: "Xərc kateqoriyası tələb olunur" };
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
    }
    if (!isValidUuid(accountId)) {
      return { success: false, error: "Etibarlı hesab seçin" };
    }

    const client = await createSupabaseServerClient();

    const manual = await client.rpc("create_manual_expense_transaction", {
      p_category: category,
      p_amount: amount,
      p_account_id: accountId,
      p_description: description || null,
      p_notes: notes || null,
      p_created_by: user.id,
    });

    if (!manual.error && manual.data) {
      return {
        success: true,
        data: { expenseId: String(manual.data), transactionId: String(manual.data) },
      };
    }

    const code = `EXP-${Math.floor(1000 + Math.random() * 9000)}`;
    const legacy = await client.rpc("create_expense_atomic", {
      p_code: code,
      p_category: category,
      p_amount: amount,
      p_account_id: accountId,
      p_notes: description || notes || null,
    });

    if (legacy.error) {
      return { success: false, error: mapRpcError(legacy.error.message) };
    }

    const txId = String(legacy.data);
    await client
      .from("transactions")
      .update({
        unified_type: "EXPENSE",
        reference_type: "manual_expense",
        description: description || notes || category,
        transaction_date: new Date().toISOString(),
      } as never)
      .eq("id", txId);

    return { success: true, data: { expenseId: txId, transactionId: txId } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Xərc qeydə alınmadı" };
  }
}

export async function createAccountAction(
  input: CreateAccountInput
): Promise<ActionResult<{ accountId: string }>> {
  try {
    await requirePermissionAction("can_manage_finance");

    const name = clampString(input.name, 200);
    const type = clampString(input.type, 50);
    const code =
      clampString(input.code ?? "", 50) || `ACC-${Math.floor(100 + Math.random() * 900)}`;
    const balance = Number(input.balance ?? 0);

    if (!name) return { success: false, error: "Hesab adı tələb olunur" };
    if (!ACCOUNT_TYPES.has(type)) {
      return { success: false, error: "Hesab növü Kassa və ya Bank olmalıdır" };
    }
    if (!Number.isFinite(balance) || balance < 0) {
      return { success: false, error: "Balans mənfi ola bilməz" };
    }

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("create_account_atomic", {
      p_code: code,
      p_name: name,
      p_type: type,
      p_opening_balance: balance,
    });

    if (error || !data) {
      return { success: false, error: error?.message || "Hesab yaradılmadı" };
    }

    return { success: true, data: { accountId: data as string } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Hesab yaradılmadı" };
  }
}

export async function updateAccountAction(input: UpdateAccountInput): Promise<ActionResult> {
  try {
    await requirePermissionAction("can_manage_finance");

    const accountId = input.accountId?.trim() ?? "";
    const name = clampString(input.name, 200);
    const type = clampString(input.type, 50);
    const code = clampString(input.code ?? "", 50);

    if (!isValidUuid(accountId)) return { success: false, error: "Etibarlı hesab seçin" };
    if (!name) return { success: false, error: "Hesab adı tələb olunur" };
    if (!ACCOUNT_TYPES.has(type)) {
      return { success: false, error: "Hesab növü Kassa və ya Bank olmalıdır" };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client
      .from("accounts")
      .update({ name, type, ...(code ? { code } : {}) })
      .eq("id", accountId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Hesab yenilənmədi" };
  }
}

export async function deleteAccountAction(accountId: string): Promise<ActionResult> {
  try {
    await requirePermissionAction("can_manage_finance");
    if (!isValidUuid(accountId)) return { success: false, error: "Etibarlı hesab seçin" };

    const client = await createSupabaseServerClient();
    const { data: account, error: fetchError } = await client
      .from("accounts")
      .select("id, balance, name")
      .eq("id", accountId)
      .single();

    if (fetchError || !account) {
      return { success: false, error: fetchError?.message || "Hesab tapılmadı" };
    }

    const { count } = await client
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId);

    if ((count ?? 0) > 0) {
      return { success: false, error: "Tranzaksiya olan hesab silinə bilməz" };
    }

    if (Number(account.balance) > 0.001) {
      return { success: false, error: "Balansı olan hesab silinə bilməz" };
    }

    const { error } = await client.from("accounts").delete().eq("id", accountId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Hesab silinmədi" };
  }
}

const LINKED_TRANSACTION_SOURCES = new Set([
  "sale",
  "purchase",
  "production",
  "production_expense",
]);

export async function deleteTransactionAction(transactionId: string): Promise<ActionResult> {
  try {
    await requirePermissionAction("can_manage_finance");
    if (!isValidUuid(transactionId)) {
      return { success: false, error: "Etibarlı tranzaksiya seçin" };
    }

    const client = await createSupabaseServerClient();
    const { data: tx, error: fetchError } = await client
      .from("transactions")
      .select("id, account_id, source_type, source_id, reference_type")
      .eq("id", transactionId)
      .single();

    if (fetchError || !tx) {
      return { success: false, error: fetchError?.message || "Tranzaksiya tapılmadı" };
    }

    const sourceType = String(tx.reference_type || tx.source_type || "").trim();
    if (sourceType && LINKED_TRANSACTION_SOURCES.has(sourceType)) {
      return {
        success: false,
        error:
          "Sənədə bağlı tranzaksiya silinə bilməz. Əvvəlcə əsas sənədi silin və ya ləğv edin.",
      };
    }

    const { error: deleteError } = await client.from("transactions").delete().eq("id", transactionId);
    if (deleteError) return { success: false, error: deleteError.message };

    if (tx.account_id) {
      const { error: reconcileError } = await client.rpc("reconcile_account_balance_atomic", {
        p_account_id: tx.account_id,
      });
      if (reconcileError) return { success: false, error: reconcileError.message };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Tranzaksiya silinmədi" };
  }
}
