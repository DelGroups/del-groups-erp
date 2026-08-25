"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { clampString, isValidUuid } from "@/lib/auth/validate";
import type { ProcessPayrollPayload, ProcessPayrollResult } from "@/types/database.types";

const MAX_COMMISSION_IDS = 500;

export async function processPayrollAction(
  payload: ProcessPayrollPayload
): Promise<ProcessPayrollResult> {
  try {
    await requirePermissionAction("can_manage_hr");

    const employeeId = payload.employeeId?.trim() ?? "";
    const accountId = payload.accountId?.trim() ?? "";
    const monthYear = clampString(payload.monthYear, 50);
    const notes = clampString(payload.notes ?? "", 500);
    const baseSalary = Number(payload.baseSalary);
    const deductions = Number(payload.deductions);
    const commissionIds = Array.isArray(payload.commissionIds)
      ? payload.commissionIds.filter(Boolean)
      : [];

    if (!isValidUuid(employeeId)) {
      return { success: false, error: "Etibarlı işçi seçin" };
    }
    if (!isValidUuid(accountId)) {
      return { success: false, error: "Ödəniş hesabı seçin" };
    }
    if (!monthYear) {
      return { success: false, error: "Dövr (ay/il) tələb olunur" };
    }
    if (!Number.isFinite(baseSalary) || baseSalary < 0) {
      return { success: false, error: "Əsas maaş düzgün deyil" };
    }
    if (!Number.isFinite(deductions) || deductions < 0) {
      return { success: false, error: "Tutulma məbləği düzgün deyil" };
    }
    if (commissionIds.length > MAX_COMMISSION_IDS) {
      return { success: false, error: "Çox sayda komissiya seçilib" };
    }
    for (const id of commissionIds) {
      if (!isValidUuid(id)) {
        return { success: false, error: "Etibarsız komissiya identifikatoru" };
      }
    }

    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("process_payroll_atomic", {
      p_employee_id: employeeId,
      p_account_id: accountId,
      p_base_salary: baseSalary,
      p_deductions: deductions,
      p_month_year: monthYear,
      p_notes: notes || null,
      p_commission_ids: commissionIds,
    });

    if (error) {
      return { success: false, error: mapRpcError(error.message) };
    }

    return { success: true, payrollId: data as string };
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
