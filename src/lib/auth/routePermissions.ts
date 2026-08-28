import {
  ADMIN_ROLE_NAME,
  hasPermission,
  isAdminRole,
  type PermissionKey,
  type PermissionMap,
  type UserProfile,
  normalizePermissions,
} from "@/types/database.types";

/** Longest-prefix-first route rules for page access. */
const ROUTE_RULES: { prefix: string; permission: PermissionKey; exact?: boolean }[] = [
  { prefix: "/settings/backup", permission: "can_manage_settings" },
  { prefix: "/settings/initial-setup", permission: "can_manage_settings" },
  { prefix: "/settings/roles", permission: "can_manage_roles" },
  { prefix: "/settings/commissions", permission: "can_manage_commissions" },
  { prefix: "/users", permission: "can_manage_users" },
  { prefix: "/settings", permission: "can_view_settings" },
  { prefix: "/reports/financial", permission: "can_view_financial_reports" },
  { prefix: "/reports/sales", permission: "can_view_reports" },
  { prefix: "/reports", permission: "can_view_reports" },
  { prefix: "/sales/polywood/new", permission: "can_create_invoice" },
  { prefix: "/sales/new", permission: "can_create_invoice" },
  { prefix: "/sales", permission: "can_view_sales" },
  { prefix: "/purchases", permission: "can_view_purchases" },
  { prefix: "/consignments", permission: "can_view_consignments" },
  { prefix: "/polywood", permission: "can_view_products" },
  { prefix: "/production", permission: "can_view_production" },
  { prefix: "/inventory-audit", permission: "can_writeoff_inventory" },
  { prefix: "/products/damaged-goods", permission: "can_writeoff_inventory" },
  { prefix: "/dashboard/warehouse/slips", permission: "can_view_warehouse_slips" },
  { prefix: "/products/new", permission: "can_manage_products" },
  { prefix: "/products", permission: "can_view_products" },
  { prefix: "/warehouses", permission: "can_manage_warehouses" },
  { prefix: "/customers", permission: "can_view_customers" },
  { prefix: "/suppliers", permission: "can_view_suppliers" },
  { prefix: "/cash-bank", permission: "can_view_finance" },
  { prefix: "/finance", permission: "can_view_finance" },
  { prefix: "/expenses", permission: "can_view_expenses" },
  { prefix: "/employees", permission: "can_view_hr" },
  { prefix: "/commissions", permission: "can_view_commissions" },
  { prefix: "/comissions/report", permission: "can_view_commissions" },
  { prefix: "/comissions", permission: "can_view_commissions" },
  { prefix: "/", permission: "can_view_dashboard", exact: true },
];

/** Sidebar / nav path → minimum view permission. */
export const NAV_PATH_PERMISSIONS: Record<string, PermissionKey> = {
  "/": "can_view_dashboard",
  "/sales": "can_view_sales",
  "/sales/polywood/new": "can_create_invoice",
  "/purchases": "can_view_purchases",
  "/consignments": "can_view_consignments",
  "/products": "can_view_products",
  "/polywood": "can_view_products",
  "/production": "can_view_production",
  "/production/bom": "can_view_production",
  "/inventory-audit": "can_writeoff_inventory",
  "/products/damaged-goods": "can_writeoff_inventory",
  "/dashboard/warehouse/slips": "can_view_warehouse_slips",
  "/warehouses": "can_manage_warehouses",
  "/customers": "can_view_customers",
  "/suppliers": "can_view_suppliers",
  "/cash-bank": "can_view_finance",
  "/expenses": "can_view_expenses",
  "/finance": "can_view_finance",
  "/employees": "can_view_hr",
  "/commissions": "can_view_commissions",
  "/comissions": "can_view_commissions",
  "/reports": "can_view_reports",
  "/settings": "can_view_settings",
  "/settings/roles": "can_manage_roles",
  "/users": "can_manage_users",
  "/settings/commissions": "can_manage_commissions",
  "/settings/initial-setup": "can_manage_settings",
  "/settings/backup": "can_manage_settings",
};

export function getRequiredPermission(pathname: string): PermissionKey | null {
  for (const rule of ROUTE_RULES) {
    if (rule.exact) {
      if (pathname === rule.prefix) return rule.permission;
      continue;
    }
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return rule.permission;
    }
  }
  return null;
}

export function getNavItemPermission(path: string): PermissionKey | null {
  return NAV_PATH_PERMISSIONS[path] ?? null;
}

export function userHasPermission(
  profile: UserProfile | null | undefined,
  permission: PermissionKey,
  permissions?: PermissionMap | null
): boolean {
  if (isAdminRole(profile?.role)) return true;
  const map = permissions ?? profile?.role?.permissions;
  if (hasPermission(map, permission)) return true;

  // Roles saved before these modules existed have no JSON keys for them.
  if (permission === "can_view_production") {
    return hasPermission(map, "can_view_products");
  }
  if (permission === "can_manage_production") {
    return hasPermission(map, "can_manage_products");
  }
  if (permission === "can_view_consignments") {
    return hasPermission(map, "can_view_sales");
  }
  if (permission === "can_manage_consignments") {
    return hasPermission(map, "can_create_invoice");
  }

  return false;
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
  isAdmin: boolean;
} {
  const row = Array.isArray(roles) ? roles[0] : roles;
  const source = row as { name?: string | null; permissions?: unknown } | null | undefined;
  const name = source?.name?.trim() || "";
  return {
    name,
    permissions: normalizePermissions(source?.permissions),
    isAdmin: name === ADMIN_ROLE_NAME,
  };
}
