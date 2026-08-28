"use client";

import React from "react";
import { ShieldCheck } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import RolesPermissionsTab from "@/components/settings/RolesPermissionsTab";
import { useI18n } from "@/i18n/I18nProvider";

export default function RolesSettingsPage() {
  const { t } = useI18n();

  return (
    <PageLayout>
        <div className="border-b border-app app-glass px-6 py-4">
          <h1 className="flex items-center gap-2 text-xl font-bold text-app">
            <ShieldCheck className="h-6 w-6 text-app-accent" />
            {t("settings.rolesTitle")}
          </h1>
          <p className="mt-0.5 text-xs text-app-muted">{t("settings.rolesDescription")}</p>
        </div>

        <SettingsTabs activeTab="roles" />

        <PermissionGuard permission="can_manage_roles">
          <RolesPermissionsTab />
        </PermissionGuard>
      </PageLayout>
  );
}
