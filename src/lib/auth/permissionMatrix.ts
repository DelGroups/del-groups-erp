import {
  ADMIN_ROLE_NAME,
  allPermissionKeys,
  createPermissionMap,
  hasPermission,
  isAdminRole,
  normalizePermissions,
  normalizeRoleScopes,
  type PermissionKey,
  type PermissionMap,
  type RecordAccessScope,
  type Role,
  type RoleScopes,
  type UserProfile,
} from "@/types/database.types";
import { buildPermissionMatrix, MODULES } from "@/modules/registry";

export type { RecordAccessScope, RoleScopes };

export type PermissionMatrix = Record<string, Record<string, boolean>>;

export type GranularPermissionDef = {
  key: string;
  label: string;
  /** i18n key of the label; `label` is the fallback. */
  labelKey?: string;
  legacyKey?: PermissionKey;
};

export type GranularPermissionModule = {
  id: string;
  title: string;
  permissions: GranularPermissionDef[];
  hasWarehouseScope?: boolean;
  hasAccountScope?: boolean;
};

export const DEFAULT_ROLE_SCOPES: RoleScopes = {
  allowed_warehouses: [],
  allowed_financial_accounts: [],
  record_access: "ALL_RECORDS",
};

/** Role permission matrix, generated from the module manifests (src/modules). */
export const GRANULAR_PERMISSION_MODULES: GranularPermissionModule[] = buildPermissionMatrix(MODULES);

const LEGACY_ALIAS: Partial<Record<PermissionKey, PermissionKey>> = {
  can_view_production: "can_view_products",
  can_manage_production: "can_manage_products",
  can_view_consignments: "can_view_sales",
  can_manage_consignments: "can_create_invoice",
  can_view_crm: "can_view_customers",
  can_manage_crm: "can_manage_customers",
};

const PATH_TO_LEGACY: Record<string, PermissionKey> = {};
for (const module of GRANULAR_PERMISSION_MODULES) {
  for (const perm of module.permissions) {
    if (perm.legacyKey) {
      PATH_TO_LEGACY[`${module.id}.${perm.key}`] = perm.legacyKey;
    }
  }
}

export function createEmptyMatrix(): PermissionMatrix {
  const matrix: PermissionMatrix = {};
  for (const module of GRANULAR_PERMISSION_MODULES) {
    matrix[module.id] = {};
    for (const perm of module.permissions) {
      matrix[module.id][perm.key] = false;
    }
  }
  return matrix;
}

export function matrixFromLegacyPermissions(flat: PermissionMap): PermissionMatrix {
  const matrix = createEmptyMatrix();
  for (const module of GRANULAR_PERMISSION_MODULES) {
    for (const perm of module.permissions) {
      if (!perm.legacyKey) continue;
      matrix[module.id][perm.key] = flat[perm.legacyKey] === true;
    }
  }
  return matrix;
}

export function legacyFromMatrix(matrix: PermissionMatrix): PermissionMap {
  const flat = createPermissionMap(false);
  for (const module of GRANULAR_PERMISSION_MODULES) {
    const modulePerms = matrix[module.id] || {};
    for (const perm of module.permissions) {
      if (!perm.legacyKey) continue;
      if (modulePerms[perm.key]) flat[perm.legacyKey] = true;
    }
  }
  return flat;
}

export function parseStoredPermissions(raw: unknown): { flat: PermissionMap; matrix: PermissionMatrix } {
  const source = (raw ?? {}) as Record<string, unknown>;
  const storedMatrix = source._matrix as PermissionMatrix | undefined;
  const flat = normalizePermissions(raw);
  if (storedMatrix && typeof storedMatrix === "object") {
    const matrix = createEmptyMatrix();
    for (const module of GRANULAR_PERMISSION_MODULES) {
      const modulePerms = storedMatrix[module.id];
      if (!modulePerms) continue;
      for (const perm of module.permissions) {
        matrix[module.id][perm.key] = modulePerms[perm.key] === true;
      }
    }
    return { flat, matrix };
  }
  return { flat, matrix: matrixFromLegacyPermissions(flat) };
}

export function permissionsToDbPayload(matrix: PermissionMatrix): Record<string, unknown> {
  const flat = legacyFromMatrix(matrix);
  return { ...flat, _matrix: matrix, _v: 2 };
}

export function mergeScopes(base: RoleScopes, overrides?: Partial<RoleScopes> | null): RoleScopes {
  if (!overrides) return base;
  return {
    allowed_warehouses:
      overrides.allowed_warehouses !== undefined
        ? overrides.allowed_warehouses
        : base.allowed_warehouses,
    allowed_financial_accounts:
      overrides.allowed_financial_accounts !== undefined
        ? overrides.allowed_financial_accounts
        : base.allowed_financial_accounts,
    record_access: overrides.record_access ?? base.record_access,
  };
}

export function parsePermissionOverrides(raw: unknown): PermissionMatrix {
  const source = (raw ?? {}) as Record<string, unknown>;
  const storedMatrix = source._matrix as PermissionMatrix | undefined;
  if (!storedMatrix || typeof storedMatrix !== "object") return {};
  return storedMatrix;
}

export function permissionOverridesToDb(matrix: PermissionMatrix): Record<string, unknown> {
  return { _matrix: matrix, _v: 2 };
}

export type EffectiveAccess = {
  flat: PermissionMap;
  matrix: PermissionMatrix;
  scopes: RoleScopes;
  isAdmin: boolean;
};

export function resolveEffectiveAccess(
  profile: UserProfile | null | undefined,
  isAdmin = isAdminRole(profile?.role)
): EffectiveAccess {
  const roleParsed = parseStoredPermissions(profile?.role?.permissions);
  const roleScopes = normalizeRoleScopes(profile?.role?.scopes);
  const overrides = parsePermissionOverrides(profile?.permission_overrides);
  const scopeOverrides = normalizeRoleScopes(profile?.scope_overrides);

  const matrix = { ...roleParsed.matrix };
  for (const [moduleId, modulePerms] of Object.entries(overrides)) {
    matrix[moduleId] = { ...(matrix[moduleId] || {}), ...modulePerms };
  }

  const flat = legacyFromMatrix(matrix);
  for (const key of allPermissionKeys()) {
    if (roleParsed.flat[key]) flat[key] = true;
    if (overrides && Object.values(overrides).some((m) => Object.values(m || {}).some(Boolean))) {
      // overrides already reflected in matrix → flat
    }
  }

  return {
    flat,
    matrix,
    scopes: mergeScopes(roleScopes, scopeOverrides),
    isAdmin,
  };
}

export function resolvePermissionPath(
  access: EffectiveAccess,
  path: string
): boolean {
  if (access.isAdmin) return true;
  const legacy = PATH_TO_LEGACY[path];
  if (legacy && hasPermission(access.flat, legacy)) return true;
  if (legacy && LEGACY_ALIAS[legacy]) {
    const alias = LEGACY_ALIAS[legacy];
    if (alias && hasPermission(access.flat, alias)) return true;
  }

  const [moduleId, action] = path.split(".");
  if (!moduleId || !action) return false;
  return access.matrix[moduleId]?.[action] === true;
}

export function userHasGranularPermission(
  profile: UserProfile | null | undefined,
  path: string
): boolean {
  const access = resolveEffectiveAccess(profile);
  return resolvePermissionPath(access, path);
}

/** Matrix path of the home page's money figures (prompt 24b). */
export const VIEW_FINANCIALS_PATH = "dashboard.view_financials";

/**
 * May this user see money amounts and sales/purchase counts on the home page (launcher tiles,
 * old dashboard, financial widgets)? Admins always; anyone else only when their role or their
 * own overrides grant dashboard.view_financials. The database checks the same rule
 * (public.can_view_financials()).
 */
export function canViewFinancials(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  return userHasGranularPermission(profile, VIEW_FINANCIALS_PATH);
}

export function userHasLegacyPermission(
  profile: UserProfile | null | undefined,
  permission: PermissionKey
): boolean {
  if (isAdminRole(profile?.role)) return true;
  const access = resolveEffectiveAccess(profile);
  if (hasPermission(access.flat, permission)) return true;
  const alias = LEGACY_ALIAS[permission];
  return alias ? hasPermission(access.flat, alias) : false;
}

export function filterWarehousesByScope<T extends { id: string }>(
  warehouses: T[],
  scopes: RoleScopes
): T[] {
  if (!scopes.allowed_warehouses.length) return warehouses;
  const allowed = new Set(scopes.allowed_warehouses);
  return warehouses.filter((row) => allowed.has(row.id));
}

export function filterAccountsByScope<T extends { id: string }>(
  accounts: T[],
  scopes: RoleScopes
): T[] {
  if (!scopes.allowed_financial_accounts.length) return accounts;
  const allowed = new Set(scopes.allowed_financial_accounts);
  return accounts.filter((row) => allowed.has(row.id));
}

export function countGrantedInMatrix(matrix: PermissionMatrix): number {
  let count = 0;
  for (const module of GRANULAR_PERMISSION_MODULES) {
    for (const perm of module.permissions) {
      if (matrix[module.id]?.[perm.key]) count += 1;
    }
  }
  return count;
}

export function isSystemAdminRole(role: Role | null | undefined): boolean {
  return role?.name === ADMIN_ROLE_NAME;
}
