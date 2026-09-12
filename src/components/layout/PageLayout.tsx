"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import AppTopBar from "@/components/layout/AppTopBar";
import CommandPalette from "@/components/layout/CommandPalette";
import AiAssistantWidget from "@/components/ai/AiAssistantWidget";
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
          <AppTopBar />
          <div className="min-h-0 flex-1 overflow-y-auto bg-app">{content}</div>
        </div>
      </div>
      <CommandPalette />
      <AiAssistantWidget />
    </SidebarMenuProvider>
  );
}
