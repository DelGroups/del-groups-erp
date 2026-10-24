import type { PermissionKey } from "@/types/database.types";

/**
 * Module manifests (docs/SaaS-Commercialization-Plan.md §5.1). A manifest is
 * plain data: it says what a module owns (permissions, menu items, routes,
 * AI tools, settings) and what it needs (depends). Navigation, route
 * permissions and the role permission matrix are generated from all
 * manifests in src/modules/registry.ts.
 */

export const MODULE_IDS = [
  "core",
  "sales",
  "purchases",
  "inventory",
  "polywood",
  "production",
  "accounting",
  "expenses",
  "hr",
  "payroll",
  "crm",
  "contracts",
  "consignment",
  "commissions",
  "tax-az",
  "barcode",
  "ai",
  "studio",
  "documents",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** Sidebar sections; defined in src/modules/shell.ts. */
export type NavSectionId =
  | "dashboard"
  | "trade"
  | "inventory"
  | "production"
  | "crm"
  | "finance"
  | "hr"
  | "reports"
  | "settings";

/** Groups of the role permission matrix (ids are stored in roles.permissions._matrix). */
export type PermissionGroupId =
  | "dashboard"
  | "sales"
  | "purchases"
  | "consignments"
  | "inventory"
  | "production"
  | "crm"
  | "finance"
  | "hr"
  | "reports"
  | "administration";

/** Compile-time feature switches a menu item can depend on. */
export type FeatureFlag = "barcodeModule";

export interface ModuleMenuItem {
  path: string;
  /** i18n key */
  label: string;
  /** lucide-react icon name, resolved in src/lib/navigation/navConfig.ts */
  icon: string;
  section: NavSectionId;
  /** Position inside the section (ascending). */
  order: number;
  keywords?: string[];
  /** Shown only when this feature flag is on. */
  flag?: FeatureFlag;
}

/** Page access rule: `prefix` and everything below it (or only `prefix` when exact). */
export interface ModuleRoute {
  prefix: string;
  permission: PermissionKey;
  exact?: boolean;
}

/** One checkbox of the role permission matrix. */
export interface ModuleMatrixPermission {
  group: PermissionGroupId;
  /** Key inside the group, e.g. "view" → "sales.view". */
  key: string;
  label: string;
  /** Flat permission it grants. */
  legacyKey: PermissionKey;
  /** Position inside the group (ascending). */
  order: number;
}

export interface ModuleSetting {
  /** system_settings.key */
  key: string;
  type: "json";
}

export interface ModuleManifest {
  id: ModuleId;
  /** English name for admin screens. */
  name: string;
  version: string;
  depends: ModuleId[];
  /**
   * Modules whose permissions this module may use without depending on them.
   * Allowed only for a module that itself depends on this one (it can never be
   * on while this module is off), e.g. contracts uses can_view_sales.
   */
  borrowsPermissionsFrom?: ModuleId[];
  /** Flat permission keys this module owns (each key has exactly one owner). */
  permissions: PermissionKey[];
  /** Checkboxes this module adds to the role permission matrix. */
  matrix: ModuleMatrixPermission[];
  menus: ModuleMenuItem[];
  routes: ModuleRoute[];
  /** Paths that are linked to (e.g. from a page or the command palette) but have no menu item. */
  links?: string[];
  /** Native AI assistant tools (src/lib/ai/native/tools.ts) that read this module's data. */
  aiTools: string[];
  settings: ModuleSetting[];
}

/** Declares a module manifest; typing only, returns its argument. */
export function defineModule<M extends ModuleManifest>(manifest: M): M {
  return manifest;
}
