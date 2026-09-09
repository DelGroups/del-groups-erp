"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import AiN8nSettingsCard from "@/components/settings/AiN8nSettingsCard";
import { useI18n } from "@/i18n/I18nProvider";

export default function AiIntegrationSettingsPage() {
  const { t } = useI18n();

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="ai" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-3xl space-y-6">
            <header>
              <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                <Sparkles className="h-6 w-6 text-app-accent" />
                {t("aiSettings.title")}
              </h1>
              <p className="mt-1 text-sm text-app-muted">{t("aiSettings.description")}</p>
            </header>
            <AiN8nSettingsCard />
          </div>
        </div>
      </PermissionGuard>
    </PageLayout>
  );
}
