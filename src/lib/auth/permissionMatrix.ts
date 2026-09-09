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

export type { RecordAccessScope, RoleScopes };

export type PermissionMatrix = Record<string, Record<string, boolean>>;

export type GranularPermissionDef = {
  key: string;
  label: string;
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

export const GRANULAR_PERMISSION_MODULES: GranularPermissionModule[] = [
  {
    id: "dashboard",
    title: "Əsas Panel",
    permissions: [{ key: "view", label: "Ana səhifəni görmək", legacyKey: "can_view_dashboard" }],
  },
  {
    id: "sales",
    title: "Satış",
    permissions: [
      { key: "view", label: "Satışları görmək", legacyKey: "can_view_sales" },
      { key: "create", label: "Satış fakturası yaratmaq", legacyKey: "can_create_invoice" },
      { key: "edit", label: "Satışları redaktə etmək", legacyKey: "can_edit_sales" },
      { key: "delete", label: "Satışları silmək", legacyKey: "can_delete_sales" },
    ],
  },
  {
    id: "purchases",
    title: "Alış",
    permissions: [
      { key: "view", label: "Alışları görmək", legacyKey: "can_view_purchases" },
      { key: "create", label: "Alış fakturası yaratmaq", legacyKey: "can_create_purchase" },
      { key: "edit", label: "Alışları redaktə etmək", legacyKey: "can_edit_purchases" },
      { key: "delete", label: "Alışları silmək", legacyKey: "can_delete_purchases" },
    ],
  },
  {
    id: "consignments",
    title: "Əmanət Satışı",
    permissions: [
      { key: "view", label: "Əmanət sənədlərini görmək", legacyKey: "can_view_consignments" },
      { key: "manage", label: "Əmanət sənədlərini idarə etmək", legacyKey: "can_manage_consignments" },
    ],
  },
  {
    id: "inventory",
    title: "Anbar və Məhsul",
    hasWarehouseScope: true,
    permissions: [
      { key: "view", label: "Məhsulları görmək", legacyKey: "can_view_products" },
      { key: "manage", label: "Məhsulları idarə etmək", legacyKey: "can_manage_products" },
      { key: "add_stock", label: "Stok əlavə etmək", legacyKey: "can_manage_products" },
      { key: "manage_warehouses", label: "Anbarları idarə etmək", legacyKey: "can_manage_warehouses" },
      { key: "manage_transfers", label: "Anbar köçürmələrini idarə etmək", legacyKey: "can_manage_warehouses" },
      { key: "writeoff", label: "Zədələnmə çıxışı", legacyKey: "can_writeoff_inventory" },
      { key: "view_slips", label: "Anbar qaimələrini görmək", legacyKey: "can_view_warehouse_slips" },
      { key: "approve_slips", label: "Anbar qaimələrini təsdiqləmək", legacyKey: "can_approve_warehouse_slips" },
      { key: "send_to_warehouse", label: "Fakturanı anbara göndərmək", legacyKey: "can_send_to_warehouse" },
    ],
  },
  {
    id: "production",
    title: "İstehsalat",
    permissions: [
      { key: "view", label: "İstehsalatı görmək", legacyKey: "can_view_production" },
      { key: "manage", label: "İstehsalatın idarə edilməsi (CRUD)", legacyKey: "can_manage_production" },
      {
        key: "view_financials",
        label: "Maliyyə məlumatlarını görmək (büdcə, mənfəət)",
        legacyKey: "can_view_production_financials",
      },
      {
        key: "approve_purchase",
        label: "Satın alma tələbi təsdiqləmək",
        legacyKey: "can_approve_purchase_requests",
      },
    ],
  },
  {
    id: "crm",
    title: "Əlaqələr (CRM)",
    permissions: [
      { key: "view_customers", label: "Müştəriləri görmək", legacyKey: "can_view_customers" },
      { key: "manage_customers", label: "Müştəriləri idarə etmək", legacyKey: "can_manage_customers" },
      { key: "view_suppliers", label: "Təchizatçıları görmək", legacyKey: "can_view_suppliers" },
      { key: "manage_suppliers", label: "Təchizatçıları idarə etmək", legacyKey: "can_manage_suppliers" },
    ],
  },
  {
    id: "finance",
    title: "Maliyyə",
    hasAccountScope: true,
    permissions: [
      { key: "view", label: "Kassa və tranzaksiyaları görmək", legacyKey: "can_view_finance" },
      { key: "manage", label: "Kassa və tranzaksiyaları idarə etmək", legacyKey: "can_manage_finance" },
      { key: "view_expenses", label: "Xərcləri görmək", legacyKey: "can_view_expenses" },
      { key: "manage_expenses", label: "Xərcləri idarə etmək", legacyKey: "can_manage_expenses" },
      { key: "create_expense", label: "Xərc yaratmaq", legacyKey: "can_manage_expenses" },
      { key: "create_income", label: "Mədaxil yaratmaq", legacyKey: "can_manage_finance" },
      { key: "view_reports", label: "Maliyyə hesabatlarını görmək", legacyKey: "can_view_financial_reports" },
    ],
  },
  {
    id: "hr",
    title: "İnsan Resursları",
    permissions: [
      { key: "view", label: "İşçiləri görmək", legacyKey: "can_view_hr" },
      { key: "manage", label: "İşçilər və maaş idarəetməsi", legacyKey: "can_manage_hr" },
      { key: "view_commissions", label: "Komissiyaları görmək", legacyKey: "can_view_commissions" },
      { key: "manage_commissions", label: "Komissiyaları idarə etmək", legacyKey: "can_manage_commissions" },
    ],
  },
  {
    id: "reports",
    title: "Hesabatlar",
    permissions: [
      { key: "view", label: "Satış hesabatlarını görmək", legacyKey: "can_view_reports" },
      { key: "view_financial", label: "Maliyyə hesabatlarını görmək", legacyKey: "can_view_financial_reports" },
    ],
  },
  {
    id: "administration",
    title: "Administrasiya",
    permissions: [
      { key: "view_settings", label: "Tənzimləmələri görmək", legacyKey: "can_view_settings" },
      { key: "manage_settings", label: "Tənzimləmələri dəyişmək", legacyKey: "can_manage_settings" },
      { key: "manage_users", label: "İstifadəçiləri idarə etmək", legacyKey: "can_manage_users" },
      { key: "manage_roles", label: "Rol və icazələri idarə etmək", legacyKey: "can_manage_roles" },
    ],
  },
];

const LEGACY_ALIAS: Partial<Record<PermissionKey, PermissionKey>> = {
  can_view_production: "can_view_products",
  can_manage_production: "can_manage_products",
  can_view_consignments: "can_view_sales",
  can_manage_consignments: "can_create_invoice",
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
