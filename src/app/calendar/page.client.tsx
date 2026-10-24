"use client";

import dynamic from "next/dynamic";
import PageLayout from "@/components/layout/PageLayout";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";

// The view engine is loaded only by users of the new shell.
const CalendarScreen = dynamic(() => import("@/modules/calendar/pages").then((m) => m.CalendarScreen), { ssr: false });

/** The calendar in the new shell; users of the classic layout get a short note instead. */
export default function CalendarNewUiOnly() {
  const { active } = useNewUi();
  const { t } = useI18n();
  if (active) return <CalendarScreen />;
  return (
    <PageLayout>
      <div className="p-6 text-sm text-app-muted">{t("calendar.newUiOnly")}</div>
    </PageLayout>
  );
}
