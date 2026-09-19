"use server";

import {
  ActionAuthError,
  requirePermissionAction,
} from "@/lib/auth/serverActionAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  slugifyDepartmentCode,
  type EmployeeDepartmentRow,
} from "@/lib/hr/employeeDepartments";

export type DepartmentActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

function normalizeCode(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  if (/^[a-z0-9_]+$/.test(trimmed)) return trimmed;
  return slugifyDepartmentCode(trimmed);
}

export async function createEmployeeDepartmentAction(input: {
  name: string;
  code?: string;
  sort_order?: number;
}): Promise<DepartmentActionResult<EmployeeDepartmentRow>> {
  try {
    await requirePermissionAction("can_manage_hr");
    const name = input.name.trim();
    if (!name) return { success: false, error: "Şöbə adı boş ola bilməz" };

    const code = normalizeCode(input.code || slugifyDepartmentCode(name));
    if (!code) return { success: false, error: "Şöbə kodu düzgün deyil" };

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("employee_departments")
      .insert([
        {
          code,
          name,
          sort_order: Number(input.sort_order) || 0,
          is_active: true,
        },
      ])
      .select("id, code, name, sort_order, is_active")
      .single();

    if (error) {
      if (error.message.includes("employee_departments_code_unique")) {
        return { success: false, error: "Bu şöbə kodu artıq mövcuddur" };
      }
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        id: data.id as string,
        code: data.code as string,
        name: data.name as string,
        sort_order: Number(data.sort_order) || 0,
        is_active: Boolean(data.is_active),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Şöbə yaradılmadı" };
  }
}

export async function updateEmployeeDepartmentAction(
  id: string,
  input: { name?: string; code?: string; sort_order?: number; is_active?: boolean }
): Promise<DepartmentActionResult<EmployeeDepartmentRow>> {
  try {
    await requirePermissionAction("can_manage_hr");
    const admin = createSupabaseAdminClient();

    const { data: existing, error: loadError } = await admin
      .from("employee_departments")
      .select("id, code, name, sort_order, is_active")
      .eq("id", id)
      .maybeSingle();

    if (loadError) return { success: false, error: loadError.message };
    if (!existing) return { success: false, error: "Şöbə tapılmadı" };

    const oldCode = existing.code as string;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (input.name != null) {
      const name = input.name.trim();
      if (!name) return { success: false, error: "Şöbə adı boş ola bilməz" };
      patch.name = name;
    }
    if (input.sort_order != null) patch.sort_order = Number(input.sort_order) || 0;
    if (input.is_active != null) patch.is_active = Boolean(input.is_active);

    let newCode: string | null = null;
    if (input.code != null) {
      newCode = normalizeCode(input.code);
      if (!newCode) return { success: false, error: "Şöbə kodu düzgün deyil" };
      patch.code = newCode;
    }

    const { data, error } = await admin
      .from("employee_departments")
      .update(patch)
      .eq("id", id)
      .select("id, code, name, sort_order, is_active")
      .single();

    if (error) {
      if (error.message.includes("employee_departments_code_unique")) {
        return { success: false, error: "Bu şöbə kodu artıq mövcuddur" };
      }
      return { success: false, error: error.message };
    }

    if (newCode && newCode !== oldCode) {
      const { error: empError } = await admin
        .from("employees")
        .update({ department: newCode })
        .eq("department", oldCode);
      if (empError) return { success: false, error: empError.message };
    }

    return {
      success: true,
      data: {
        id: data.id as string,
        code: data.code as string,
        name: data.name as string,
        sort_order: Number(data.sort_order) || 0,
        is_active: Boolean(data.is_active),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Şöbə yenilənmədi" };
  }
}

export async function deleteEmployeeDepartmentAction(
  id: string
): Promise<DepartmentActionResult> {
  try {
    await requirePermissionAction("can_manage_hr");
    const admin = createSupabaseAdminClient();

    const { data: row, error: loadError } = await admin
      .from("employee_departments")
      .select("code")
      .eq("id", id)
      .maybeSingle();

    if (loadError) return { success: false, error: loadError.message };
    if (!row?.code) return { success: false, error: "Şöbə tapılmadı" };

    const code = row.code as string;
    const { count, error: countError } = await admin
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("department", code);

    if (countError) return { success: false, error: countError.message };
    if ((count ?? 0) > 0) {
      return {
        success: false,
        error: "Bu şöbədə işçi var — əvvəlcə işçiləri başqa şöbəyə köçürün",
      };
    }

    const { error } = await admin.from("employee_departments").delete().eq("id", id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Şöbə silinmədi" };
  }
}
