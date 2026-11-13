"use client";

import { useDocDateChangeFlag } from "@/components/documents/DocDateChangeFlag";
import { useLotTracking } from "@/modules/inventory";
import { useMemo } from "react";
import {
  Barcode,
  Blocks,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  Database,
  KanbanSquare,
  Landmark,
  Layers,
  Percent,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Ship,
  ShoppingBag,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useI18n } from "@/i18n/I18nProvider";
import { isBarcodeModuleEnabled } from "@/lib/features/barcodeModule";
import { billingPageEnabled } from "@/lib/billing/overview";
import { SETTINGS_GROUPS, visibleSettingsItems, type SettingsGroupId, type SettingsItem } from "@/lib/settings/items";
import type { ModuleId } from "@/modules/types";
import type { PermissionKey } from "@/types/database.types";

const ICONS: Record<string, LucideIcon> = {
  Barcode,
  Blocks,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  Database,
  KanbanSquare,
  Landmark,
  Layers,
  Percent,
  Scale,
  ScrollText,
  ShieldCheck,
  Ship,
  ShoppingBag,
  Sparkles,
  Users,
};

export function settingsIcon(name: string): LucideIcon {
  return ICONS[name] ?? Settings;
}

// Next inlines NEXT_PUBLIC_* only when referenced by name. Off unless "true" (prompt 13).
const BILLING_PAGE = billingPageEnabled({ NEXT_PUBLIC_BILLING_PAGE_ENABLED: process.env.NEXT_PUBLIC_BILLING_PAGE_ENABLED });

export interface SettingsNavItem extends SettingsItem {
  title: string;
  description: string;
  groupTitle: string;
  Icon: LucideIcon;
}

/**
 * The settings pages this user may open (SET-1), translated: one list for the shell's Settings
 * app, the classic SettingsTabs, the command palette and the SETTINGS_V2 hub and side menu.
 * `v2` is true while SETTINGS_V2 is on for this user (new shell + server flag).
 */
export function useSettingsItems(): { items: SettingsNavItem[]; v2: boolean } {
  const { can, isAdmin } = useAuth();
  const { isEnabled } = useEnabledModules();
  const { active: newUi, newImports, settingsV2 } = useNewUi();
  const docDateChange = useDocDateChangeFlag();
  const lotTracking = useLotTracking();
  const { t } = useI18n();
  const v2 = newUi && settingsV2;

  const items = useMemo(() => {
    const groupTitle = new Map<SettingsGroupId, string>(SETTINGS_GROUPS.map((g) => [g.id, t(g.titleKey)]));
    return visibleSettingsItems({
      can: (p) => can(p as PermissionKey),
      isAdmin,
      isEnabled: (m) => isEnabled(m as ModuleId | undefined),
      newUi,
      flags: { barcode: isBarcodeModuleEnabled(), billing: BILLING_PAGE, newImports, docDateChange, lotTracking },
      v2,
    }).map((item) => ({
      ...item,
      title: t(item.titleKey),
      description: t(item.descriptionKey),
      groupTitle: groupTitle.get(item.group) ?? "",
      Icon: settingsIcon(item.icon),
    }));
  }, [can, isAdmin, isEnabled, newUi, newImports, docDateChange, lotTracking, v2, t]);

  return { items, v2 };
}
