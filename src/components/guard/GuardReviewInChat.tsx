"use client";

import { MessageSquareText } from "lucide-react";
import { Button } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { useAssistantUi } from "@/components/assistant/AssistantProvider";

/**
 * With the unified assistant on (AST-6), the accountant lives in the chat: instead of the "Ask the
 * accountant" form, the Reports tab has one button that opens the assistant with "Build today's review".
 * The answer is a normal chat answer (the accountant skill reads the findings and the books).
 */
export function useGuardInChat(): boolean {
  return useAssistantUi().active;
}

export default function GuardReviewInChat() {
  const { t } = useI18n();
  const ui = useAssistantUi();
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] p-3">
      <p className="m-0 text-[length:var(--ds-text-sm)] text-[var(--ds-text-muted)]">{t("assistant.insights.guardInChat")}</p>
      <Button variant="secondary" icon={MessageSquareText} onClick={() => ui.ask(t("assistant.insights.buildReviewQuestion"))}>
        {t("assistant.insights.buildReview")}
      </Button>
    </div>
  );
}
