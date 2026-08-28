"use client";

import React, { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import PermissionGuard from "@/components/auth/PermissionGuard";
import { SidebarMenuProvider } from "@/components/layout/SidebarContext";
import { getRequiredPermission } from "@/lib/auth/routePermissions";
import { useI18n } from "@/i18n/I18nProvider";
import type { PermissionKey } from "@/types/database.types";

interface PageLayoutProps {
  children: React.ReactNode;
  /** Override auto-detected route permission. Pass `null` to skip guarding. */
  permission?: PermissionKey | null;
}

export default function PageLayout({ children, permission }: PageLayoutProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const requiredPermission =
    permission === undefined ? getRequiredPermission(pathname) : permission;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const content = requiredPermission ? (
    <PermissionGuard permission={requiredPermission}>{children}</PermissionGuard>
  ) : (
    children
  );

  return (
    <SidebarMenuProvider
      value={{
        openMobileMenu: () => setMobileMenuOpen(true),
        closeMobileMenu: () => setMobileMenuOpen(false),
      }}
    >
      <div className="flex h-screen overflow-hidden bg-app">
        {mobileMenuOpen && (
          <button
            type="button"
            aria-label={t("nav.closeMenu")}
            className="app-scrim fixed inset-0 z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        <Sidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="app-glass flex shrink-0 items-center gap-3 border-b border-app px-4 py-3 md:hidden">
            <button
              type="button"
              aria-label={t("nav.openMenu")}
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-app text-app transition-colors hover:bg-app-card-hover"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-app">DEL GROUPS MMC</p>
              <p className="truncate text-[10px] text-app-muted">{t("nav.erpSubtitle")}</p>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-app">{content}</div>
        </div>
      </div>
    </SidebarMenuProvider>
  );
}
