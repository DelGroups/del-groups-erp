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
import { WatchReview } from "./WatchReview";

/** The review page of the avatar and the panel (AST-2); sample content only, nothing is sent anywhere. */
export default function AvatarReview({ fontClassName, theme, voiceServer = false }: { fontClassName?: string; theme?: "light" | "dark"; voiceServer?: boolean }) {
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
  // AST-4: a draft the assistant prepared, as the user sees it before confirming (sample; nothing is saved).
  const saleLine = { product_id: "p1", product_code: "QP-01", product_name: "Qara panel 2,8 m", unit: "Ədəd", quantity: 2, unit_price: 30, discount_percent: 0, vat_rate: 18, net: 60, vat: 10.8, total: 70.8 };
  const proposalDemo: ThreadMessage[] = [
    { id: "u3", role: "user", content: t("assistant.dev.demoInvoice"), status: "done", steps: [], links: [] },
    {
      id: "a3",
      role: "assistant",
      content: t("assistant.dev.demoInvoiceAnswer"),
      status: "done",
      steps: [{ tool: "search_customers", summary: "Test", ok: true }],
      links: [],
      proposals: [
        {
          id: "demo",
          kind: "sale_draft",
          summary: "Sale draft for Test",
          amount: 70.8,
          payload: { customer_id: "c1", customer_name: "Test", doc_date: "2026-11-15", warehouse_id: null, warehouse_name: "Əsas anbar", note: "", lines: [saleLine], subtotal: 60, vat_total: 10.8, total: 70.8 },
          hash: "0".repeat(64),
          secondConfirm: false,
          limit: 10000,
        },
      ],
    },
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
      voiceServer={voiceServer}
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
              {preview(<AssistantThread messages={proposalDemo} t={t} locale={locale} busy={false} onRetry={noop} onCopy={noop} />, "success", composer(false))}
            </div>
          </Section>
          <Section title={t("assistant.dev.insights")}>
            <div className="ds-assistant-previews" data-review="insights">
              {preview(
                <>
                  <p className="ds-assistant-note">{t("assistant.insights.briefingLabel")}</p>
                  <AssistantThread
                    messages={[{ id: "b1", role: "assistant", content: t("assistant.dev.demoBriefing"), status: "done", steps: [], links: [] }]}
                    t={t}
                    locale={locale}
                    busy={false}
                    onRetry={noop}
                    onCopy={noop}
                  />
                </>,
                "success",
                composer(false)
              )}
              {preview(
                <AssistantThread
                  messages={[
                    { id: "q1", role: "user", content: t("assistant.dev.demoAnalysisQuestion"), status: "done", steps: [], links: [] },
                    {
                      id: "a1",
                      role: "assistant",
                      content: t("assistant.dev.demoAnalysisAnswer"),
                      status: "done",
                      steps: [{ tool: "sales_compare", summary: t("assistant.dev.demoAnalysisStep"), ok: true }],
                      links: [{ label: "Satışlar", href: "/sales" }],
                    },
                  ]}
                  t={t}
                  locale={locale}
                  busy={false}
                  onRetry={noop}
                  onCopy={noop}
                />,
                "idle",
                composer(true)
              )}
            </div>
          </Section>

          <Section title={t("assistant.dev.watch")} description={t("assistant.dev.watchDescription")}>
            <WatchReview t={t} />
          </Section>
        </main>
      </ToastProvider>
    </DesignScope>
  );
}
