"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  ActionAuthError,
  mapRpcError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { clampString, isValidUuid } from "@/lib/auth/validate";
import type { EmployeeInsert, LeaveStatus, LeaveType } from "@/types/database.types";
import { calcLeaveDays, EMPLOYEE_DEPARTMENTS, toEmployeeDbRow } from "@/types/database.types";

export async function createEmployeeLeaveAction(payload: {
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermissionAction("can_manage_hr");

    const employeeId = payload.employeeId?.trim() ?? "";
    const startDate = payload.startDate?.trim() ?? "";
    const endDate = payload.endDate?.trim() ?? "";
    const daysCount = calcLeaveDays(startDate, endDate);

    if (!isValidUuid(employeeId)) {
      return { success: false, error: "Etibarlı işçi seçin" };
    }
    if (!startDate || !endDate || daysCount <= 0) {
      return { success: false, error: "Tarix aralığı düzgün deyil" };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client.from("employee_leaves").insert([
      {
        employee_id: employeeId,
        leave_type: payload.leaveType,
        start_date: startDate,
        end_date: endDate,
        days_count: daysCount,
        status: "PENDING",
        notes: clampString(payload.notes ?? "", 500) || null,
      },
    ]);

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
      error: err instanceof Error ? err.message : "Məzuniyyət qeydə alınmadı",
    };
  }
}

export async function updateEmployeeLeaveStatusAction(
  leaveId: string,
  status: LeaveStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermissionAction("can_manage_hr");

    if (!isValidUuid(leaveId)) {
      return { success: false, error: "Etibarlı məzuniyyət seçin" };
    }
    if (!["APPROVED", "PENDING", "REJECTED"].includes(status)) {
      return { success: false, error: "Etibarsız status" };
    }

    const client = await createSupabaseServerClient();
    const { error } = await client
      .from("employee_leaves")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", leaveId);

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
      error: err instanceof Error ? err.message : "Status yenilənmədi",
    };
  }
}

async function assertActiveDepartmentCode(code: string): Promise<string | null> {
  const admin = await createSupabaseAdminClient();
  const { count, error } = await admin
    .from("employee_departments")
    .select("id", { count: "exact", head: true })
    .eq("code", code)
    .eq("is_active", true);

  if (error) {
    if (error.message.includes("does not exist")) {
      return EMPLOYEE_DEPARTMENTS.some((d) => d.value === code)
        ? null
        : "Şöbə tapılmadı";
    }
    return error.message;
  }
  if ((count ?? 0) === 0) return "Şöbə tapılmadı və ya deaktivdir";
  return null;
}

export async function createEmployeeAction(
  payload: EmployeeInsert
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermissionAction("can_manage_hr");
    const row = toEmployeeDbRow(payload);
    const deptError = await assertActiveDepartmentCode(row.department);
    if (deptError) return { success: false, error: deptError };

    const admin = await createSupabaseAdminClient();
    const { error } = await admin.from("employees").insert([row]);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "İşçi yaradılmadı" };
  }
}

export async function updateEmployeeAction(
  id: string,
  payload: Partial<EmployeeInsert>
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermissionAction("can_manage_hr");
    if (!isValidUuid(id)) return { success: false, error: "İşçi tapılmadı" };

    const patch: Record<string, unknown> = {};

    if (payload.employee_code != null) {
      const employeeCode = payload.employee_code.trim();
      patch.employee_code = employeeCode;
      patch.code = employeeCode;
    }
    if (payload.full_name != null) patch.full_name = payload.full_name.trim();
    if (payload.role != null) patch.role = payload.role.trim();
    if (payload.department != null) {
      const department = payload.department.trim();
      const deptError = await assertActiveDepartmentCode(department);
      if (deptError) return { success: false, error: deptError };
      patch.department = department;
    }
    if (payload.phone !== undefined) patch.phone = payload.phone?.trim() || null;
    if (payload.base_salary != null) patch.base_salary = Number(payload.base_salary) || 0;
    if (payload.default_commission != null) {
      patch.default_commission = Number(payload.default_commission) || 0;
    }
    if (payload.status != null) patch.status = payload.status.trim();
    if (payload.fin_code !== undefined) patch.fin_code = payload.fin_code?.trim() || null;
    if (payload.iban !== undefined) patch.iban = payload.iban?.trim() || null;
    if (payload.bank_name !== undefined) patch.bank_name = payload.bank_name?.trim() || null;
    if (payload.hire_date !== undefined) patch.hire_date = payload.hire_date || null;
    if (payload.contract_end_date !== undefined) {
      patch.contract_end_date = payload.contract_end_date || null;
    }
    if (payload.emergency_phone !== undefined) {
      patch.emergency_phone = payload.emergency_phone?.trim() || null;
    }
    if (payload.documents_json !== undefined) {
      patch.documents_json = payload.documents_json ?? {};
    }

    const admin = await createSupabaseAdminClient();
    const { error } = await admin.from("employees").update(patch).eq("id", id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "İşçi yenilənmədi" };
  }
}

export async function deleteEmployeeAction(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requirePermissionAction("can_manage_hr");
    if (!isValidUuid(id)) return { success: false, error: "İşçi tapılmadı" };

    const admin = await createSupabaseAdminClient();
    const { error } = await admin.from("employees").delete().eq("id", id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "İşçi silinmədi" };
  }
}
