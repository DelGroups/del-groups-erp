"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { buildProductInsert } from "@/lib/products/api";
import {
  buildProductImportExtraInfo,
  type ProductImportRow,
  type InitialSetupAccountInput,
} from "@/lib/initial-setup/types";
import { clampString, isValidUuid } from "@/lib/auth/validate";

export type SetupActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export interface AccountSetupRow {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: number;
}

export async function fetchSetupAccountsAction(): Promise<
  SetupActionResult<AccountSetupRow[]>
> {
  try {
    await requirePermissionAction("can_manage_settings");
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from("accounts")
      .select("id, code, name, type, balance")
      .order("created_at", { ascending: true });

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: (data || []).map((row) => ({
        id: row.id as string,
        code: (row.code as string) || "",
        name: (row.name as string) || "",
        type: (row.type as string) || "",
        balance: Number(row.balance) || 0,
      })),
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function saveInitialBalancesAction(
  balances: { accountId: string; balance: number }[]
): Promise<SetupActionResult<{ updated: number }>> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    let updated = 0;

    for (const item of balances) {
      if (!isValidUuid(item.accountId)) {
        return { success: false, error: "Invalid account id" };
      }
      const balance = Number(item.balance);
      if (!Number.isFinite(balance) || balance < 0) {
        return { success: false, error: "Balance must be zero or positive" };
      }

      const { error } = await admin
        .from("accounts")
        .update({ balance })
        .eq("id", item.accountId);

      if (error) return { success: false, error: error.message };
      updated += 1;
    }

    return { success: true, data: { updated } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function createInitialAccountAction(
  input: InitialSetupAccountInput
): Promise<SetupActionResult<{ accountId: string }>> {
  try {
    await requirePermissionAction("can_manage_settings");

    const name = clampString(input.name, 200);
    const type = input.type;
    const balance = Number(input.balance ?? 0);
    const code =
      clampString(input.code ?? "", 50) ||
      `ACC-${Math.floor(100 + Math.random() * 900)}`;

    if (!name) return { success: false, error: "Account name required" };
    if (type !== "Kassa" && type !== "Bank") {
      return { success: false, error: "Invalid account type" };
    }
    if (!Number.isFinite(balance) || balance < 0) {
      return { success: false, error: "Balance must be zero or positive" };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("accounts")
      .insert([{ code, name, type, balance }])
      .select("id")
      .single();

    if (error || !data) {
      return { success: false, error: error?.message || "Account not created" };
    }

    return { success: true, data: { accountId: data.id as string } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function importProductsAction(
  rows: ProductImportRow[]
): Promise<
  SetupActionResult<{ inserted: number; skipped: number; errors: string[] }>
> {
  try {
    await requirePermissionAction("can_manage_settings");

    if (!rows.length) {
      return { success: false, error: "No products to import" };
    }

    const admin = createSupabaseAdminClient();
    const errors: string[] = [];
    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const payload = buildProductInsert({
        code: row.sku || undefined,
        name: row.name,
        category: row.category,
        subcategory: row.subcategory || null,
        unit: row.unit || "Ədəd",
        buy_price: row.buyPrice,
        sell_price: row.retailPrice || row.wholesalePrice || 0,
        stock: row.initialStock,
        min_stock: row.minStock,
        barcode: row.barcode || null,
        extra_info: buildProductImportExtraInfo(row),
      });

      const { error } = await admin.from("products").insert([payload]);
      if (error) {
        if (error.message.includes("duplicate") || error.code === "23505") {
          skipped += 1;
          errors.push(`${row.name}: duplicate SKU`);
        } else {
          errors.push(`${row.name}: ${error.message}`);
        }
      } else {
        inserted += 1;
      }
    }

    return { success: true, data: { inserted, skipped, errors } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
