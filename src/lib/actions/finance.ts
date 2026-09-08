"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { clampString, isValidUuid } from "@/lib/auth/validate";

const EXPENSE_CATEGORIES = new Set([
  "İcarə",
  "Elektrik",
  "Yanacaq",
  "İnternet",
  "Reklam",
  "Təmir",
  "Maaş",
  "Digər",
]);

const ACCOUNT_TYPES = new Set(["Kassa", "Bank"]);

export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export interface CreateExpenseInput {
  category: string;
  amount: number;
  accountId: string;
  notes?: string;
}

export async function createExpenseAction(
  input: CreateExpenseInput
): Promise<ActionResult<{ expenseId: string }>> {
  try {
    await requirePermissionAction("can_manage_expenses");

    const category = clampString(input.category, 100);
    const amount = Number(input.amount);
    const accountId = input.accountId?.trim() ?? "";
    const notes = clampString(input.notes ?? "", 500);

    if (!EXPENSE_CATEGORIES.has(category)) {
      return { success: false, error: "Etibarsız xərc kateqoriyası" };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Məbləğ sıfırdan böyük olmalıdır" };
    }
    if (!isValidUuid(accountId)) {
      return { success: false, error: "Etibarlı hesab seçin" };
    }

    const code = `EXP-${Math.floor(1000 + Math.random() * 9000)}`;
    const client = await createSupabaseServerClient();

    const { data, error } = await client.rpc("create_expense_atomic", {
      p_code: code,
      p_category: category,
      p_amount: amount,
      p_account_id: accountId,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    return { success: true, data: { expenseId: data as string } };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Xərc qeydə alınmadı",
    };
  }
}

export interface CreateAccountInput {
  code?: string;
  name: string;
  type: string;
  balance?: number;
}

export async function createAccountAction(
  input: CreateAccountInput
): Promise<ActionResult<{ accountId: string }>> {
  try {
    await requirePermissionAction("can_manage_finance");

    const name = clampString(input.name, 200);
    const type = clampString(input.type, 50);
    const code =
      clampString(input.code ?? "", 50) ||
      `ACC-${Math.floor(100 + Math.random() * 900)}`;
    const balance = Number(input.balance ?? 0);

    if (!name) {
      return { success: false, error: "Hesab adı tələb olunur" };
    }
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
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Hesab yaradılmadı",
    };
  }
}

export interface UpdateAccountInput {
  accountId: string;
  code?: string;
  name: string;
  type: string;
}

export async function updateAccountAction(
  input: UpdateAccountInput
): Promise<ActionResult> {
  try {
    await requirePermissionAction("can_manage_finance");

    const accountId = input.accountId?.trim() ?? "";
    const name = clampString(input.name, 200);
    const type = clampString(input.type, 50);
    const code = clampString(input.code ?? "", 50);

    if (!isValidUuid(accountId)) {
      return { success: false, error: "Etibarlı hesab seçin" };
    }
    if (!name) {
      return { success: false, error: "Hesab adı tələb olunur" };
    }
    if (!ACCOUNT_TYPES.has(type)) {
      return { success: false, error: "Hesab növü Kassa və ya Bank olmalıdır" };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client
      .from("accounts")
      .update({
        name,
        type,
        ...(code ? { code } : {}),
      })
      .eq("id", accountId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Hesab yenilənmədi",
    };
  }
}

export async function deleteAccountAction(accountId: string): Promise<ActionResult> {
  try {
    await requirePermissionAction("can_manage_finance");

    if (!isValidUuid(accountId)) {
      return { success: false, error: "Etibarlı hesab seçin" };
    }

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
      return {
        success: false,
        error: "Tranzaksiya olan hesab silinə bilməz",
      };
    }

    if (Number(account.balance) > 0.001) {
      return { success: false, error: "Balansı olan hesab silinə bilməz" };
    }

    const { error } = await client.from("accounts").delete().eq("id", accountId);
    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Hesab silinmədi",
    };
  }
}

const LINKED_TRANSACTION_SOURCES = new Set(["sale", "purchase", "production"]);

export async function deleteTransactionAction(transactionId: string): Promise<ActionResult> {
  try {
    await requirePermissionAction("can_manage_finance");

    if (!isValidUuid(transactionId)) {
      return { success: false, error: "Etibarlı tranzaksiya seçin" };
    }

    const client = await createSupabaseServerClient();

    const { data: tx, error: fetchError } = await client
      .from("transactions")
      .select("id, account_id, source_type, source_id")
      .eq("id", transactionId)
      .single();

    if (fetchError || !tx) {
      return { success: false, error: fetchError?.message || "Tranzaksiya tapılmadı" };
    }

    const sourceType = (tx.source_type || "").trim();
    if (sourceType && LINKED_TRANSACTION_SOURCES.has(sourceType)) {
      return {
        success: false,
        error: "Sənədə bağlı tranzaksiya silinə bilməz. Əvvəlcə əsas sənədi silin və ya ləğv edin.",
      };
    }

    const { error: deleteError } = await client
      .from("transactions")
      .delete()
      .eq("id", transactionId);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    if (tx.account_id) {
      const { error: reconcileError } = await client.rpc("reconcile_account_balance_atomic", {
        p_account_id: tx.account_id,
      });
      if (reconcileError) {
        return { success: false, error: reconcileError.message };
      }
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Tranzaksiya silinmədi",
    };
  }
}
