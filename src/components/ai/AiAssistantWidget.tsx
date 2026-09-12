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
import {
  DEFAULT_ERP_AGENT,
  ERP_AI_AGENTS,
  formatAgentOption,
  resolveTargetAgent,
  type ErpAiAgentId,
} from "@/lib/ai/agents";

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

const AGENT_KEY = "del-erp-ai-agent";

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
  const [agent, setAgent] = useState<ErpAiAgentId>(DEFAULT_ERP_AGENT);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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
    if (!open) return;
    setAgent(DEFAULT_ERP_AGENT);
    const frame = window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, sending]);

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
        console.log("[AI Widget] bridge status:", response.status, "payload:", payload);
        if (response.status === 503) {
          setConfigured(false);
          if (init.method === "POST" && init.body && typeof init.body === "string") {
            const parsed = JSON.parse(init.body) as { type?: string; content?: string; message?: string };
            if ((parsed.type || "text") === "text" && (parsed.content || parsed.message)) {
              await fallbackText(parsed.content || parsed.message || "");
              return;
            }
          }
          setError(payload.error || t("aiAssistant.n8nMissing"));
          return;
        }
        if (!response.ok) {
          setError(payload.error || t("aiAssistant.error"));
          if (payload.reply) appendAssistant(payload);
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
            target_agent: agent,
            content: message,
          }),
        },
        message
      );
    },
    [agent, postBridge, recording, sending]
  );

  const sendVoice = useCallback(
    async (audioBase64: string) => {
      await postBridge(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "voice",
            target_agent: agent,
            audio_base64: audioBase64,
            current_page: pathname || "/",
          }),
        },
        t("aiAssistant.voiceNote"),
        "voice"
      );
    },
    [agent, pathname, postBridge, t]
  );

  const sendFile = useCallback(
    async (file: File) => {
      if (file.size > 8 * 1024 * 1024) {
        setError(t("aiAssistant.fileTooLarge"));
        return;
      }
      const form = new FormData();
      form.set("type", "file");
      form.set("target_agent", agent);
      form.set("current_page", pathname || "/");
      form.set("file", file);
      await postBridge({ method: "POST", body: form }, `📎 ${file.name}`, file.name);
    },
    [agent, pathname, postBridge, t]
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

  const selectedAgent = ERP_AI_AGENTS.find((item) => item.id === agent) ?? ERP_AI_AGENTS[0];
  const pillClass =
    "rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 hover:shadow-[0_0_12px_rgba(59,130,246,0.15)] disabled:opacity-50";

  if (!user) return null;

  return (
    <div className="print:hidden">
      {!open && (
        <button
          type="button"
          aria-label={t("aiAssistant.open")}
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/20 opacity-80 transition-all hover:opacity-100 hover:shadow-xl hover:shadow-indigo-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {open && (
        <>
          <button
            type="button"
            aria-label={t("aiAssistant.close")}
            className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={t("aiAssistant.title")}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200/80 bg-white shadow-2xl"
          >
            <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 px-4 py-4 text-white">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sky-300 ring-1 ring-white/15">
                    <Bot className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold">{t("aiAssistant.title")}</h2>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-sky-100 ring-1 ring-white/10">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        {t("aiAssistant.statusActive")}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-300">{t("aiAssistant.subtitle")}</p>
                    <label className="mt-3 block">
                      <span className="sr-only">{t("aiAssistant.selectAgent")}</span>
                      <select
                        aria-label={t("aiAssistant.selectAgent")}
                        value={agent}
                        onChange={(event) => {
                          const next = resolveTargetAgent(event.target.value);
                          setAgent(next);
                          sessionStorage.setItem(AGENT_KEY, next);
                        }}
                        className="w-full rounded-lg border border-white/15 bg-white/10 py-1.5 pl-2 pr-8 text-[11px] leading-tight text-white backdrop-blur-sm transition focus:border-sky-400/50 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
                      >
                        {ERP_AI_AGENTS.map((item) => (
                          <option key={item.id} value={item.id} className="text-slate-900">
                            {formatAgentOption(item)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="mt-1.5 text-[10px] text-slate-400">
                      {selectedAgent.emoji} {selectedAgent.role}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t("aiAssistant.close")}
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            {configured === false && (
              <p className="border-b border-amber-200/80 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">
                {t("aiAssistant.notConfigured")}
              </p>
            )}

            <div
              ref={listRef}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-slate-50 to-white px-4 py-4"
            >
              {messages.length === 0 && (
                <p className="text-sm text-slate-700">{t("aiAssistant.empty")}</p>
              )}
              {messages.map((item, index) => (
                <div
                  key={`${item.role}-${index}`}
                  className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={item.role === "user" ? "max-w-[85%]" : "max-w-[90%]"}>
                    <div
                      className={
                        item.role === "user"
                          ? "rounded-2xl rounded-tr-none bg-blue-600 px-4 py-2.5 text-[13px] text-white shadow-sm"
                          : "rounded-2xl rounded-tl-none border border-slate-200/80 bg-slate-100 px-4 py-2.5 text-[13px] text-slate-800 shadow-sm"
                      }
                    >
                      {item.role === "assistant" ? (
                        <div className="[&_a]:text-blue-600 [&_a]:underline-offset-2 [&_a]:hover:underline [&_code]:bg-white/70 [&_strong]:text-slate-900">
                          {item.content ? <AiAssistantMarkdown content={item.content} /> : null}
                          {item.table ? (
                            <div className="mt-2">
                              <AiAssistantTable headers={item.table.headers} rows={item.table.rows} />
                            </div>
                          ) : null}
                        </div>
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
                            className={pillClass}
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
                              className={pillClass}
                            >
                              {button.label}
                            </Link>
                          ) : (
                            <button
                              key={button.label}
                              type="button"
                              disabled={sending}
                              onClick={() => void sendMessage(button.message || button.label)}
                              className={pillClass}
                            >
                              {button.label}
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-xs text-slate-700">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500" />
                  </span>
                  {t("aiAssistant.thinking")}
                </div>
              )}
              {recording && (
                <p className="text-xs font-semibold text-red-500">{t("aiAssistant.recording")}</p>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
              <div ref={bottomRef} />
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-slate-200 bg-white px-4 py-2.5">
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    disabled={sending || recording}
                    onClick={() => void sendMessage(chip.prompt)}
                    className={pillClass}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}

            <form
              className="border-t border-slate-200 bg-white p-3"
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
              <div className="flex items-end gap-1 rounded-xl border border-slate-200 bg-white p-1.5 transition-shadow focus-within:ring-2 focus-within:ring-blue-500">
                <button
                  type="button"
                  disabled={sending || recording}
                  aria-label={t("aiAssistant.attach")}
                  onClick={() => fileRef.current?.click()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={sending}
                  aria-label={recording ? t("aiAssistant.stopRecording") : t("aiAssistant.record")}
                  onClick={() => void toggleRecording()}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-50 ${
                    recording
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-700"
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
                  className="min-h-9 max-h-28 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={sending || recording || !input.trim()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("aiAssistant.send")}
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}
