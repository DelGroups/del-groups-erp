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
  "/inventory-audit": "nav.items.inventoryAudit",
  "/warehouse/incoming": "nav.items.warehouseIncoming",
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
  "/employees": "nav.items.employees",
  "/commissions": "nav.items.commissions",
  "/comissions": "nav.items.commissions",
  "/reports": "nav.items.reports",
  "/reports/sales": "breadcrumb.salesReports",
  "/reports/financial": "nav.items.glFinancialReports",
  "/dashboard/reports/financial": "nav.items.glFinancialReports",
  "/dashboard/reports/osv": "nav.items.trialBalance",
  "/dashboard/reports/reconciliation": "nav.items.reconciliationAct",
  "/dashboard/reports/inventory-turnover": "nav.items.inventoryTurnover",
  "/settings": "nav.items.settings",
  "/settings/roles": "nav.items.roles",
  "/settings/commissions": "nav.items.commissionRules",
  "/settings/initial-setup": "nav.items.initialSetup",
  "/settings/backup": "nav.items.backup",
  "/settings/barcode": "nav.items.barcode",
  "/settings/crm": "nav.items.crmSettings",
  "/settings/tax-payroll": "nav.items.taxPayroll",
  "/settings/procurement": "nav.items.procurement",
  "/settings/ai": "nav.items.aiIntegration",
  "/settings/audit": "nav.items.audit",
  "/users": "nav.items.users",
  "/dashboard/inventory/polywood/import": "breadcrumb.polywoodImport",
};

/** Single URL segment → i18n key when no full-path match exists. */
const SEGMENT_I18N: Record<string, string> = {
  sales: "nav.items.sales",
  purchases: "nav.items.purchases",
  products: "nav.items.products",
  warehouse: "nav.sections.inventory",
  dashboard: "nav.sections.dashboard",
  settings: "nav.items.settings",
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
  incoming: "nav.items.warehouseIncoming",
  "initial-balance": "nav.items.initialBalances",
  consignments: "nav.items.consignments",
  contracts: "nav.items.contracts",
  commissions: "nav.items.commissions",
  comissions: "nav.items.commissions",
  crm: "nav.items.pipeline",
  users: "nav.items.users",
  expenses: "nav.items.expenses",
  warehouses: "nav.items.warehouses",
};

const AUTH_PATH_PREFIXES = ["/login", "/forgot-password", "/auth/", "/update-password"];

function isAuthPath(pathname: string): boolean {
  return AUTH_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function isDynamicSegment(segment: string): boolean {
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

export function shouldShowGlobalBreadcrumbs(pathname: string): boolean {
  if (!pathname || pathname === "/") return false;
  return !isAuthPath(pathname);
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

    let label: string;
    if (PATH_I18N[acc]) {
      label = t(PATH_I18N[acc]);
    } else if (isDynamicSegment(segment)) {
      label = formatDynamicLabel(segment, acc.slice(0, acc.lastIndexOf("/")), t);
    } else if (SEGMENT_I18N[segment]) {
      label = t(SEGMENT_I18N[segment]);
    } else {
      label = humanizeSegment(segment);
    }

    crumbs.push({
      label,
      href: isLast ? undefined : acc,
    });
  }

  return crumbs;
}
