"use client";

import React from "react";
import { History, SquarePen } from "lucide-react";
import { Button, IconButton } from "@/design-system/components";
import type { AvatarState } from "@/lib/assistant/ui/avatar";
import { AssistantAvatar } from "./AssistantAvatar";

type T = (key: string, params?: Record<string, string | number>) => string;

/** The panel header: avatar 40, title, the context line, New chat, History, Close (AST-2). */
export function AssistantPanelHeader(props: {
  t: T;
  avatarState: AvatarState;
  /** The title element (the dialog title in the real panel). */
  title: React.ReactNode;
  subtitle: string | null;
  historyOpen: boolean;
  onNewChat: () => void;
  onToggleHistory: () => void;
  closeButton: React.ReactNode;
}) {
  const { t } = props;
  return (
    <header className="ds-assistant-header">
      <AssistantAvatar state={props.avatarState} size={40} />
      <div className="min-w-0 flex-1">
        {props.title}
        {props.subtitle ? (
          <p className="ds-assistant-subtitle truncate" title={props.subtitle}>
            {props.subtitle}
          </p>
        ) : null}
      </div>
      <div className="ds-assistant-header-actions">
        <IconButton label={t("assistant.newChat")} icon={<SquarePen className="h-5 w-5" />} onClick={props.onNewChat} side="bottom" />
        <IconButton
          label={props.historyOpen ? t("assistant.backToChat") : t("assistant.history")}
          icon={<History className="h-5 w-5" />}
          aria-pressed={props.historyOpen}
          onClick={props.onToggleHistory}
          side="bottom"
        />
        {props.closeButton}
      </div>
    </header>
  );
}

/** First screen of a new chat: avatar 56, a greeting with the first name, 3–4 suggestions for the page and role. */
export function AssistantEmptyState(props: {
  t: T;
  avatarState: AvatarState;
  name: string;
  suggestions: Array<{ id: string; label: string }>;
  onSuggestion: (label: string) => void;
}) {
  const { t } = props;
  return (
    <div className="ds-assistant-empty">
      <AssistantAvatar state={props.avatarState} size={56} decorative />
      <p className="ds-assistant-greeting">{props.name ? t("assistant.greeting", { name: props.name }) : t("assistant.greetingNoName")}</p>
      <p className="ds-muted">{t("assistant.greetingHint")}</p>
      {props.suggestions.length > 0 ? (
        <ul className="ds-assistant-suggestions">
          {props.suggestions.map((s) => (
            <li key={s.id}>
              <Button variant="secondary" size="sm" className="ds-assistant-suggestion" onClick={() => props.onSuggestion(s.label)}>
                <span className="truncate">{s.label}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
