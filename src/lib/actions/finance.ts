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
