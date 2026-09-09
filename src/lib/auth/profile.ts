import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeRole,
  normalizeRoleScopes,
  type Database,
  type Role,
  type RoleScopes,
  type UserProfile,
} from "@/types/database.types";
import { DEFAULT_ROLE_SCOPES } from "@/lib/auth/permissionMatrix";
import { resolveLocale } from "@/i18n/types";
import { displayRoleName, parseJoinedRole } from "@/lib/auth/routePermissions";
import { isSchemaColumnError } from "@/lib/supabase/schemaFallback";

/** Preferred profile+role embed; falls back automatically when new columns are missing. */
export const PROFILE_SELECT = "*, roles(name, permissions, scopes)";

const PROFILE_SELECT_ATTEMPTS = [
  "*, roles(name, permissions, scopes)",
  "*, roles(name, permissions)",
  "id, email, full_name, role_id, employee_id, is_active, locale, created_at, updated_at, permission_overrides, scope_overrides, roles(name, permissions, scopes)",
  "id, email, full_name, role_id, employee_id, is_active, locale, created_at, updated_at, roles(name, permissions, scopes)",
  "id, email, full_name, role_id, employee_id, is_active, locale, created_at, updated_at, roles(name, permissions)",
  "id, email, full_name, role_id, employee_id, is_active, locale, created_at, updated_at",
  "*",
] as const;

const ROLE_SELECT_ATTEMPTS = [
  "name, permissions, scopes",
  "name, permissions",
  "name, permissions, is_system",
  "*",
] as const;

export type ProfileQueryRow = Record<string, unknown> & {
  roles?:
    | { name?: string | null; permissions?: unknown; scopes?: unknown }
    | { name?: string | null; permissions?: unknown; scopes?: unknown }[]
    | null;
  permission_overrides?: unknown;
  scope_overrides?: unknown;
};

function emptyScopes(): RoleScopes {
  return { ...DEFAULT_ROLE_SCOPES };
}

export function toUserProfile(row: ProfileQueryRow): UserProfile {
  const joined = parseJoinedRole(row.roles);
  const scopeOverrides = row.scope_overrides
    ? normalizeRoleScopes(row.scope_overrides)
    : emptyScopes();

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
    permission_overrides: (row.permission_overrides as Record<string, unknown>) ?? {},
    scope_overrides: scopeOverrides,
    role: {
      id: (row.role_id as string) ?? "",
      name: joined.name,
      description: null,
      permissions: joined.permissions,
      scopes: joined.scopes || emptyScopes(),
      is_system: joined.isAdmin,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
    },
  };
}

async function fetchRoleForProfile(
  client: SupabaseClient<Database>,
  roleId: string
): Promise<ProfileQueryRow["roles"]> {
  for (const fields of ROLE_SELECT_ATTEMPTS) {
    const { data, error } = await client.from("roles").select(fields).eq("id", roleId).maybeSingle();
    if (!error && data) return data as ProfileQueryRow["roles"];
    if (!isSchemaColumnError(error?.message)) break;
  }
  return null;
}

async function hydrateProfileRole(
  client: SupabaseClient<Database>,
  row: ProfileQueryRow
): Promise<ProfileQueryRow> {
  if (row.roles) return row;
  const roleId = (row.role_id as string) || "";
  if (!roleId) return row;
  const role = await fetchRoleForProfile(client, roleId);
  return role ? { ...row, roles: role } : row;
}

export async function fetchProfileQueryRow(
  client: SupabaseClient<Database>,
  userId: string
): Promise<{ row: ProfileQueryRow | null; error: string | null }> {
  let lastError: string | null = null;

  for (const fields of PROFILE_SELECT_ATTEMPTS) {
    const { data, error } = await client.from("profiles").select(fields).eq("id", userId).maybeSingle();

    if (!error && data) {
      const hydrated = await hydrateProfileRole(client, data as ProfileQueryRow);
      return { row: hydrated, error: null };
    }

    lastError = error?.message || "Profile not found";
    if (!isSchemaColumnError(error?.message) && error?.code !== "PGRST116") {
      return { row: null, error: lastError };
    }
  }

  return { row: null, error: lastError || "Profile not found" };
}

export async function fetchUserProfile(
  client: SupabaseClient<Database>,
  userId: string
): Promise<UserProfile | null> {
  const { row } = await fetchProfileQueryRow(client, userId);
  return row ? toUserProfile(row) : null;
}

export async function fetchAllProfiles(
  client: SupabaseClient<Database>
): Promise<UserProfile[]> {
  let lastError: string | null = null;

  for (const fields of PROFILE_SELECT_ATTEMPTS) {
    const { data, error } = await client.from("profiles").select(fields).order("created_at", {
      ascending: true,
    });

    if (!error && data) {
      const rows: ProfileQueryRow[] = [];
      for (const row of data as ProfileQueryRow[]) {
        rows.push(await hydrateProfileRole(client, row));
      }
      return rows.map(toUserProfile);
    }

    lastError = error?.message || "Failed to load profiles";
    if (!isSchemaColumnError(error?.message)) break;
  }

  throw new Error(lastError || "Failed to load profiles");
}

export async function fetchRoles(client: SupabaseClient<Database>): Promise<Role[]> {
  const attempts = ["*", "id, name, description, permissions, scopes, is_system, created_at"];

  for (const fields of attempts) {
    const { data, error } = await client.from("roles").select(fields).order("created_at", {
      ascending: true,
    });
    if (!error && data) {
      return (data as Record<string, unknown>[]).map(normalizeRole);
    }
    if (!isSchemaColumnError(error?.message)) {
      throw new Error(error?.message || "Failed to load roles");
    }
  }

  throw new Error("Failed to load roles");
}

export { displayRoleName, parseJoinedRole };
