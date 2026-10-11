"use server";

/** Payroll runs and salary advances. Moves to src/modules/payroll with the payroll module. */
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { clampString, isValidUuid } from "@/lib/auth/validate";

export async function calculateMonthlyPayrollAction(
  month: number,
  year: number
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    await requirePermissionAction("can_manage_hr");

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { success: false, error: "Düzgün ay seçin" };
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return { success: false, error: "Düzgün il seçin" };
    }

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("calculate_monthly_payroll_drafts", {
      p_month: month,
      p_year: year,
    });

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    return { success: true, count: Number(data) || 0 };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Bordro hesablanmadı",
    };
  }
}

export async function payPayrollRunAction(
  payrollId: string,
  accountId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { user } = await requirePermissionAction("can_manage_hr");

    if (!isValidUuid(payrollId)) {
      return { success: false, error: "Etibarlı bordro seçin" };
    }
    if (!isValidUuid(accountId)) {
      return { success: false, error: "Ödəniş hesabı seçin" };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client.rpc("pay_payroll_run_atomic", {
      p_payroll_id: payrollId,
      p_account_id: accountId,
      p_created_by: user.id,
    });

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Maaş ödənilə bilmədi",
    };
  }
}

export async function payEmployeeAdvanceAction(payload: {
  employeeId: string;
  amount: number;
  accountId: string;
  description?: string;
  requestDate?: string;
}): Promise<{ success: boolean; advanceId?: string; error?: string }> {
  try {
    const { user } = await requirePermissionAction("can_manage_hr");

    const employeeId = payload.employeeId?.trim() ?? "";
    const accountId = payload.accountId?.trim() ?? "";
    const amount = Number(payload.amount);
    const description = clampString(payload.description ?? "", 500);

    if (!isValidUuid(employeeId)) {
      return { success: false, error: "Etibarlı işçi seçin" };
    }
    if (!isValidUuid(accountId)) {
      return { success: false, error: "Ödəniş hesabı seçin" };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "Məbləğ düzgün deyil" };
    }

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("pay_employee_advance_atomic", {
      p_employee_id: employeeId,
      p_amount: amount,
      p_account_id: accountId,
      p_description: description || null,
      p_request_date: payload.requestDate || null,
      p_created_by: user.id,
    });

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    return { success: true, advanceId: data as string };
  } catch (err) {
    if (err instanceof ActionAuthError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Avans ödənilə bilmədi",
    };
  }
}
