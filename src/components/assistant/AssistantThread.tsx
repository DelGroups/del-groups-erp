"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { AlertCircle, Check, ChevronRight, Copy, Loader2, RotateCcw, X } from "lucide-react";
import { Button, IconButton } from "@/design-system/components";
import { AiAssistantMarkdown } from "@/components/ai/AiAssistantMarkdown";
import { canRetry, errorKey, type ThreadMessage } from "@/lib/assistant/ui/thread";

type T = (key: string, params?: Record<string, string | number>) => string;

export interface AssistantThreadProps {
  messages: ThreadMessage[];
  t: T;
  onRetry: (assistantId: string) => void;
  onCopy: (text: string) => void;
  /** A link in a reply was followed (phones close the sheet). */
  onNavigate?: () => void;
  /** Busy: Retry waits until the current reply ends. */
  busy: boolean;
}

/**
 * The conversation (AST-2): the user's questions on the end side, the assistant's replies as plain
 * text on the panel (no bubble), each with the tools it used ("What I looked at"), internal links,
 * Copy, and an error in plain words with Retry when trying again can help.
 */
export function AssistantThread({ messages, t, onRetry, onCopy, onNavigate, busy }: AssistantThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const followed = useRef(false);
  const last = messages[messages.length - 1];
  const tail = `${messages.length}:${last?.content.length ?? 0}:${last?.steps.length ?? 0}:${last?.status ?? ""}`;

  // Tables in replies are read-only text: keep the app's global column resizer off them.
  useEffect(() => {
    boxRef.current?.querySelectorAll(".ds-assistant-md table:not([data-col-resize])").forEach((el) => el.setAttribute("data-col-resize", "off"));
  }, [tail]);

  // Follow the reply while the user is at the bottom; leave them alone when they scrolled up to read.
  useEffect(() => {
    const scroller = boxRef.current?.closest<HTMLElement>("[data-assistant-scroll]");
    if (!scroller) return;
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    // A chat opened from the history starts at its latest message.
    const first = !followed.current;
    followed.current = true;
    if (first || nearBottom || last?.role === "user") scroller.scrollTop = scroller.scrollHeight;
  }, [tail, last?.role]);

  return (
    <div ref={boxRef} className="ds-assistant-thread" role="log" aria-live="off" aria-label={t("assistant.title")}>
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="ds-assistant-msg" data-role="user">
            <span className="sr-only">{t("assistant.you")}: </span>
            <p className="ds-assistant-user-text">{m.content}</p>
          </div>
        ) : (
          <div key={m.id} className="ds-assistant-msg" data-role="assistant" data-status={m.status} aria-busy={m.status === "streaming" || undefined}>
            {m.steps.length > 0 ? (
              <details className="ds-assistant-steps">
                <summary>
                  <ChevronRight className="ds-assistant-steps-chevron h-4 w-4" aria-hidden />
                  <span className="truncate">{t("assistant.stepsTitle", { count: m.steps.length })}</span>
                </summary>
                <ul>
                  {m.steps.map((s, i) => (
                    <li key={`${s.tool}-${i}`} data-ok={s.ok === null ? "running" : String(s.ok)}>
                      {s.ok === null ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : s.ok ? (
                        <Check className="h-4 w-4" aria-hidden />
                      ) : (
                        <X className="h-4 w-4" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1 truncate" title={s.summary}>
                        {s.summary}
                      </span>
                      {s.ok === null ? <span className="sr-only">{t("assistant.stepRunning")}</span> : s.ok ? null : <span className="sr-only">{t("assistant.stepFailed")}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {m.content ? (
              <div
                className="ds-assistant-md"
                onClick={(e) => {
                  if ((e.target as Element).closest("a")) onNavigate?.();
                }}
              >
                <AiAssistantMarkdown content={m.content} />
              </div>
            ) : m.status === "streaming" ? (
              <div className="ds-assistant-typing" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            ) : null}

            {m.status === "stopped" ? <p className="ds-assistant-note">{t("assistant.stopped")}</p> : null}

            {m.status === "error" && m.error ? (
              <div className="ds-assistant-error" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                <p>{t(errorKey(m.error))}</p>
              </div>
            ) : null}

            {m.links.length > 0 ? (
              <div className="ds-assistant-links">
                {m.links.map((l) => (
                  <Link key={l.href} href={l.href} className="ds-assistant-link" onClick={onNavigate} title={l.label}>
                    <span className="truncate">{l.label}</span>
                  </Link>
                ))}
              </div>
            ) : null}

            {m.status !== "streaming" ? (
              <div className="ds-assistant-msg-actions">
                {m.content && m.status !== "error" ? <IconButton size="sm" label={t("assistant.copy")} icon={<Copy className="h-4 w-4" />} onClick={() => onCopy(m.content)} /> : null}
                {(m.status === "error" && canRetry(m.error)) || m.status === "stopped" ? (
                  <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy} onClick={() => onRetry(m.id)}>
                    {t("assistant.retry")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      )}
      <div ref={endRef} />
    </div>
  );
}
