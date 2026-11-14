"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { AssistantAvatar } from "./AssistantAvatar";
import { ASSISTANT_PANEL_ID, useAssistantUi } from "./AssistantProvider";

/**
 * The shell header's assistant button with ASSISTANT_V2 on (AST-2): the 28 px avatar replaces the sparkle
 * icon and shows the assistant's state (thinking while a reply streams; attention when AST-5 raises an issue).
 */
export function AssistantHeaderButton({ className }: { className?: string }) {
  const ui = useAssistantUi();
  const { t } = useI18n();
  const label = `${ui.panel.open ? t("assistant.close") : t("assistant.open")} (${t("assistant.shortcut")})`;
  return (
    <button
      type="button"
      className={["ds-icon-btn ds-assistant-trigger", className].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      aria-expanded={ui.panel.open}
      aria-controls={ui.panel.open ? ASSISTANT_PANEL_ID : undefined}
      data-assistant-trigger=""
      onClick={ui.toggle}
    >
      <AssistantAvatar state={ui.avatar.state} size={28} decorative />
    </button>
  );
}

/**
 * The floating assistant button for screens without the header button: the classic shell, and phones in
 * the new shell (where the header button is hidden). It sits where the old widget's button sat
 * (`erp-ai-fab`: above the phone tab bar) and hides while the panel is open.
 */
export function AssistantFloatingButton({ hideFromMd }: { hideFromMd: boolean }) {
  const ui = useAssistantUi();
  const { t } = useI18n();
  if (ui.panel.open) return null;
  const label = `${t("assistant.open")} (${t("assistant.shortcut")})`;
  return (
    <button
      type="button"
      className="erp-ai-fab ds-assistant-fab print:hidden"
      data-hide-md={hideFromMd || undefined}
      aria-label={label}
      title={label}
      aria-expanded={false}
      data-assistant-trigger=""
      onClick={ui.open}
    >
      <AssistantAvatar state={ui.avatar.state} size={40} decorative />
    </button>
  );
}
