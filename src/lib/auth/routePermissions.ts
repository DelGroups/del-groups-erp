import { userHasLegacyPermission } from "@/lib/auth/permissionMatrix";
import { DEFAULT_ROLE_SCOPES } from "@/lib/auth/permissionMatrix";
import {
  buildNavPathPermissions,
  buildRouteRules,
  MODULES,
  resolveRoutePermission,
  type RouteRule,
} from "@/modules/registry";
import {
  ADMIN_ROLE_NAME,
  isAdminRole,
  normalizeRoleScopes,
  type PermissionKey,
  type PermissionMap,
  type RoleScopes,
  type UserProfile,
} from "@/types/database.types";

/** Page access rules from the module manifests, longest prefix first. */
export const ROUTE_RULES: readonly RouteRule[] = buildRouteRules(MODULES);

/** Sidebar / nav path → minimum view permission. */
export const NAV_PATH_PERMISSIONS: Record<string, PermissionKey> = buildNavPathPermissions(MODULES, ROUTE_RULES);

export function getRequiredPermission(pathname: string): PermissionKey | null {
  return resolveRoutePermission(ROUTE_RULES, pathname);
}

export function getNavItemPermission(path: string): PermissionKey | null {
  return NAV_PATH_PERMISSIONS[path] ?? null;
}

export function userHasPermission(
  profile: UserProfile | null | undefined,
  permission: PermissionKey,
  _permissions?: PermissionMap | null
): boolean {
  return userHasLegacyPermission(profile, permission);
}

export function userCanAccessPath(
  profile: UserProfile | null | undefined,
  pathname: string
): boolean {
  const permission = getRequiredPermission(pathname);
  if (!permission) return true;
  return userHasPermission(profile, permission);
}

export function displayRoleName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed || "İstifadəçi";
}

export function parseJoinedRole(roles: unknown): {
  name: string;
  permissions: PermissionMap;
  scopes: RoleScopes;
  isAdmin: boolean;
} {
  const row = Array.isArray(roles) ? roles[0] : roles;
  const source = row as
    | { name?: string | null; permissions?: unknown; scopes?: unknown }
    | null
    | undefined;
  const name = source?.name?.trim() || "";
  const rawPermissions =
    source?.permissions && typeof source.permissions === "object" && !Array.isArray(source.permissions)
      ? (source.permissions as PermissionMap)
      : {};
  return {
    name,
    permissions: rawPermissions,
    scopes: source?.scopes ? normalizeRoleScopes(source.scopes) : { ...DEFAULT_ROLE_SCOPES },
    isAdmin: name === ADMIN_ROLE_NAME,
  };
}

export { isAdminRole };
