"use client";

import React, { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV_SECTIONS } from "@/lib/navigation/navConfig";
import { useShellStore } from "@/stores/shellStore";
import { useAuth } from "@/components/auth/AuthProvider";
import { getNavItemPermission } from "@/lib/auth/routePermissions";
import { useI18n } from "@/i18n/I18nProvider";
import { FilePlus, Receipt, UserPlus } from "lucide-react";

const QUICK_ACTIONS = [
  { key: "createInvoice", path: "/sales/new", icon: FilePlus },
  { key: "addCustomer", path: "/customers", icon: UserPlus },
  { key: "addExpense", path: "/expenses", icon: Receipt },
] as const;

export default function CommandPalette() {
  const router = useRouter();
  const { t } = useI18n();
  const { can, isAdmin } = useAuth();
  const open = useShellStore((s) => s.commandPaletteOpen);
  const setOpen = useShellStore((s) => s.setCommandPaletteOpen);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const navigate = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("shell.searchPlaceholder")} />
      <CommandList>
        <CommandEmpty>{t("shell.noResults")}</CommandEmpty>

        <CommandGroup heading={t("shell.quickActions")}>
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.key}
                value={`${t(`shell.${action.key}`)} ${action.path}`}
                onSelect={() => navigate(action.path)}
              >
                <Icon className="h-4 w-4 text-app-muted" />
                <span>{t(`shell.${action.key}`)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {visibleSections.map((section) => (
          <CommandGroup key={section.id} heading={t(section.titleKey)}>
            {section.items.map((item) => {
              const Icon = item.icon;
              const label = t(item.titleKey);
              const value = [label, item.path, ...(item.keywords ?? [])].join(" ");
              return (
                <CommandItem key={item.path} value={value} onSelect={() => navigate(item.path)}>
                  <Icon className="h-4 w-4 text-app-muted" />
                  <span>{label}</span>
                  <span className="ml-auto text-xs text-app-muted">{item.path}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

      </CommandList>
    </CommandDialog>
  );
}
