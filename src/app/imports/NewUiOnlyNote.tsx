"use client";

import PageLayout from "@/components/layout/PageLayout";
import { useI18n } from "@/i18n/I18nProvider";

/** Shown to users of the classic layout: the Imports module exists only in the new shell. */
export default function NewUiOnlyNote() {
  const { t } = useI18n();
  return (
    <PageLayout>
      <div className="p-6 text-sm text-app-muted">{t("imports.newUiOnly")}</div>
    </PageLayout>
  );
}
