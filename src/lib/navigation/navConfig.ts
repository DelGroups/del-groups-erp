import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  ShoppingCart,
  ShoppingBag,
  Users,
  Truck,
  FileSpreadsheet,
  Wallet,
  Receipt,
  UserCheck,
  FileText,
  Settings,
  Layers,
  Trash2,
  Percent,
  CircleDollarSign,
  Store,
  Boxes,
  Contact,
  Landmark,
  Briefcase,
  BarChart3,
  Table2,
  FileCheck2,
  SlidersHorizontal,
  ShieldCheck,
  ClipboardList,
  ClipboardCheck,
  Database,
  Barcode,
  ScrollText,
  Factory,
  KanbanSquare,
  Scale,
  Sparkles,
} from "lucide-react";

export interface NavItem {
  titleKey: string;
  path: string;
  icon: LucideIcon;
  keywords?: string[];
}

export interface NavSection {
  id: string;
  titleKey: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "dashboard",
    titleKey: "nav.sections.dashboard",
    icon: LayoutDashboard,
    items: [{ titleKey: "nav.items.home", path: "/", icon: LayoutDashboard }],
  },
  {
    id: "trade",
    titleKey: "nav.sections.trade",
    icon: Store,
    items: [
      { titleKey: "nav.items.sales", path: "/sales", icon: ShoppingCart, keywords: ["invoice", "faktura"] },
      { titleKey: "nav.items.purchases", path: "/purchases", icon: ShoppingBag },
      { titleKey: "nav.items.contracts", path: "/contracts", icon: FileText },
      { titleKey: "nav.items.consignments", path: "/consignments", icon: FileSpreadsheet },
    ],
  },
  {
    id: "inventory",
    titleKey: "nav.sections.inventory",
    icon: Boxes,
    items: [
      { titleKey: "nav.items.products", path: "/products", icon: Package },
      { titleKey: "nav.items.inventoryAudit", path: "/inventory-audit", icon: ClipboardCheck },
      { titleKey: "nav.items.warehouseIncoming", path: "/warehouse/incoming", icon: Package },
      { titleKey: "nav.items.initialBalances", path: "/warehouse/initial-balance", icon: ClipboardList },
      { titleKey: "nav.items.warehouses", path: "/warehouses", icon: Warehouse },
      { titleKey: "nav.items.warehouseSlips", path: "/dashboard/warehouse/slips", icon: ClipboardList },
      { titleKey: "nav.items.damagedGoods", path: "/products/damaged-goods", icon: Trash2 },
    ],
  },
  {
    id: "production",
    titleKey: "nav.sections.production",
    icon: Factory,
    items: [
      { titleKey: "nav.items.production", path: "/production", icon: Factory },
      { titleKey: "nav.items.productionBom", path: "/production/bom", icon: Layers },
    ],
  },
  {
    id: "crm",
    titleKey: "nav.sections.crm",
    icon: Contact,
    items: [
      { titleKey: "nav.items.pipeline", path: "/crm", icon: KanbanSquare },
      { titleKey: "nav.items.customers", path: "/customers", icon: Users, keywords: ["customer", "müştəri"] },
      { titleKey: "nav.items.suppliers", path: "/suppliers", icon: Truck, keywords: ["supplier", "təchizatçı"] },
      { titleKey: "nav.items.businessPartners", path: "/dashboard/partners", icon: Users },
    ],
  },
  {
    id: "finance",
    titleKey: "nav.sections.finance",
    icon: Landmark,
    items: [
      { titleKey: "nav.items.cashBank", path: "/cash-bank", icon: Wallet },
      { titleKey: "nav.items.payments", path: "/dashboard/payments", icon: Wallet },
      { titleKey: "nav.items.expenses", path: "/expenses", icon: Receipt },
      { titleKey: "nav.items.finance", path: "/finance", icon: CircleDollarSign },
    ],
  },
  {
    id: "hr",
    titleKey: "nav.sections.hr",
    icon: Briefcase,
    items: [
      { titleKey: "nav.items.employees", path: "/employees", icon: UserCheck },
      { titleKey: "nav.items.commissions", path: "/commissions", icon: Percent },
    ],
  },
  {
    id: "reports",
    titleKey: "nav.sections.reports",
    icon: BarChart3,
    items: [
      { titleKey: "nav.items.reports", path: "/reports", icon: FileText },
      { titleKey: "nav.items.glFinancialReports", path: "/dashboard/reports/financial", icon: BarChart3 },
      { titleKey: "nav.items.trialBalance", path: "/dashboard/reports/osv", icon: Table2 },
      { titleKey: "nav.items.reconciliationAct", path: "/dashboard/reports/reconciliation", icon: FileCheck2 },
      { titleKey: "nav.items.inventoryTurnover", path: "/dashboard/reports/inventory-turnover", icon: Package },
    ],
  },
  {
    id: "settings",
    titleKey: "nav.sections.settings",
    icon: SlidersHorizontal,
    items: [
      { titleKey: "nav.items.settings", path: "/settings", icon: Settings },
      { titleKey: "nav.items.roles", path: "/settings/roles", icon: ShieldCheck },
      { titleKey: "nav.items.users", path: "/users", icon: Users },
      { titleKey: "nav.items.commissionRules", path: "/settings/commissions", icon: Percent },
      { titleKey: "nav.items.initialSetup", path: "/settings/initial-setup", icon: Landmark },
      { titleKey: "nav.items.backup", path: "/settings/backup", icon: Database },
      { titleKey: "nav.items.barcode", path: "/settings/barcode", icon: Barcode },
      { titleKey: "nav.items.crmSettings", path: "/settings/crm", icon: KanbanSquare },
      { titleKey: "nav.items.taxPayroll", path: "/settings/tax-payroll", icon: Scale },
      { titleKey: "nav.items.procurement", path: "/settings/procurement", icon: ShoppingBag },
      { titleKey: "nav.items.aiIntegration", path: "/settings/ai", icon: Sparkles },
      { titleKey: "nav.items.audit", path: "/settings/audit", icon: ScrollText },
    ],
  },
];

export function flattenNavItems(sections: NavSection[]): NavItem[] {
  return sections.flatMap((section) => section.items);
}

export function isItemActive(pathname: string, path: string): boolean {
  if (path === "/") return pathname === "/";
  if (path === "/products") {
    return (
      pathname === "/products" ||
      pathname.startsWith("/products/new") ||
      (pathname.startsWith("/products/") && !pathname.startsWith("/products/damaged-goods"))
    );
  }
  if (path === "/settings") return pathname === "/settings";
  if (path === "/production") {
    return (
      pathname === "/production" ||
      (pathname.startsWith("/production/") && !pathname.startsWith("/production/bom"))
    );
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function isSectionActive(pathname: string, section: NavSection): boolean {
  return section.items.some((item) => isItemActive(pathname, item.path));
}

export function getActiveSectionId(pathname: string, sections: NavSection[]): string | null {
  return sections.find((section) => isSectionActive(pathname, section))?.id ?? null;
}
