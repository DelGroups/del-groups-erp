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
import {
  NAV_SECTIONS,
  getActiveSectionId,
  isItemActive,
  isSectionActive,
} from "@/lib/navigation/navConfig";
import { useShellStore } from "@/stores/shellStore";
import SidebarSectionFlyout from "@/components/layout/SidebarSectionFlyout";
import {
  Building2,
  Menu,
  X,
  ChevronDown,
  ShieldCheck,
  LogOut,
} from "lucide-react";

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

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const desktopExpanded = !useShellStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useShellStore((s) => s.toggleSidebarCollapsed);
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

  const closeMobileIfNeeded = () => {
    onMobileClose?.();
  };

  return (
    <aside
      className={`app-glass fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r text-[color:var(--app-sidebar-text)] transition-transform duration-300 ease-in-out md:relative md:z-20 md:translate-x-0 md:transition-[width] ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      } ${desktopExpanded ? "md:w-64" : "md:w-20"}`}
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
            <div className="flex-shrink-0 rounded-lg bg-[image:var(--app-gradient)] p-2 shadow-md shadow-indigo-500/20">
              <Building2 className="h-5 w-5 text-white" />
            </div>
          )}
          <div className={`truncate ${desktopExpanded ? "md:block" : "md:hidden"}`}>
            <h1 className="truncate text-xs font-bold tracking-wide text-app">{companyName}</h1>
            <p className="text-[10px]" style={{ color: "var(--app-sidebar-muted)" }}>
              {t("nav.erpSubtitle")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onMobileClose?.()}
          aria-label={t("nav.closeMenu")}
          className="rounded-lg p-1 transition-colors hover:opacity-80 md:hidden"
          style={{ color: "var(--app-sidebar-muted)" }}
        >
          <X className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          aria-label={desktopExpanded ? t("nav.collapseMenu") : t("nav.expandMenu")}
          className="hidden rounded-lg p-1 transition-colors hover:opacity-80 md:inline-flex"
          style={{ color: "var(--app-sidebar-muted)" }}
        >
          {desktopExpanded ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {visibleSections.map((section) => {
          const SectionIcon = section.icon;
          const sectionHasActive = isSectionActive(pathname, section);
          const expanded = !!openSections[section.id];

          return (
            <div key={section.id} className="mb-1">
              <div className={desktopExpanded ? "block" : "block md:hidden"}>
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
                          onClick={closeMobileIfNeeded}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-300 ${
                            active ? "nav-link-active" : "hover:bg-[color:var(--app-card-hover)]"
                          }`}
                          style={active ? undefined : { color: "var(--app-sidebar-text)" }}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{t(item.titleKey)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className={desktopExpanded ? "hidden" : "hidden space-y-1 md:block"}>
                <SidebarSectionFlyout section={section} onNavigate={closeMobileIfNeeded} />
              </div>
            </div>
          );
        })}
      </nav>

      <div
        className="relative z-10 mt-auto shrink-0 border-t px-3 pb-8 pt-3 md:pb-32"
        style={{ borderColor: "var(--app-sidebar-border)" }}
      >
        <div className={`block space-y-3 ${desktopExpanded ? "md:block" : "md:hidden"}`}>
            <div className="flex items-center gap-2 overflow-hidden">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[image:var(--app-gradient)] text-[10px] font-bold text-white shadow-sm shadow-indigo-500/30"
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
        <div className={`hidden flex-col items-center space-y-3 ${desktopExpanded ? "md:hidden" : "md:flex"}`}>
            <div
              title={`${displayName} — ${roleName}`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[image:var(--app-gradient)] text-[10px] font-bold text-white shadow-sm shadow-indigo-500/30"
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
      </div>
    </aside>
  );
}
