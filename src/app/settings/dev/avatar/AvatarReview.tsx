"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import { DesignScope, IconButton, PageHeader, Section, ToastProvider } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { AssistantAvatar } from "@/components/assistant/AssistantAvatar";
import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { AssistantEmptyState, AssistantPanelHeader } from "@/components/assistant/AssistantPanelParts";
import { AssistantThread } from "@/components/assistant/AssistantThread";
import { AVATAR_SIZES, AVATAR_STATES, avatarLabelKey } from "@/lib/assistant/ui/avatar";
import type { ThreadMessage } from "@/lib/assistant/ui/thread";

/** The review page of the avatar and the panel (AST-2); sample content only, nothing is sent anywhere. */
export default function AvatarReview({ fontClassName, theme }: { fontClassName?: string; theme?: "light" | "dark" }) {
  const { theme: appTheme } = useTheme();
  const { t, locale } = useI18n();
  const scopeTheme = theme ?? (appTheme === "daylight" ? "light" : "dark");
  const [draft, setDraft] = useState("");
  const noop = () => undefined;

  const demo: ThreadMessage[] = [
    { id: "u1", role: "user", content: t("assistant.dev.demoQuestion"), status: "done", steps: [], links: [] },
    {
      id: "a1",
      role: "assistant",
      content: t("assistant.dev.demoAnswer"),
      status: "done",
      steps: [{ tool: "list_debtors", summary: t("assistant.dev.demoStep"), ok: true }],
      links: [{ label: "SS-2026-00123", href: "/sales" }],
      question: t("assistant.dev.demoQuestion"),
    },
    { id: "u2", role: "user", content: t("assistant.suggestions.lowStock"), status: "done", steps: [], links: [] },
    { id: "a2", role: "assistant", content: "", status: "error", error: "network", steps: [], links: [], question: t("assistant.suggestions.lowStock") },
  ];
  const suggestions = (["salesToday", "debtors", "lowStock", "financeSummary"] as const).map((id) => ({ id, label: t(`assistant.suggestions.${id}`) }));

  const preview = (body: React.ReactNode, avatar: (typeof AVATAR_STATES)[number], composer: React.ReactNode) => (
    <div className="ds-assistant-panel" data-layout="preview">
      <AssistantPanelHeader
        t={t}
        avatarState={avatar}
        title={<h2 className="ds-assistant-title">{t("assistant.title")}</h2>}
        subtitle={t("assistant.contextSale", { number: "SS-2026-00123" })}
        historyOpen={false}
        onNewChat={noop}
        onToggleHistory={noop}
        closeButton={<IconButton label={t("assistant.close")} icon={<X className="h-5 w-5" />} side="bottom" />}
      />
      <div className="ds-assistant-body" data-assistant-scroll="">
        {body}
      </div>
      {composer}
    </div>
  );

  const composer = (chips: boolean) => (
    <AssistantComposer
      value={draft}
      onChange={setDraft}
      onSend={noop}
      onStop={noop}
      streaming={false}
      t={t}
      locale={locale}
      contextLabel={t("assistant.contextSale", { number: "SS-2026-00123" })}
      onRemoveContext={noop}
      suggestions={chips ? suggestions.filter((s) => s.id === "salesToday" || s.id === "financeSummary") : []}
      onSuggestion={noop}
      onFocusChange={noop}
    />
  );

  return (
    <DesignScope theme={scopeTheme} className={fontClassName}>
      <ToastProvider closeLabel={t("uiUnified.dialog.close")}>
        <main className="ds-avatar-review min-h-dvh" style={{ padding: "var(--ds-space-6)" }}>
          <PageHeader title={t("assistant.dev.title")} description={t("assistant.dev.description")} eyebrow={false} />

          <Section title={t("assistant.dev.states")}>
            <div className="ds-avatar-grid" data-review="states">
              {AVATAR_STATES.map((state) => (
                <div key={state} className="ds-avatar-cell" data-state={state}>
                  <div className="ds-avatar-sizes">
                    {AVATAR_SIZES.map((size) => (
                      <AssistantAvatar key={size} state={state} size={size} />
                    ))}
                  </div>
                  <span className="text-center text-[length:var(--ds-text-xs)] ds-muted">{t(avatarLabelKey(state))}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title={t("assistant.dev.reduced")}>
            <div className="ds-avatar-grid" data-review="reduced">
              {AVATAR_STATES.map((state) => (
                <div key={state} className="ds-avatar-cell">
                  <AssistantAvatar state={state} size={56} reducedMotion />
                  <span className="text-center text-[length:var(--ds-text-xs)] ds-muted">{t(avatarLabelKey(state))}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title={t("assistant.dev.panel")}>
            <div className="ds-assistant-previews" data-review="panel">
              {preview(<AssistantEmptyState t={t} avatarState="idle" name="Aysel" suggestions={suggestions} onSuggestion={noop} />, "idle", composer(false))}
              {preview(<AssistantThread messages={demo} t={t} busy={false} onRetry={noop} onCopy={noop} />, "alert", composer(true))}
            </div>
          </Section>
        </main>
      </ToastProvider>
    </DesignScope>
  );
}
