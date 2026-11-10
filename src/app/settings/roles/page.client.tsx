"use client";

import React, { useState } from "react";
import { ShieldCheck, Users } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import { SettingsV2Page, useSettingsV2 } from "@/components/settings/v2/SettingsV2Page";
import RolesPermissionsTab from "@/components/settings/RolesPermissionsTab";
import UserPermissionsTab from "@/components/settings/UserPermissionsTab";
import { useI18n } from "@/i18n/I18nProvider";

type RolesPageTab = "roles" | "users";

export default function RolesSettingsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<RolesPageTab>("roles");
  const settingsV2 = useSettingsV2();

  if (settingsV2) {
    const tab = (id: RolesPageTab, Icon: typeof Users, label: string) => (
      <button type="button" role="tab" id={`roles-tab-${id}`} aria-controls="roles-panel" aria-selected={activeTab === id} className="ds-tab" onClick={() => setActiveTab(id)}>
        <Icon className="h-4 w-4" aria-hidden />
        {label}
      </button>
    );
    return (
      <SettingsV2Page id="roles" permission="can_manage_roles">
        <div className="ds-doc-tabs" role="tablist" aria-label={t("settingsNav.roles.title")}>
          {tab("roles", ShieldCheck, t("settings.rolesTab"))}
          {tab("users", Users, t("settings.userPermissionsTab"))}
        </div>
        <div id="roles-panel" role="tabpanel" aria-labelledby={`roles-tab-${activeTab}`} className="-mx-[var(--erp-content-padding-x,0px)] md:mx-0">
          {activeTab === "roles" ? <RolesPermissionsTab /> : <UserPermissionsTab />}
        </div>
      </SettingsV2Page>
    );
  }
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

      <div className="border-b border-app px-6">
        <div className="flex gap-2 py-3">
          <button
            type="button"
            onClick={() => setActiveTab("roles")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
              activeTab === "roles"
                ? "bg-[image:var(--app-gradient)] text-white"
                : "bg-app-card-hover text-app-muted hover:text-app"
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            {t("settings.rolesTab")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("users")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
              activeTab === "users"
                ? "bg-[image:var(--app-gradient)] text-white"
                : "bg-app-card-hover text-app-muted hover:text-app"
            }`}
          >
            <Users className="h-4 w-4" />
            {t("settings.userPermissionsTab")}
          </button>
        </div>
      </div>

      <PermissionGuard permission="can_manage_roles">
        {activeTab === "roles" ? <RolesPermissionsTab /> : <UserPermissionsTab />}
      </PermissionGuard>
    </PageLayout>
  );
}
