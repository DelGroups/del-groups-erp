"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { rowsToCsv } from "@/lib/csv/csvUtils";
import {
  BACKUP_DELETE_ORDER,
  BACKUP_TABLES,
  BACKUP_VERSION,
  buildBackupFilename,
  type BackupTableName,
  type SystemBackupPayload,
} from "@/lib/backup/manifest";

export type BackupActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

async function fetchTableRows(table: BackupTableName): Promise<Record<string, unknown>[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(table).select("*");
  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }
  return (data as Record<string, unknown>[]) || [];
}

export async function createFullBackupAction(): Promise<
  BackupActionResult<{ filename: string; payload: SystemBackupPayload }>
> {
  try {
    await requirePermissionAction("can_manage_settings");

    const tables: SystemBackupPayload["tables"] = {};
    const errors: string[] = [];

    for (const table of BACKUP_TABLES) {
      try {
        tables[table] = await fetchTableRows(table);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        tables[table] = [];
      }
    }

    const payload: SystemBackupPayload = {
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      app: "del-groups-erp",
      tables,
    };

    if (errors.length > 0) {
      console.warn("[backup] partial table errors:", errors);
    }

    return {
      success: true,
      data: { filename: buildBackupFilename(), payload },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Backup failed" };
  }
}

export async function restoreFullBackupAction(
  payload: SystemBackupPayload
): Promise<BackupActionResult<{ restoredTables: number; warnings: string[] }>> {
  try {
    await requirePermissionAction("can_manage_settings");

    if (!payload || payload.app !== "del-groups-erp") {
      return { success: false, error: "Invalid backup file" };
    }
    if (!payload.tables || typeof payload.tables !== "object") {
      return { success: false, error: "Backup tables missing" };
    }

    const admin = createSupabaseAdminClient();
    const warnings: string[] = [];

    for (const table of BACKUP_DELETE_ORDER) {
      const { error } = await admin.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) {
        warnings.push(`Delete ${table}: ${error.message}`);
      }
    }

    let restoredTables = 0;
    for (const table of BACKUP_TABLES) {
      const rows = payload.tables[table];
      if (!rows?.length) continue;

      const { error } = await admin.from(table).insert(rows as never);
      if (error) {
        warnings.push(`Insert ${table}: ${error.message}`);
      } else {
        restoredTables += 1;
      }
    }

    return { success: true, data: { restoredTables, warnings } };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Restore failed" };
  }
}

export async function exportCustomersCsvAction(): Promise<
  BackupActionResult<{ filename: string; content: string }>
> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("customers")
      .select("code, full_name, name, phone, company_name, address, voen, balance")
      .order("created_at", { ascending: true });

    if (error) return { success: false, error: error.message };

    const headers = [
      "Kod",
      "Tam Ad",
      "Ad",
      "Telefon",
      "Şirkət",
      "Ünvan",
      "VÖEN",
      "Balans (AZN)",
    ];
    const rows = (data || []).map((row) => [
      row.code,
      row.full_name,
      row.name,
      row.phone,
      row.company_name,
      row.address,
      row.voen,
      row.balance,
    ]);

    return {
      success: true,
      data: {
        filename: "Musteri_Siyahisi.csv",
        content: rowsToCsv(headers, rows),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

export async function exportProductsCsvAction(): Promise<
  BackupActionResult<{ filename: string; content: string }>
> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("products")
      .select("code, name, category, buy_price, sell_price, stock, min_stock, unit")
      .order("created_at", { ascending: true });

    if (error) return { success: false, error: error.message };

    const headers = [
      "SKU",
      "Məhsul Adı",
      "Kateqoriya",
      "Alış (AZN)",
      "Satış (AZN)",
      "Stok",
      "Min Stok",
      "Vahid",
    ];
    const rows = (data || []).map((row) => [
      row.code,
      row.name,
      row.category,
      row.buy_price,
      row.sell_price,
      row.stock,
      row.min_stock,
      row.unit,
    ]);

    return {
      success: true,
      data: {
        filename: "Mahsullar_ve_Stok.csv",
        content: rowsToCsv(headers, rows),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

export async function exportInvoicesCsvAction(): Promise<
  BackupActionResult<{ filename: string; content: string }>
> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();

    const [{ data: sales, error: salesError }, { data: purchases, error: purchasesError }] =
      await Promise.all([
        admin
          .from("sales")
          .select("doc_no, doc_date, customer_name, total_amount, paid_amount, remaining_balance")
          .order("created_at", { ascending: false }),
        admin
          .from("purchases")
          .select("invoice_number, doc_date, total_amount, paid_amount, debt_amount, status")
          .order("created_at", { ascending: false }),
      ]);

    if (salesError) return { success: false, error: salesError.message };
    if (purchasesError) return { success: false, error: purchasesError.message };

    const headers = [
      "Növ",
      "Sənəd №",
      "Tarix",
      "Tərəf",
      "Yekun (AZN)",
      "Ödənilən (AZN)",
      "Qalıq/Borc (AZN)",
      "Status",
    ];

    const salesRows = (sales || []).map((row) => [
      "Satış",
      row.doc_no,
      row.doc_date,
      row.customer_name,
      row.total_amount,
      row.paid_amount,
      row.remaining_balance,
      Number(row.remaining_balance) > 0 ? "Borc var" : "Ödənilib",
    ]);

    const purchaseRows = (purchases || []).map((row) => [
      "Alış",
      row.invoice_number,
      row.doc_date,
      "-",
      row.total_amount,
      row.paid_amount,
      row.debt_amount,
      row.status || "-",
    ]);

    return {
      success: true,
      data: {
        filename: "Satisi_ve_Alis_Fakturalari.csv",
        content: rowsToCsv(headers, [...salesRows, ...purchaseRows]),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}

export async function exportExpensesPayrollCsvAction(): Promise<
  BackupActionResult<{ filename: string; content: string }>
> {
  try {
    await requirePermissionAction("can_manage_settings");
    const admin = createSupabaseAdminClient();

    const [{ data: expenses, error: expError }, { data: payroll, error: payError }] =
      await Promise.all([
        admin
          .from("expenses")
          .select("code, category, amount, notes, created_at")
          .order("created_at", { ascending: false }),
        admin
          .from("salary_payments")
          .select("month_year, net_amount, base_salary, commission_total, deductions, status, notes, created_at")
          .order("created_at", { ascending: false }),
      ]);

    if (expError) return { success: false, error: expError.message };
    if (payError) return { success: false, error: payError.message };

    const headers = [
      "Növ",
      "Kod/Dövr",
      "Kateqoriya",
      "Məbləğ (AZN)",
      "Əlavə",
      "Status",
      "Tarix",
      "Qeyd",
    ];

    const expenseRows = (expenses || []).map((row) => [
      "Xərc",
      row.code,
      row.category,
      row.amount,
      "-",
      "-",
      row.created_at,
      row.notes,
    ]);

    const payrollRows = (payroll || []).map((row) => [
      "Əmək haqqı",
      row.month_year,
      `Əsas: ${row.base_salary} / Kom: ${row.commission_total}`,
      row.net_amount,
      `Tutulma: ${row.deductions}`,
      row.status,
      row.created_at,
      row.notes,
    ]);

    return {
      success: true,
      data: {
        filename: "Xercler_ve_Emekhaqqi.csv",
        content: rowsToCsv(headers, [...expenseRows, ...payrollRows]),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Export failed" };
  }
}
