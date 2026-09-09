"use server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  permissionOverridesToDb,
  permissionsToDbPayload,
  type PermissionMatrix,
} from "@/lib/auth/permissionMatrix";
import { ActionAuthError, requirePermissionAction } from "@/lib/auth/serverActionAuth";
import type { ActionResult } from "@/lib/supabase/actionResult";
import type { RoleScopes } from "@/types/database.types";

export async function fetchRbacLookupsAction(): Promise<
  ActionResult<{
    warehouses: Array<{ id: string; name: string }>;
    accounts: Array<{ id: string; name: string }>;
    users: Array<{ id: string; full_name: string | null; email: string | null; role_name: string | null }>;
  }>
> {
  try {
    await requirePermissionAction("can_manage_roles");
    const admin = createSupabaseAdminClient();
    const [warehousesRes, accountsRes, profilesRes] = await Promise.all([
      admin.from("warehouses").select("id,name").order("name").limit(200),
      admin.from("accounts").select("id,name").order("name").limit(200),
      admin.from("profiles").select("id,full_name,email,roles(name)").order("full_name").limit(500),
    ]);

    if (warehousesRes.error) return { success: false, error: warehousesRes.error.message };
    if (accountsRes.error) return { success: false, error: accountsRes.error.message };
    if (profilesRes.error) return { success: false, error: profilesRes.error.message };

    return {
      success: true,
      data: {
        warehouses: (warehousesRes.data || []).map((row) => ({
          id: String(row.id),
          name: String(row.name || ""),
        })),
        accounts: (accountsRes.data || []).map((row) => ({
          id: String(row.id),
          name: String(row.name || ""),
        })),
        users: (profilesRes.data || []).map((row) => {
          const roles = row.roles as { name?: string } | { name?: string }[] | null;
          const roleName = Array.isArray(roles) ? roles[0]?.name : roles?.name;
          return {
            id: String(row.id),
            full_name: (row.full_name as string) || null,
            email: (row.email as string) || null,
            role_name: roleName || null,
          };
        }),
      },
    };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function updateUserPermissionOverridesAction(input: {
  userId: string;
  permissionOverrides: PermissionMatrix;
  scopeOverrides: RoleScopes;
}): Promise<ActionResult> {
  try {
    await requirePermissionAction("can_manage_roles");
    const patch = {
      permission_overrides: permissionOverridesToDb(input.permissionOverrides),
      scope_overrides: input.scopeOverrides,
      updated_at: new Date().toISOString(),
    };
    const userClient = await createSupabaseServerClient();
    const userUpdate = await userClient
      .from("profiles")
      .update(patch as never)
      .eq("id", input.userId)
      .select("id")
      .maybeSingle();

    let error = userUpdate.error;
    if (error || !userUpdate.data) {
      const admin = createSupabaseAdminClient();
      const adminResult = await admin
        .from("profiles")
        .update(patch as never)
        .eq("id", input.userId)
        .select("id")
        .maybeSingle();
      error = adminResult.error;
      if (!error && !adminResult.data) {
        return { success: false, error: "İstifadəçi tapılmadı" };
      }
    }

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    if (err instanceof ActionAuthError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function buildRolePermissionsPayload(
  matrix: PermissionMatrix,
  scopes: RoleScopes
): Promise<{ permissions: Record<string, unknown>; scopes: RoleScopes }> {
  return {
    permissions: permissionsToDbPayload(matrix),
    scopes,
  };
}
