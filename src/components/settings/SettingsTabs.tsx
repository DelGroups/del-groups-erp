"use client";

import React from "react";
import Link from "next/link";
import { Building2, Database, Landmark, Percent, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import type { PermissionKey } from "@/types/database.types";

interface SettingsTab {
  id: string;
  titleKey: string;
  path: string;
  icon: LucideIcon;
  permission: PermissionKey;
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
];

export default function SettingsTabs({ activeTab }: { activeTab: string }) {
  const { can } = useAuth();
  const { t } = useI18n();
  const tabs = SETTINGS_TABS.filter((tab) => can(tab.permission));

  return (
    <div className="flex flex-wrap gap-1 border-b border-app bg-app-surface px-6 backdrop-blur-md">
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
