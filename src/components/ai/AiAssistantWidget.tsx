"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { AiAssistantMarkdown, isSafeInternalHref } from "@/components/ai/AiAssistantMarkdown";

type AssistantLink = { label: string; href: string };
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  links?: AssistantLink[];
};

export default function AiAssistantWidget() {
  const { user, can } = useAuth();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chips = useMemo(() => {
    const items: Array<{ id: string; label: string; prompt: string }> = [];
    if (can("can_view_finance")) {
      items.push({
        id: "finance",
        label: t("aiAssistant.chipFinance"),
        prompt: t("aiAssistant.chipFinance"),
      });
    }
    if (can("can_view_products")) {
      items.push({
        id: "stock",
        label: t("aiAssistant.chipStock"),
        prompt: t("aiAssistant.chipStock"),
      });
    }
    if (can("can_view_production")) {
      items.push({
        id: "production",
        label: t("aiAssistant.chipProduction"),
        prompt: t("aiAssistant.chipProduction"),
      });
    }
    return items;
  }, [can, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  useEffect(() => {
    if (!open || configured !== null || !user) return;
    let cancelled = false;
    fetch("/api/ai-assistant", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { configured?: boolean };
        if (!cancelled) setConfigured(Boolean(payload.configured));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, configured, user]);

  const sendMessage = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || sending) return;

      const history = messages
        .slice(-8)
        .map((item) => ({ role: item.role, content: item.content }));
      setInput("");
      setError("");
      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setSending(true);

      try {
        const response = await fetch("/api/ai-assistant", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, locale, history }),
        });
        const payload = (await response.json()) as {
          reply?: string;
          links?: AssistantLink[];
          error?: string;
        };
        if (!response.ok || !payload.reply) {
          setError(payload.error || t("aiAssistant.error"));
          return;
        }
        const links = (payload.links || []).filter((link) => isSafeInternalHref(link.href));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: payload.reply || "", links },
        ]);
      } catch {
        setError(t("aiAssistant.error"));
      } finally {
        setSending(false);
      }
    },
    [locale, messages, sending, t]
  );

  if (!user) return null;

  return (
    <div className="print:hidden">
      {!open && (
        <button
          type="button"
          aria-label={t("aiAssistant.open")}
          onClick={() => setOpen(true)}
          className="btn-primary fixed bottom-5 right-5 z-[60] h-14 w-14 rounded-full p-0 shadow-lg md:bottom-6 md:right-6"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {open && (
        <>
          <button
            type="button"
            aria-label={t("aiAssistant.close")}
            className="app-scrim fixed inset-0 z-[65]"
            onClick={() => setOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={t("aiAssistant.title")}
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col border-l border-app bg-app shadow-2xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-app px-4 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-app-card-hover text-sky-500">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-app">{t("aiAssistant.title")}</h2>
                  <p className="text-[11px] text-app-muted">{t("aiAssistant.subtitle")}</p>
                </div>
              </div>
              <button
                type="button"
                aria-label={t("aiAssistant.close")}
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            {configured === false && (
              <p className="border-b border-app bg-app-card px-4 py-2 text-[11px] text-app-muted">
                {t("aiAssistant.notConfigured")}
              </p>
            )}

            <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <p className="text-sm text-app-muted">{t("aiAssistant.empty")}</p>
              )}
              {messages.map((item, index) => (
                <div
                  key={`${item.role}-${index}`}
                  className={item.role === "user" ? "ml-8" : "mr-4"}
                >
                  <div
                    className={
                      item.role === "user"
                        ? "rounded-2xl bg-app-card-hover px-3 py-2 text-[13px] text-app"
                        : "app-card px-3 py-3"
                    }
                  >
                    {item.role === "assistant" ? (
                      <AiAssistantMarkdown content={item.content} />
                    ) : (
                      <p className="whitespace-pre-wrap">{item.content}</p>
                    )}
                  </div>
                  {item.role === "assistant" && item.links && item.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.links.slice(0, 8).map((link) => (
                        <Link
                          key={`${link.href}-${link.label}`}
                          href={link.href}
                          onClick={() => setOpen(false)}
                          className="rounded-full border border-app bg-app-card px-2.5 py-1 text-[11px] font-semibold text-app hover:bg-app-card-hover"
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <p className="text-xs text-app-muted">{t("aiAssistant.thinking")}</p>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-app px-4 py-2">
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendMessage(chip.prompt)}
                    className="rounded-full border border-app bg-app-card px-2.5 py-1 text-[11px] font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}

            <form
              className="flex items-end gap-2 border-t border-app p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(input);
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                maxLength={1200}
                disabled={sending}
                placeholder={t("aiAssistant.placeholder")}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage(input);
                  }
                }}
                className="app-input min-h-10 max-h-28 flex-1 resize-none text-sm"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="btn-primary h-10 w-10 shrink-0 rounded-xl p-0"
                aria-label={t("aiAssistant.send")}
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}
