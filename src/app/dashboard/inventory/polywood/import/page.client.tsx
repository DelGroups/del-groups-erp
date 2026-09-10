"use client";

import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import PolywoodImportPanel from "@/components/polywood/PolywoodImportPanel";
import { useI18n } from "@/i18n/I18nProvider";
import { ArrowLeft } from "lucide-react";

export default function PolywoodImportPageClient() {
  const { t } = useI18n();

  return (
    <PageLayout>
      <header className="app-glass flex flex-wrap items-center justify-between gap-4 border-b border-app px-6 py-4">
        <div>
          <h2 className="text-xl font-bold text-app">{t("polywood.import.pageTitle")}</h2>
          <p className="text-sm text-app-muted">{t("polywood.import.pageDescription")}</p>
        </div>
        <Link href="/polywood" className="btn-secondary inline-flex">
          <ArrowLeft className="h-4 w-4" />
          {t("polywood.import.backToInventory")}
        </Link>
      </header>
      <div className="p-6">
        <PolywoodImportPanel />
      </div>
    </PageLayout>
  );
}
