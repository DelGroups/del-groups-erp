"use client";

import { DesignScope, ToastProvider } from "@/design-system/components";
import { useNewUi } from "@/components/shell/NewUiProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { useFormatter } from "../components/ViewScope";
import { Chatter } from "./Chatter";
import { chatterEnabledFor } from "./logic";

/**
 * The record's chatter on a classic page (phase 19), for records that have no view-engine form
 * yet (customers). Renders nothing unless the new UI is on for this user, so classic users see
 * no change.
 */
export function RecordChatter({ model, recordId, className }: { model: string; recordId: string | null; className?: string }) {
  const { active, brand } = useNewUi();
  const { theme } = useTheme();
  const { t } = useI18n();
  const fmt = useFormatter();
  if (!active || !recordId || !chatterEnabledFor(model, recordId)) return null;
  return (
    <DesignScope theme={theme === "daylight" ? "light" : "dark"} brand={brand} className={className}>
      <ToastProvider closeLabel={t("common.close")}>
        <Chatter model={model} recordId={recordId} fmt={fmt} />
      </ToastProvider>
    </DesignScope>
  );
}
