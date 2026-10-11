import type { LucideIcon } from "lucide-react";
import { isBarcodeModuleEnabled } from "@/lib/features/barcodeModule";
import { buildNavSections, MODULES } from "@/modules/registry";
import type { FeatureFlag } from "@/modules/types";
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
  ArrowRightLeft,
  Database,
  Barcode,
  ScrollText,
  Factory,
  KanbanSquare,
  Scale,
  Sparkles,
  Blocks,
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

/** Icons a module manifest may name (src/modules/<id>/manifest.ts). */
const NAV_ICONS: Record<string, LucideIcon> = {
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
  ArrowRightLeft,
  Database,
  Barcode,
  ScrollText,
  Factory,
  KanbanSquare,
  Scale,
  Sparkles,
  Blocks,
};

function navIcon(name: string): LucideIcon {
  const icon = NAV_ICONS[name];
  if (!icon) throw new Error(`Unknown nav icon "${name}": add it to NAV_ICONS in navConfig.ts`);
  return icon;
}

const FEATURE_FLAGS: Record<FeatureFlag, () => boolean> = {
  barcodeModule: isBarcodeModuleEnabled,
};

/** Sidebar and command palette sections, generated from the module manifests. */
export const NAV_SECTIONS: NavSection[] = buildNavSections(MODULES, (flag) => FEATURE_FLAGS[flag]()).map(
  (section) => ({
    id: section.id,
    titleKey: section.titleKey,
    icon: navIcon(section.icon),
    items: section.items.map((item) => ({
      titleKey: item.titleKey,
      path: item.path,
      icon: navIcon(item.icon),
      ...(item.keywords ? { keywords: item.keywords } : {}),
    })),
  })
);

export function flattenNavItems(sections: NavSection[]): NavItem[] {
  return sections.flatMap((section) => section.items);
}

export function isItemActive(pathname: string, path: string): boolean {
  if (path === "/") return pathname === "/";
  if (path === "/inventory") {
    return pathname === "/inventory";
  }
  if (path === "/inventory/counts") {
    return pathname === "/inventory/counts" || pathname.startsWith("/inventory/counts/");
  }
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
