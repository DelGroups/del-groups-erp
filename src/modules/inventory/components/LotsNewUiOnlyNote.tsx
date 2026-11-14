"use client";

import PageLayout from "@/components/layout/PageLayout";
import { useI18n } from "@/i18n/I18nProvider";

/** Shown to users of the classic layout: the lot screens exist only in the new shell (LOT-4). */
export default function LotsNewUiOnlyNote() {
  const { t } = useI18n();
  return (
    <PageLayout>
      <div className="p-6 text-sm text-app-muted">{t("lots.screens.newUiOnly")}</div>
    </PageLayout>
  );
}
