"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import ThemeSwitcher from "@/components/theme/ThemeSwitcher";
import { getNavItemPermission } from "@/lib/auth/routePermissions";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  ShoppingCart,
  ShoppingBag,
  Users,
  Truck,
  Building2,
  FileSpreadsheet,
  Wallet,
  Receipt,
  UserCheck,
  FileText,
  Settings,
  Menu,
  X,
  Trash2,
  Percent,
  CircleDollarSign,
  ChevronDown,
  Store,
  Boxes,
  Contact,
  Landmark,
  Briefcase,
  BarChart3,
  SlidersHorizontal,
  ShieldCheck,
  LogOut,
  ClipboardList,
  Database,
} from "lucide-react";

interface NavItem {
  titleKey: string;
  path: string;
  icon: LucideIcon;
}

interface NavSection {
  id: string;
  titleKey: string;
  icon: LucideIcon;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
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
      { titleKey: "nav.items.sales", path: "/sales", icon: ShoppingCart },
      { titleKey: "nav.items.purchases", path: "/purchases", icon: ShoppingBag },
      { titleKey: "nav.items.consignments", path: "/consignments", icon: FileSpreadsheet },
    ],
  },
  {
    id: "inventory",
    titleKey: "nav.sections.inventory",
    icon: Boxes,
    items: [
      { titleKey: "nav.items.products", path: "/products", icon: Package },
      { titleKey: "nav.items.warehouses", path: "/warehouses", icon: Warehouse },
      { titleKey: "nav.items.warehouseSlips", path: "/dashboard/warehouse/slips", icon: ClipboardList },
      { titleKey: "nav.items.damagedGoods", path: "/products/damaged-goods", icon: Trash2 },
    ],
  },
  {
    id: "crm",
    titleKey: "nav.sections.crm",
    icon: Contact,
    items: [
      { titleKey: "nav.items.customers", path: "/customers", icon: Users },
      { titleKey: "nav.items.suppliers", path: "/suppliers", icon: Truck },
    ],
  },
  {
    id: "finance",
    titleKey: "nav.sections.finance",
    icon: Landmark,
    items: [
      { titleKey: "nav.items.cashBank", path: "/cash-bank", icon: Wallet },
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
    items: [{ titleKey: "nav.items.reports", path: "/reports", icon: FileText }],
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
    ],
  },
];

function isItemActive(pathname: string, path: string): boolean {
  if (path === "/") return pathname === "/";
  if (path === "/products") {
    return (
      pathname === "/products" ||
      pathname.startsWith("/products/new") ||
      (pathname.startsWith("/products/") && !pathname.startsWith("/products/damaged-goods"))
    );
  }
  if (path === "/settings") return pathname === "/settings";
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isSectionActive(pathname: string, section: NavSection): boolean {
  return section.items.some((item) => isItemActive(pathname, item.path));
}

function getActiveSectionId(pathname: string, sections: NavSection[]): string | null {
  return sections.find((section) => isSectionActive(pathname, section))?.id ?? null;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export default function Sidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [companyName, setCompanyName] = useState("DEL GROUPS MMC");
  const [logoUrl, setLogoUrl] = useState("");
  const pathname = usePathname();
  const { displayName, roleName, loading, signOut, can, isAdmin } = useAuth();
  const { t } = useI18n();

  const visibleSections = useMemo(() => {
    if (isAdmin) return NAV_SECTIONS;

    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const permission = getNavItemPermission(item.path);
        if (!permission) return true;
        return can(permission);
      }),
    })).filter((section) => section.items.length > 0);
  }, [can, isAdmin]);

  const activeSectionId = useMemo(
    () => getActiveSectionId(pathname, visibleSections),
    [pathname, visibleSections]
  );

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of NAV_SECTIONS) {
      initial[section.id] = section.id === "dashboard";
    }
    const current = getActiveSectionId(pathname, NAV_SECTIONS);
    if (current) initial[current] = true;
    return initial;
  });

  useEffect(() => {
    async function fetchSettings() {
      const { data: setRes } = await supabase.from("settings").select("*").limit(1).single();
      if (setRes) {
        if (setRes.company_name) setCompanyName(setRes.company_name);
        if (setRes.logo_url) setLogoUrl(setRes.logo_url);
      }
    }
    fetchSettings();
  }, []);

  useEffect(() => {
    if (!activeSectionId) return;
    setOpenSections((prev) =>
      prev[activeSectionId] ? prev : { ...prev, [activeSectionId]: true }
    );
  }, [activeSectionId]);

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside
      className={`${
        sidebarOpen ? "w-64" : "w-20"
      } z-20 flex h-screen shrink-0 flex-col border-r text-[color:var(--app-sidebar-text)] transition-all duration-300`}
      style={{
        backgroundColor: "var(--app-sidebar)",
        borderColor: "var(--app-sidebar-border)",
      }}
    >
      <div
        className="flex shrink-0 items-center justify-between border-b p-4"
        style={{ borderColor: "var(--app-sidebar-border)" }}
      >
        <div className="flex items-center space-x-3 overflow-hidden">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo"
              className="h-8 w-8 flex-shrink-0 rounded-lg border border-app bg-app-surface object-contain p-0.5 shadow-sm"
            />
          ) : (
            <div className="flex-shrink-0 rounded-lg bg-blue-600 p-2">
              <Building2 className="h-5 w-5 text-white" />
            </div>
          )}
          {sidebarOpen && (
            <div className="truncate">
              <h1 className="truncate text-xs font-bold tracking-wide text-white">{companyName}</h1>
              <p className="text-[10px]" style={{ color: "var(--app-sidebar-muted)" }}>
                {t("nav.erpSubtitle")}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="rounded-lg p-1 transition-colors hover:opacity-80"
          style={{ color: "var(--app-sidebar-muted)" }}
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {visibleSections.map((section) => {
          const SectionIcon = section.icon;
          const sectionHasActive = isSectionActive(pathname, section);
          const expanded = !!openSections[section.id];

          if (!sidebarOpen) {
            return (
              <div key={section.id} className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(pathname, item.path);
                  const title = t(item.titleKey);
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      title={title}
                      className={`flex items-center justify-center rounded-lg px-2 py-2.5 transition-colors duration-300 ${
                        active ? "text-white shadow-sm" : "hover:opacity-90"
                      }`}
                      style={
                        active
                          ? { backgroundColor: "var(--app-accent)" }
                          : { color: "var(--app-sidebar-text)" }
                      }
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                    </Link>
                  );
                })}
              </div>
            );
          }

          return (
            <div key={section.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors duration-300 ${
                  sectionHasActive ? "opacity-100" : "opacity-80 hover:opacity-100"
                }`}
                style={
                  sectionHasActive
                    ? { backgroundColor: "var(--app-card-hover)" }
                    : { color: "var(--app-sidebar-muted)" }
                }
                aria-expanded={expanded}
              >
                <span className="flex items-center gap-2">
                  <SectionIcon className="h-4 w-4 shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">
                    {t(section.titleKey)}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                    expanded ? "rotate-0" : "-rotate-90"
                  }`}
                />
              </button>

              <div
                className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ${
                  expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="min-h-0 space-y-0.5 pt-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isItemActive(pathname, item.path);
                    return (
                      <Link
                        key={item.path}
                        href={item.path}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-300 ${
                          active ? "text-white shadow-sm" : "hover:opacity-90"
                        }`}
                        style={
                          active
                            ? { backgroundColor: "var(--app-accent)" }
                            : { color: "var(--app-sidebar-text)" }
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{t(item.titleKey)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <div
        className="relative z-10 mt-auto shrink-0 border-t px-3 pb-32 pt-3"
        style={{ borderColor: "var(--app-sidebar-border)" }}
      >
        {sidebarOpen ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 overflow-hidden">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: "var(--app-accent)" }}
              >
                {loading ? "…" : initials(displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{loading ? t("nav.loading") : displayName}</p>
                <p
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--app-accent-secondary)" }}
                >
                  <ShieldCheck className="h-3 w-3 shrink-0" />
                  <span className="truncate">{loading ? "—" : roleName}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors duration-300 hover:opacity-90"
              style={{ color: "var(--app-sidebar-text)" }}
            >
              <LogOut className="h-3.5 w-3.5 shrink-0" />
              {t("nav.signOut")}
            </button>
            <div className="relative z-10 space-y-3">
              <ThemeSwitcher />
              <LanguageSwitcher />
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex flex-col items-center space-y-3">
            <div
              title={`${displayName} — ${roleName}`}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: "var(--app-accent)" }}
            >
              {loading ? "…" : initials(displayName)}
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              title={t("nav.signOut")}
              className="rounded-lg p-1.5 transition-colors duration-300 hover:opacity-80"
              style={{ color: "var(--app-sidebar-muted)" }}
            >
              <LogOut className="h-4 w-4" />
            </button>
            <ThemeSwitcher compact />
            <LanguageSwitcher compact />
          </div>
        )}
      </div>
    </aside>
  );
}
