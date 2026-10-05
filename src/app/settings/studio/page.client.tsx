"use client";

import React from "react";
import { Blocks } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PermissionGuard from "@/components/auth/PermissionGuard";
import SettingsTabs from "@/components/settings/SettingsTabs";
import StudioFieldsEditor from "@/components/studio/StudioFieldsEditor";
import { useI18n } from "@/i18n/I18nProvider";

export default function StudioSettingsPage() {
  const { t } = useI18n();

  return (
    <PageLayout>
      <PermissionGuard permission="can_manage_settings">
        <SettingsTabs activeTab="studio" />

        <div className="flex-1 overflow-y-auto bg-app p-6">
          <div className="mx-auto max-w-4xl space-y-6">
            <header>
              <h1 className="flex items-center gap-2 text-xl font-bold text-app">
                <Blocks className="h-6 w-6 text-app-accent" />
                {t("studio.title")}
              </h1>
              <p className="mt-1 text-sm text-app-muted">{t("studio.description")}</p>
            </header>
            <StudioFieldsEditor />
          </div>
        </div>
      </PermissionGuard>
    </PageLayout>
  );
}
