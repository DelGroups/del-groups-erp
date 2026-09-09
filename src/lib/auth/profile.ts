import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeRole,
  normalizeRoleScopes,
  type Database,
  type Role,
  type UserProfile,
} from "@/types/database.types";
import { parseStoredPermissions } from "@/lib/auth/permissionMatrix";
import { resolveLocale } from "@/i18n/types";
import { displayRoleName, parseJoinedRole } from "@/lib/auth/routePermissions";

export const PROFILE_SELECT = "*, roles(name, permissions, scopes)";

export type ProfileQueryRow = Record<string, unknown> & {
  roles?:
    | { name?: string | null; permissions?: unknown; scopes?: unknown }
    | { name?: string | null; permissions?: unknown; scopes?: unknown }[]
    | null;
  permission_overrides?: unknown;
  scope_overrides?: unknown;
};

export function toUserProfile(row: ProfileQueryRow): UserProfile {
  const joined = parseJoinedRole(row.roles);
  const parsed = parseStoredPermissions(joined.permissions);
  return {
    id: row.id as string,
    email: (row.email as string) ?? null,
    full_name: (row.full_name as string) ?? null,
    role_id: (row.role_id as string) ?? null,
    employee_id: (row.employee_id as string) ?? null,
    is_active: row.is_active !== false,
    locale: resolveLocale(typeof row.locale === "string" ? row.locale : null),
    created_at: (row.created_at as string) ?? null,
    updated_at: (row.updated_at as string) ?? null,
    permission_overrides: (row.permission_overrides as Record<string, unknown>) ?? null,
    scope_overrides: normalizeRoleScopes(row.scope_overrides),
    role: {
      id: (row.role_id as string) ?? "",
      name: joined.name,
      description: null,
      permissions: parsed.flat,
      scopes: joined.scopes,
      is_system: joined.isAdmin,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
    },
  };
}

export async function fetchUserProfile(
  client: SupabaseClient<Database>,
  userId: string
): Promise<UserProfile | null> {
  const { data } = await client
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .single();

  return data ? toUserProfile(data as ProfileQueryRow) : null;
}

export async function fetchAllProfiles(
  client: SupabaseClient<Database>
): Promise<UserProfile[]> {
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_SELECT)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data as ProfileQueryRow[]) || []).map(toUserProfile);
}

export async function fetchRoles(client: SupabaseClient<Database>): Promise<Role[]> {
  const { data, error } = await client
    .from("roles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[]) || []).map(normalizeRole);
}

export { displayRoleName, parseJoinedRole };
