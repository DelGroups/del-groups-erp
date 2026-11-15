"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AvatarEvent } from "@/lib/assistant/ui/avatar";
import {
  applyStreamEvent,
  messagesFromHistory,
  readEventStream,
  reasonFromResponse,
  stopMessage,
  type ErrorReason,
  type PageContext,
  type ThreadMessage,
} from "@/lib/assistant/ui/thread";

let seq = 0;
const nextId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface AssistantChat {
  messages: ThreadMessage[];
  conversationId: string | null;
  streaming: boolean;
  loading: boolean;
  send: (question: string, context: PageContext | null) => Promise<void>;
  stop: () => void;
  retry: (assistantId: string, context: PageContext | null) => void;
  reset: () => void;
  load: (conversationId: string) => Promise<boolean>;
}

/**
 * One conversation with /api/assistant/chat (AST-1 stream): sends a question with the page context,
 * renders the reply as it streams, and tells the avatar what is happening.
 */
export function useAssistantChat(options: { locale: string; onAvatar: (e: AvatarEvent) => void }): AssistantChat {
  const { locale, onAvatar } = options;
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef<string | null>(null);
  const avatarRef = useRef(onAvatar);
  useEffect(() => {
    avatarRef.current = onAvatar;
  }, [onAvatar]);
  useEffect(() => {
    convRef.current = conversationId;
  }, [conversationId]);
  const messagesRef = useRef<ThreadMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const fail = useCallback((id: string, reason: ErrorReason) => {
    setMessages((prev) => applyStreamEvent(prev, id, { type: "error", reason: reason as "budget", message: "" }));
    avatarRef.current({ type: "fail", budget: reason === "budget" });
  }, []);

  const run = useCallback(
    async (question: string, context: PageContext | null, assistantId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      avatarRef.current({ type: "send" });
      let sawDelta = false;
      let ended = false;
      try {
        const response = await fetch("/api/assistant/chat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ message: question, conversationId: convRef.current, locale, context }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
          fail(assistantId, reasonFromResponse(response.status, body));
          ended = true;
          return;
        }
        await readEventStream(response.body, (event) => {
          if (event.type === "start" && event.conversationId) {
            convRef.current = event.conversationId;
            setConversationId(event.conversationId);
          }
          if (event.type === "text_delta" && !sawDelta) {
            sawDelta = true;
            avatarRef.current({ type: "delta" });
          }
          setMessages((prev) => applyStreamEvent(prev, assistantId, event));
          if (event.type === "done") {
            ended = true;
            if (event.conversationId) setConversationId(event.conversationId);
            avatarRef.current({ type: "done" });
          }
          if (event.type === "error") {
            ended = true;
            avatarRef.current({ type: "fail", budget: event.reason === "budget" });
          }
        });
        // The stream closed without a last word: say so instead of leaving the reply spinning.
        if (!ended) fail(assistantId, "unavailable");
      } catch (err) {
        if (controller.signal.aborted) {
          setMessages((prev) => stopMessage(prev, assistantId));
          avatarRef.current({ type: "stop" });
        } else if (!ended) {
          fail(assistantId, err instanceof TypeError ? "network" : "unavailable");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setStreaming(false);
      }
    },
    [fail, locale]
  );

  const send = useCallback(
    async (raw: string, context: PageContext | null) => {
      const question = raw.trim();
      if (!question || abortRef.current) return;
      const assistantId = nextId("a");
      setMessages((prev) => [
        ...prev,
        { id: nextId("u"), role: "user", content: question, status: "done", steps: [], links: [] },
        { id: assistantId, role: "assistant", content: "", status: "streaming", steps: [], links: [], question },
      ]);
      await run(question, context, assistantId);
    },
    [run]
  );

  const retry = useCallback(
    (assistantId: string, context: PageContext | null) => {
      if (abortRef.current) return;
      const question = messagesRef.current.find((x) => x.id === assistantId)?.question ?? "";
      if (!question) return;
      setMessages((prev) => prev.map((x) => (x.id === assistantId ? { ...x, content: "", status: "streaming", steps: [], links: [], error: undefined } : x)));
      void run(question, context, assistantId);
    },
    [run]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    convRef.current = null;
  }, []);

  const load = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setLoading(true);
    try {
      const response = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { credentials: "same-origin" });
      if (!response.ok) return false;
      const body = (await response.json()) as { messages?: Array<Record<string, unknown>> };
      setMessages(messagesFromHistory(body.messages ?? []));
      setConversationId(id);
      convRef.current = id;
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { messages, conversationId, streaming, loading, send, stop, retry, reset, load };
}
