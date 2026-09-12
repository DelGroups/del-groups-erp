"use client";

import React, { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  FilePlus,
  Menu,
  Moon,
  Plus,
  Receipt,
  Search,
  Sun,
  UserPlus,
} from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { buildBreadcrumbsFromPath, shouldShowGlobalBreadcrumbs } from "@/lib/navigation/breadcrumbs";
import { useI18n } from "@/i18n/I18nProvider";
import { useShellStore } from "@/stores/shellStore";
import { useSidebarMenu } from "@/components/layout/SidebarContext";
import { useTheme } from "@/theme/ThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

export default function AppTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const sidebarMenu = useSidebarMenu();
  const setCommandPaletteOpen = useShellStore((s) => s.setCommandPaletteOpen);
  const { theme, setTheme } = useTheme();

  const crumbs = useMemo(
    () => buildBreadcrumbsFromPath(pathname, t),
    [pathname, t]
  );

  const showBreadcrumbs = shouldShowGlobalBreadcrumbs(pathname) && crumbs.length > 0;
  const isDark = theme === "dark" || theme === "emerald";

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  if (pathname.startsWith("/login") || pathname.startsWith("/auth")) {
    return null;
  }

  return (
    <header className="app-glass sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-app px-3 py-2 md:px-4">
      <button
        type="button"
        aria-label={t("nav.openMenu")}
        onClick={() => sidebarMenu?.openMobileMenu()}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-app text-app transition-colors hover:bg-app-card-hover md:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        {showBreadcrumbs ? <Breadcrumbs items={crumbs} /> : (
          <p className="truncate text-sm font-semibold text-app">DEL GROUPS ERP</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="hidden h-9 min-w-[12rem] items-center gap-2 rounded-lg border border-app bg-app-card px-3 text-left text-sm text-app-muted transition-colors hover:bg-app-card-hover hover:text-app sm:flex lg:min-w-[16rem]"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">{t("shell.searchPlaceholder")}</span>
        <kbd className="hidden rounded border border-app bg-app-card-hover px-1.5 py-0.5 text-[10px] font-medium text-app-muted lg:inline">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        aria-label={t("shell.searchPlaceholder")}
        onClick={() => setCommandPaletteOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-app text-app-muted transition-colors hover:bg-app-card-hover hover:text-app sm:hidden"
      >
        <Search className="h-4 w-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-app bg-[image:var(--app-gradient)] px-3 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("shell.quickActions")}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-80" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t("shell.quickActions")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/sales/new")}>
            <FilePlus className="h-4 w-4" />
            {t("shell.createInvoice")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/customers")}>
            <UserPlus className="h-4 w-4" />
            {t("shell.addCustomer")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/expenses")}>
            <Receipt className="h-4 w-4" />
            {t("shell.addExpense")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={t("theme.label")}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-app text-app-muted transition-colors hover:bg-app-card-hover hover:text-app"
        )}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </header>
  );
}
