import { settingsCrumbKeys } from "../settings/items";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** Full path → i18n key for the crumb label at that path. */
const PATH_I18N: Record<string, string> = {
  "/": "nav.items.home",
  "/sales": "nav.items.sales",
  "/sales/new": "invoice.newSaleTitle",
  "/sales/polywood/new": "nav.items.polywood",
  "/purchases": "nav.items.purchases",
  "/purchases/new": "purchases.createLabel",
  "/products": "nav.items.products",
  "/products/new": "products.createLabel",
  "/products/damaged-goods": "nav.items.damagedGoods",
  "/polywood": "nav.items.polywood",
  "/contracts": "nav.items.contracts",
  "/consignments": "nav.items.consignments",
  "/inventory/counts": "nav.items.inventoryAudit",
  "/inventory/lots": "nav.items.lots",
  "/warehouse/initial-balance": "nav.items.initialBalances",
  "/warehouse/initial-balance/new": "breadcrumb.initialBalanceNew",
  "/warehouses": "nav.items.warehouses",
  "/dashboard/warehouse/slips": "nav.items.warehouseSlips",
  "/production": "nav.items.production",
  "/production/bom": "nav.items.productionBom",
  "/crm": "nav.items.pipeline",
  "/customers": "nav.items.customers",
  "/suppliers": "nav.items.suppliers",
  "/dashboard/partners": "nav.items.businessPartners",
  "/cash-bank": "nav.items.cashBank",
  "/dashboard/payments": "nav.items.payments",
  "/expenses": "nav.items.expenses",
  "/finance": "nav.items.finance",
  "/finance/opening-balances": "nav.items.financialOpeningBalances",
  "/employees": "nav.items.employees",
  "/commissions": "nav.items.commissions",
  "/comissions": "nav.items.commissions",
  "/reports": "nav.items.reports",
  "/reports/sales": "breadcrumb.salesReports",
  "/reports/financial": "nav.items.glFinancialReports",
  "/dashboard/reports/financial": "nav.items.glFinancialReports",
  "/dashboard/reports/osv": "nav.items.trialBalance",
  "/dashboard/reports/reconciliation": "nav.items.reconciliationAct",
  "/dashboard/reports/partner-statement": "nav.items.partnerStatement",
  "/dashboard/reports/debtors": "nav.items.debtorReports",
  "/dashboard/reports/inventory-turnover": "nav.items.inventoryTurnover",
  "/dashboard/inventory/polywood/import": "breadcrumb.polywoodImport",
  // Settings pages (SET-1): the names of the one settings list (src/lib/settings/items.ts).
  ...settingsCrumbKeys(),
  // Pages only the new shell lists (lib/shell/shell.ts SHELL_EXTRA_ITEMS): same labels as there.
  "/comissions/report": "newShell.extra_commissionReport",
  "/calendar": "newShell.extra_calendar",
  "/todo": "newShell.extra_todo",
  "/documents": "newShell.extra_documents",
  "/crm/leads": "newShell.extra_crmLeads",
  "/crm/reports": "newShell.extra_crmReports",
  "/crm/config": "newShell.extra_crmConfig",
  "/imports": "newShell.extra_imports",
  "/imports/new": "imports.newShipment",
  "/imports/reports": "newShell.extra_importsReports",
};

/** Single URL segment → i18n key when no full-path match exists. */
const SEGMENT_I18N: Record<string, string> = {
  sales: "nav.items.sales",
  purchases: "nav.items.purchases",
  products: "nav.items.products",
  warehouse: "nav.sections.inventory",
  dashboard: "nav.sections.dashboard",
  settings: "nav.sections.settings",
  production: "nav.items.production",
  reports: "nav.items.reports",
  finance: "nav.items.finance",
  customers: "nav.items.customers",
  suppliers: "nav.items.suppliers",
  employees: "nav.items.employees",
  new: "breadcrumb.new",
  edit: "breadcrumb.edit",
  polywood: "nav.items.polywood",
  partners: "nav.items.businessPartners",
  payments: "nav.items.payments",
  "initial-balance": "nav.items.initialBalances",
  "opening-balances": "nav.items.financialOpeningBalances",
  consignments: "nav.items.consignments",
  dispatch: "consignments.opTypeDispatch",
  settlement: "consignments.opTypeActualSale",
  contracts: "nav.items.contracts",
  commissions: "nav.items.commissions",
  comissions: "nav.items.commissions",
  crm: "nav.items.pipeline",
  users: "settingsNav.users.title",
  expenses: "nav.items.expenses",
  warehouses: "nav.items.warehouses",
};

const AUTH_PATH_PREFIXES = ["/login", "/forgot-password", "/auth/", "/update-password"];

function isAuthPath(pathname: string): boolean {
  return AUTH_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export function isDynamicSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  return segment.length >= 20 && /^[a-z0-9_-]+$/i.test(segment);
}

function formatDynamicLabel(
  segment: string,
  parentPath: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const shortId = segment.length > 12 ? `${segment.slice(0, 8)}…` : segment;
  if (parentPath.startsWith("/sales")) {
    return t("breadcrumb.saleDocument", { id: shortId });
  }
  if (parentPath.startsWith("/purchases")) {
    return t("breadcrumb.purchaseDocument", { id: shortId });
  }
  if (parentPath.startsWith("/production")) {
    return t("breadcrumb.productionOrder", { id: shortId });
  }
  if (parentPath.startsWith("/dashboard/partners")) {
    return t("breadcrumb.partnerDetail", { id: shortId });
  }
  return t("breadcrumb.document", { id: shortId });
}

function humanizeSegment(segment: string): string {
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** A page with a fixed address (a list, a "new" form, a settings page), not one record. */
export function isFixedPath(pathname: string): boolean {
  return !pathname.split("/").filter(Boolean).some(isDynamicSegment);
}

export function shouldShowGlobalBreadcrumbs(pathname: string): boolean {
  if (!pathname || pathname === "/") return false;
  return !isAuthPath(pathname);
}

/**
 * Label of the crumb at `path` (its last segment is `segment`): the route map's name for the full
 * path, a record label for an id, the name of a known segment, or the segment itself.
 */
export function crumbLabel(
  path: string,
  segment: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (PATH_I18N[path]) return t(PATH_I18N[path]);
  if (isDynamicSegment(segment)) return formatDynamicLabel(segment, path.slice(0, path.lastIndexOf("/")), t);
  if (SEGMENT_I18N[segment]) return t(SEGMENT_I18N[segment]);
  return humanizeSegment(segment);
}

export function buildBreadcrumbsFromPath(
  pathname: string,
  t: (key: string, params?: Record<string, string | number>) => string
): BreadcrumbItem[] {
  if (!shouldShowGlobalBreadcrumbs(pathname)) return [];

  const segments = pathname.split("/").filter(Boolean);
  const crumbs: BreadcrumbItem[] = [];
  let acc = "";

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    acc += `/${segment}`;
    const isLast = index === segments.length - 1;

    const label = crumbLabel(acc, segment, t);

    crumbs.push({
      label,
      href: isLast ? undefined : acc,
    });
  }

  return crumbs;
}
