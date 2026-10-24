"use client";

import dynamic from "next/dynamic";
import PageLayout from "@/components/layout/PageLayout";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";

// The documents screen is loaded only by users of the new shell.
const DocumentsScreen = dynamic(() => import("@/modules/documents/pages").then((m) => m.DocumentsScreen), { ssr: false });

/** Documents in the new shell; users of the classic layout get a short note instead. */
export default function DocumentsNewUiOnly() {
  const { active } = useNewUi();
  const { t } = useI18n();
  if (active) return <DocumentsScreen />;
  return (
    <PageLayout>
      <div className="p-6 text-sm text-app-muted">{t("library.newUiOnly")}</div>
    </PageLayout>
  );
}
