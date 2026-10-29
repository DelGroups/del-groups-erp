"use client";

import React from "react";
import Link from "next/link";
import { Blocks, Boxes, ClipboardCheck, Building2, CalendarClock, CreditCard, Database, Landmark, Percent, Barcode, KanbanSquare, Scale, ScrollText, ShieldCheck, ShoppingBag, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import type { PermissionKey } from "@/types/database.types";
import { isBarcodeModuleEnabled } from "@/lib/features/barcodeModule";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { billingPageEnabled } from "@/lib/billing/overview";
import type { ModuleId } from "@/modules/types";
import { useNewUi } from "@/components/shell/NewUiProvider";

interface SettingsTab {
  id: string;
  titleKey: string;
  path: string;
  icon: LucideIcon;
  permission: PermissionKey;
  /** Hidden when the tenant does not have this module. */
  module?: ModuleId;
  adminOnly?: boolean;
  /** Shown only while the new UI (NEW_UI) is on for this user. */
  newUiOnly?: boolean;
}

const SETTINGS_TABS: SettingsTab[] = [
  {
    id: "company",
    titleKey: "settings.companyProfile",
    path: "/settings",
    icon: Building2,
    permission: "can_view_settings",
  },
  {
    id: "roles",
    titleKey: "settings.rolesTitle",
    path: "/settings/roles",
    icon: ShieldCheck,
    permission: "can_manage_roles",
  },
  {
    id: "users",
    titleKey: "users.title",
    path: "/users",
    icon: Users,
    permission: "can_manage_users",
  },
  {
    id: "commissions",
    module: "commissions",
    titleKey: "settings.commissionRulesTab",
    path: "/settings/commissions",
    icon: Percent,
    permission: "can_manage_commissions",
  },
  {
    id: "initial-setup",
    titleKey: "settings.initialSetupTab",
    path: "/settings/initial-setup",
    icon: Landmark,
    permission: "can_manage_settings",
  },
  {
    id: "backup",
    titleKey: "settings.backupTab",
    path: "/settings/backup",
    icon: Database,
    permission: "can_manage_settings",
  },
  {
    id: "barcode",
    module: "barcode",
    titleKey: "settings.barcodeTab",
    path: "/settings/barcode",
    icon: Barcode,
    permission: "can_manage_settings",
  },
  {
    id: "crm",
    module: "crm",
    titleKey: "settings.crmTab",
    path: "/settings/crm",
    icon: KanbanSquare,
    permission: "can_manage_settings",
  },
  {
    id: "tax-payroll",
    module: "tax-az",
    titleKey: "settings.taxPayrollTab",
    path: "/settings/tax-payroll",
    icon: Scale,
    permission: "can_manage_settings",
  },
  {
    id: "procurement",
    module: "purchases",
    titleKey: "settings.procurementTab",
    path: "/settings/procurement",
    icon: ShoppingBag,
    permission: "can_manage_settings",
  },
  {
    id: "ai",
    module: "ai",
    titleKey: "settings.aiTab",
    path: "/settings/ai",
    icon: Sparkles,
    permission: "can_manage_settings",
  },
  {
    id: "studio",
    module: "studio",
    titleKey: "nav.items.studio",
    path: "/settings/studio",
    icon: Blocks,
    permission: "can_manage_settings",
  },
  {
    id: "modules",
    titleKey: "settings.modulesTab",
    path: "/settings/modules",
    icon: Boxes,
    permission: "can_manage_settings",
    adminOnly: true,
  },
  {
    id: "billing",
    titleKey: "settings.billingTab",
    path: "/settings/billing",
    icon: CreditCard,
    permission: "can_manage_settings",
    adminOnly: true,
  },
  {
    id: "activity-types",
    titleKey: "views.chatter.typesAdmin.tab",
    path: "/settings/activity-types",
    icon: CalendarClock,
    permission: "can_manage_settings",
    adminOnly: true,
    newUiOnly: true,
  },
  {
    id: "stock-integrity",
    module: "inventory",
    titleKey: "settings.stockIntegrityTab",
    path: "/settings/stock-integrity",
    icon: ClipboardCheck,
    permission: "can_manage_settings",
    adminOnly: true,
  },
  {
    id: "audit",
    titleKey: "settings.auditTab",
    path: "/settings/audit",
    icon: ScrollText,
    permission: "can_manage_settings",
  },
];

// Next inlines NEXT_PUBLIC_* only when referenced by name. Off unless "true" (prompt 13).
const BILLING_TAB = billingPageEnabled({ NEXT_PUBLIC_BILLING_PAGE_ENABLED: process.env.NEXT_PUBLIC_BILLING_PAGE_ENABLED });

export default function SettingsTabs({ activeTab }: { activeTab: string }) {
  const { can, isAdmin } = useAuth();
  const { t } = useI18n();
  const { isEnabled } = useEnabledModules();
  const { active: newUi } = useNewUi();
  const tabs = SETTINGS_TABS.filter(
    (tab) =>
      can(tab.permission) &&
      (!tab.adminOnly || isAdmin) &&
      (!tab.newUiOnly || newUi) &&
      isEnabled(tab.module) &&
      (isBarcodeModuleEnabled() || tab.id !== "barcode") &&
      (BILLING_TAB || tab.id !== "billing")
  );

  return (
    <div className="app-glass flex flex-wrap gap-1 border-b border-app px-6">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={tab.path}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-colors duration-300 ${
              active
                ? "border-[color:var(--app-accent)] text-app-accent"
                : "border-transparent text-app-muted hover:border-[color:var(--app-border-hover)] hover:text-app"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t(tab.titleKey)}
          </Link>
        );
      })}
    </div>
  );
}
