"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Mic, Paperclip, Send, Sparkles, Square, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  AiAssistantMarkdown,
  AiAssistantTable,
  isSafeInternalHref,
} from "@/components/ai/AiAssistantMarkdown";
import type { AssistantLink } from "@/lib/ai/context";

type DynamicButton = { label: string; href?: string; message?: string };
type DataTable = { headers: string[]; rows: string[][] };
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  links?: AssistantLink[];
  buttons?: DynamicButton[];
  table?: DataTable;
  attachment?: string;
};

type BridgeResponse = {
  reply?: string;
  links?: AssistantLink[];
  buttons?: DynamicButton[];
  table?: DataTable;
  error?: string;
  configured?: boolean;
};

const SESSION_KEY = "del-erp-ai-session";

function getSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(blob);
  });
}

export default function AiAssistantWidget() {
  const { user, can } = useAuth();
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<number>(0);

  const chips = useMemo(() => {
    const items: Array<{ id: string; label: string; prompt: string }> = [];
    if (can("can_view_finance")) {
      items.push({ id: "finance", label: t("aiAssistant.chipFinance"), prompt: t("aiAssistant.chipFinance") });
    }
    if (can("can_view_products")) {
      items.push({ id: "stock", label: t("aiAssistant.chipStock"), prompt: t("aiAssistant.chipStock") });
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

  const stopMedia = useCallback(() => {
    if (recordTimerRef.current) {
      window.clearTimeout(recordTimerRef.current);
      recordTimerRef.current = 0;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  }, []);

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

  useEffect(() => () => stopMedia(), [stopMedia]);

  useEffect(() => {
    if (!open || configured !== null || !user) return;
    let cancelled = false;
    fetch("/api/ai/n8n-bridge", { credentials: "same-origin" })
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

  const appendAssistant = useCallback((payload: BridgeResponse) => {
    const links = (payload.links || []).filter((link) => isSafeInternalHref(link.href));
    const buttons = (payload.buttons || []).filter((button) => button.label);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: payload.reply || "",
        links,
        buttons,
        table: payload.table,
      },
    ]);
  }, []);

  const fallbackText = useCallback(
    async (message: string) => {
      const history = messages.slice(-8).map((item) => ({ role: item.role, content: item.content }));
      const response = await fetch("/api/ai-assistant", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, locale, history }),
      });
      const payload = (await response.json()) as BridgeResponse;
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || t("aiAssistant.error"));
      }
      appendAssistant(payload);
    },
    [appendAssistant, locale, messages, t]
  );

  const postBridge = useCallback(
    async (init: RequestInit, userLabel: string, attachment?: string) => {
      setError("");
      setMessages((prev) => [...prev, { role: "user", content: userLabel, attachment }]);
      setSending(true);
      try {
        const response = await fetch("/api/ai/n8n-bridge", {
          credentials: "same-origin",
          ...init,
        });
        const payload = (await response.json()) as BridgeResponse;
        if (response.status === 503) {
          setConfigured(false);
          if (init.method === "POST" && init.body && typeof init.body === "string") {
            const parsed = JSON.parse(init.body) as { type?: string; message?: string };
            if ((parsed.type || "text") === "text" && parsed.message) {
              await fallbackText(parsed.message);
              return;
            }
          }
          setError(payload.error || t("aiAssistant.n8nMissing"));
          return;
        }
        if (!response.ok) {
          setError(payload.error || t("aiAssistant.error"));
          return;
        }
        setConfigured(true);
        appendAssistant(payload);
      } catch {
        setError(t("aiAssistant.error"));
      } finally {
        setSending(false);
      }
    },
    [appendAssistant, fallbackText, t]
  );

  const sendMessage = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || sending || recording) return;
      setInput("");
      await postBridge(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "text",
            message,
            session_id: getSessionId(),
            current_page: pathname || "/",
          }),
        },
        message
      );
    },
    [pathname, postBridge, recording, sending]
  );

  const sendVoice = useCallback(
    async (audioBase64: string) => {
      await postBridge(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "voice",
            audio_base64: audioBase64,
            session_id: getSessionId(),
            current_page: pathname || "/",
          }),
        },
        t("aiAssistant.voiceNote"),
        "voice"
      );
    },
    [pathname, postBridge, t]
  );

  const sendFile = useCallback(
    async (file: File) => {
      if (file.size > 8 * 1024 * 1024) {
        setError(t("aiAssistant.fileTooLarge"));
        return;
      }
      const form = new FormData();
      form.set("type", "file");
      form.set("session_id", getSessionId());
      form.set("current_page", pathname || "/");
      form.set("file", file);
      await postBridge({ method: "POST", body: form }, `📎 ${file.name}`, file.name);
    },
    [pathname, postBridge, t]
  );

  const toggleRecording = useCallback(async () => {
    if (sending) return;
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t("aiAssistant.voiceError"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stopMedia();
        if (blob.size < 64) return;
        void blobToBase64(blob).then((base64) => sendVoice(base64));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      recordTimerRef.current = window.setTimeout(() => recorder.stop(), 60_000);
    } catch {
      stopMedia();
      setError(t("aiAssistant.voiceError"));
    }
  }, [recording, sendVoice, sending, stopMedia, t]);

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
                      <>
                        {item.content ? <AiAssistantMarkdown content={item.content} /> : null}
                        {item.table ? (
                          <div className="mt-2">
                            <AiAssistantTable headers={item.table.headers} rows={item.table.rows} />
                          </div>
                        ) : null}
                      </>
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
                  {item.role === "assistant" && item.buttons && item.buttons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.buttons.map((button) =>
                        button.href ? (
                          <Link
                            key={`${button.label}-${button.href}`}
                            href={button.href}
                            onClick={() => setOpen(false)}
                            className="rounded-full border border-app bg-app-card px-2.5 py-1 text-[11px] font-semibold text-app hover:bg-app-card-hover"
                          >
                            {button.label}
                          </Link>
                        ) : (
                          <button
                            key={button.label}
                            type="button"
                            disabled={sending}
                            onClick={() => void sendMessage(button.message || button.label)}
                            className="rounded-full border border-app bg-app-card px-2.5 py-1 text-[11px] font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
                          >
                            {button.label}
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="mr-4 flex items-center gap-2 text-xs text-app-muted">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-app-accent [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-app-accent [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-app-accent" />
                  </span>
                  {t("aiAssistant.thinking")}
                </div>
              )}
              {recording && (
                <p className="text-xs font-semibold text-red-500">{t("aiAssistant.recording")}</p>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-app px-4 py-2">
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    disabled={sending || recording}
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
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void sendFile(file);
                }}
              />
              <button
                type="button"
                disabled={sending || recording}
                aria-label={t("aiAssistant.attach")}
                onClick={() => fileRef.current?.click()}
                className="btn-ghost h-10 w-10 shrink-0 rounded-xl p-0"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={sending}
                aria-label={recording ? t("aiAssistant.stopRecording") : t("aiAssistant.record")}
                onClick={() => void toggleRecording()}
                className={`h-10 w-10 shrink-0 rounded-xl p-0 ${
                  recording ? "btn-primary" : "btn-ghost"
                }`}
              >
                {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                maxLength={4000}
                disabled={sending || recording}
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
                disabled={sending || recording || !input.trim()}
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
