import type { NavSectionId, PermissionGroupId } from "./types";

/** Sidebar sections in display order. Modules place their menu items into these. */
export const NAV_SECTION_DEFS: { id: NavSectionId; titleKey: string; icon: string }[] = [
  { id: "dashboard", titleKey: "nav.sections.dashboard", icon: "LayoutDashboard" },
  { id: "trade", titleKey: "nav.sections.trade", icon: "Store" },
  { id: "inventory", titleKey: "nav.sections.inventory", icon: "Boxes" },
  { id: "production", titleKey: "nav.sections.production", icon: "Factory" },
  { id: "crm", titleKey: "nav.sections.crm", icon: "Contact" },
  { id: "finance", titleKey: "nav.sections.finance", icon: "Landmark" },
  { id: "hr", titleKey: "nav.sections.hr", icon: "Briefcase" },
  { id: "reports", titleKey: "nav.sections.reports", icon: "BarChart3" },
  { id: "settings", titleKey: "nav.sections.settings", icon: "SlidersHorizontal" },
];

/**
 * Groups of the role permission matrix in display order. Modules place their
 * checkboxes into these. Ids are stored in roles.permissions._matrix: never rename.
 */
export const PERMISSION_GROUP_DEFS: {
  id: PermissionGroupId;
  title: string;
  hasWarehouseScope?: boolean;
  hasAccountScope?: boolean;
}[] = [
  { id: "dashboard", title: "Əsas Panel" },
  { id: "sales", title: "Satış" },
  { id: "purchases", title: "Alış" },
  { id: "imports", title: "İdxal" },
  { id: "consignments", title: "Əmanət Satışı" },
  { id: "inventory", title: "Anbar və Məhsul", hasWarehouseScope: true },
  { id: "production", title: "İstehsalat" },
  { id: "crm", title: "Əlaqələr (CRM)" },
  { id: "finance", title: "Maliyyə", hasAccountScope: true },
  { id: "hr", title: "İnsan Resursları" },
  { id: "reports", title: "Hesabatlar" },
  { id: "administration", title: "Administrasiya" },
];
