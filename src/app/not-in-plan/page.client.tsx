"use client";

import React from "react";
import Link from "next/link";
import { PackageX } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { useI18n } from "@/i18n/I18nProvider";
import type { ModuleId } from "@/modules/types";

export default function NotInPlanPage({ moduleId }: { moduleId: ModuleId | null }) {
  const { t } = useI18n();
  const moduleName = moduleId ? t(`modules.names.${moduleId}`) : "";

  return (
    <PageLayout permission={null}>
      <div className="flex flex-1 items-center justify-center bg-app p-6">
        <div className="app-card app-card-elevated max-w-md space-y-4 p-8 text-center">
          <PackageX className="mx-auto h-12 w-12 text-app-muted" />
          <h1 className="text-lg font-bold text-app">{t("modules.notInPlan.title")}</h1>
          <p className="text-sm text-app-muted">
            {moduleName ? t("modules.notInPlan.body", { module: moduleName }) : t("modules.notInPlan.bodyGeneric")}
          </p>
          <p className="text-xs text-app-muted">{t("modules.notInPlan.contact")}</p>
          <Link href="/" className="btn-primary inline-flex px-4 py-2 text-sm">
            {t("modules.notInPlan.back")}
          </Link>
        </div>
      </div>
    </PageLayout>
  );
}
