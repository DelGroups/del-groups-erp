"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
  type ActionAuthContext,
} from "@/lib/auth/serverActionAuth";
import { userHasLegacyPermission } from "@/lib/auth/permissionMatrix";
import { getServerAuthContext } from "@/lib/supabaseServer";
import { clampString, isValidUuid } from "@/lib/auth/validate";
import {
  computeAccountLedgerBalances,
  mapUnifiedLedgerRow,
  summarizeUnifiedLedger,
  type AccountLedgerBalance,
  type FinancialCategoryOption,
  type UnifiedLedgerSummary,
  type UnifiedLedgerTransaction,
  type UnifiedTransactionType,
} from "@/lib/finance/unifiedLedger";
import {
  buildFinancialCategoryTree,
  fetchFinancialCategoryRows,
  flattenExpenseCategoryOptions,
  type FinancialCategoryTreeNode,
} from "@/lib/finance/financialCategories";
import { fetchTransactionsRaw } from "@/lib/finance/transactionQueries";
import type { ActionResult } from "@/lib/supabase/actionResult";

export type { ActionResult };

export interface UpdateTransactionInput {
  transactionId: string;
  amount: number;
  category: string;
  description?: string;
  accountId?: string | null;
  notes?: string;
}

const ACCOUNT_TYPES = new Set(["Kassa", "Bank"]);

async function requireFinanceOrExpenseManageAction(): Promise<ActionAuthContext> {
  const { user, profile } = await getServerAuthContext();
  if (!user) throw new ActionAuthError("Giriş tələb olunur");
  if (profile?.is_active === false) {
    throw new ActionAuthError("Hesabınız deaktiv edilib. Administratorla əlaqə saxlayın.");
  }
  if (
    userHasLegacyPermission(profile, "can_manage_finance") ||
    userHasLegacyPermission(profile, "can_manage_expenses")
  ) {
    return { user, profile };
  }
  throw new ActionAuthError("İcazəniz yoxdur");
}

async function reconcileAccounts(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  accountIds: Array<string | null | undefined>
): Promise<ActionResult> {
  const unique = Array.from(
    new Set(accountIds.filter((id): id is string => Boolean(id && isValidUuid(id))))
  );
  for (const accountId of unique) {
    const { error } = await client.rpc("reconcile_account_balance_atomic", {
      p_account_id: accountId,
    });
    if (error) return { success: false, error: error.message };
  }
  return { success: true };
}

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

export async function fetchFinancialCategoriesAction(): Promise<
  ActionResult<FinancialCategoryOption[]>
> {
  try {
    await requirePermissionAction("can_view_finance");
    const admin = createSupabaseAdminClient();
    const { rows, error } = await fetchFinancialCategoryRows(admin, { includeInactive: false });
    if (error) return { success: false, error };

    if (rows.length) {
      const flat = flattenExpenseCategoryOptions(rows);
      return {
        success: true,
        data: flat.map((row) => ({
          id: row.id,
          name: row.name,
          type: "EXPENSE" as const,
          parent_id: row.parent_id,
          parent_name: row.parent_name,
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

export async function fetchFinancialCategoryTreeAction(): Promise<
  ActionResult<FinancialCategoryTreeNode[]>
> {
  try {
    await requirePermissionAction("can_view_finance");
    const admin = createSupabaseAdminClient();
    const { rows, error } = await fetchFinancialCategoryRows(admin, { includeInactive: true });
    if (error) return { success: false, error };
    const expenseRows = rows.filter((row) => row.type === "EXPENSE");
    return { success: true, data: buildFinancialCategoryTree(expenseRows) };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function createFinancialCategoryAction(input: {
  name: string;
  parentId?: string | null;
  type?: UnifiedTransactionType;
}): Promise<ActionResult<{ categoryId: string }>> {
  try {
    await requireFinanceOrExpenseManageAction();

    const name = clampString(input.name, 200);
    const parentId = input.parentId?.trim() || null;
    const type = input.type || "EXPENSE";

    if (!name) return { success: false, error: "Kateqoriya adı tələb olunur" };
    if (parentId && !isValidUuid(parentId)) {
      return { success: false, error: "Etibarlı əsas kateqoriya seçin" };
    }

    const admin = createSupabaseAdminClient();
    const payload: Record<string, unknown> = {
      name,
      type,
      is_active: true,
      parent_id: parentId,
    };

    let insert = await admin.from("financial_categories").insert([payload]).select("id").single();
    if (insert.error && /column|parent_id|schema cache/i.test(insert.error.message || "")) {
      delete payload.parent_id;
      insert = await admin.from("financial_categories").insert([payload]).select("id").single();
    }

    if (insert.error || !insert.data) {
      return { success: false, error: insert.error?.message || "Kateqoriya yaradılmadı" };
    }

    return { success: true, data: { categoryId: String(insert.data.id) } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Kateqoriya yaradılmadı" };
  }
}

export async function updateFinancialCategoryAction(input: {
  categoryId: string;
  name: string;
  parentId?: string | null;
  isActive?: boolean;
}): Promise<ActionResult> {
  try {
    await requireFinanceOrExpenseManageAction();

    const categoryId = input.categoryId?.trim() ?? "";
    const name = clampString(input.name, 200);
    const parentId = input.parentId?.trim() || null;

    if (!isValidUuid(categoryId)) return { success: false, error: "Etibarlı kateqoriya seçin" };
    if (!name) return { success: false, error: "Kateqoriya adı tələb olunur" };
    if (parentId === categoryId) {
      return { success: false, error: "Kateqoriya özünün alt kateqoriyası ola bilməz" };
    }

    const admin = createSupabaseAdminClient();
    const patch: Record<string, unknown> = {
      name,
      parent_id: parentId,
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    };

    let update = await admin.from("financial_categories").update(patch).eq("id", categoryId);
    if (update.error && /column|parent_id|schema cache/i.test(update.error.message || "")) {
      delete patch.parent_id;
      update = await admin.from("financial_categories").update(patch).eq("id", categoryId);
    }

    if (update.error) return { success: false, error: update.error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Kateqoriya yenilənmədi" };
  }
}

export async function deleteFinancialCategoryAction(
  categoryId: string
): Promise<ActionResult<{ softDeleted: boolean }>> {
  try {
    await requireFinanceOrExpenseManageAction();
    if (!isValidUuid(categoryId)) return { success: false, error: "Etibarlı kateqoriya seçin" };

    const admin = createSupabaseAdminClient();
    const { data: category, error: fetchError } = await admin
      .from("financial_categories")
      .select("id,name")
      .eq("id", categoryId)
      .single();

    if (fetchError || !category) {
      return { success: false, error: fetchError?.message || "Kateqoriya tapılmadı" };
    }

    const childrenQuery = await admin
      .from("financial_categories")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", categoryId)
      .eq("is_active", true);

    if ((childrenQuery.count ?? 0) > 0) {
      return {
        success: false,
        error: "Alt kateqoriyaları olan kateqoriya silinə bilməz. Əvvəlcə alt kateqoriyaları silin və ya deaktiv edin.",
      };
    }

    const txById = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId);

    const txByName = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("category", category.name);

    const hasTransactions = (txById.count ?? 0) > 0 || (txByName.count ?? 0) > 0;

    if (hasTransactions) {
      const { error } = await admin
        .from("financial_categories")
        .update({ is_active: false })
        .eq("id", categoryId);
      if (error) return { success: false, error: error.message };
      return { success: true, data: { softDeleted: true } };
    }

    const { error: deleteError } = await admin.from("financial_categories").delete().eq("id", categoryId);
    if (deleteError) return { success: false, error: deleteError.message };
    return { success: true, data: { softDeleted: false } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Kateqoriya silinmədi" };
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

    const transactions = rows
      .map((row) => mapUnifiedLedgerRow(row))
      .filter((tx) => Boolean(tx.id));
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

    if (accountsRes.error) {
      return { success: false, error: accountsRes.error.message };
    }

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

export async function updateTransactionAction(
  input: UpdateTransactionInput
): Promise<ActionResult> {
  try {
    await requireFinanceOrExpenseManageAction();

    const transactionId = input.transactionId?.trim() ?? "";
    const category = clampString(input.category, 100);
    const amount = Number(input.amount);
    const description = clampString(input.description ?? "", 500);
    const notes = clampString(input.notes ?? input.description ?? "", 500);
    const accountId = input.accountId?.trim() || null;

    if (!isValidUuid(transactionId)) {
      return { success: false, error: "Etibarlı tranzaksiya seçin" };
    }
    if (!category) return { success: false, error: "Kateqoriya tələb olunur" };
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
    }
    if (accountId && !isValidUuid(accountId)) {
      return { success: false, error: "Etibarlı hesab seçin" };
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
        error: "Sənədə bağlı tranzaksiya redaktə edilə bilməz",
      };
    }

    const oldAccountId = (tx.account_id as string) || null;
    const patch: Record<string, unknown> = {
      amount,
      category,
      notes,
      description,
      account_id: accountId,
    };

    const { error: updateError } = await client
      .from("transactions")
      .update(patch as never)
      .eq("id", transactionId);

    if (updateError) return { success: false, error: updateError.message };

    const reconciled = await reconcileAccounts(client, [oldAccountId, accountId]);
    if (!reconciled.success) return reconciled;

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Tranzaksiya yenilənmədi" };
  }
}

export async function deleteTransactionAction(transactionId: string): Promise<ActionResult> {
  try {
    await requireFinanceOrExpenseManageAction();
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

    const reconciled = await reconcileAccounts(client, [tx.account_id]);
    if (!reconciled.success) return reconciled;

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Tranzaksiya silinmədi" };
  }
}
