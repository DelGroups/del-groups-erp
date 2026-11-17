"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { getSupabaseClient } from "@/lib/supabase";
import { bakuToday, contextKey, emptyWatchContext, parseWatchContext } from "@/lib/assistant/watch/context";
import { loadSavedDocumentFindings, loadWatchContext } from "@/lib/assistant/watch/loadContext";
import {
  checkDraft,
  createDebouncer,
  EMPTY_WATCH_MEMORY,
  ignoreIssue,
  issueId,
  issueKey,
  visibleIssues,
  WATCH_DEBOUNCE_MS,
  worstSeverity,
  type DocumentDraft,
  type DraftPatch,
  type WatchContext,
  type WatchIssue,
  type WatchMemory,
} from "@/lib/assistant/watch/rules";
import { draftHash, summarizeDraft, unusualSignals, WATCH_AI_IDLE_MS } from "@/lib/assistant/watch/unusual";
import { useAssistantUi } from "./AssistantProvider";

type WatchAction = "shown" | "fixed" | "ignored" | "why";

/**
 * The active watch on a form (AST-5). The form passes its draft (built from its own state) and a function
 * that applies a fix through its own setters; the form stays the source of truth and nothing is written to
 * the database except the user's own watch events. Rules run in the browser 400 ms after the last change;
 * the first visible warning shows in the bubble next to the avatar, and the avatar turns amber or red.
 * With the assistant off (ASSISTANT_V2, audience) this does nothing.
 */
export function useAssistantWatch(input: { formId: string; draft: DocumentDraft; applyPatch: (patch: DraftPatch) => void; enabled?: boolean }) {
  const ui = useAssistantUi();
  const { t, locale } = useI18n();
  const { formId, draft, applyPatch } = input;
  const active = ui.active && input.enabled !== false;
  const [ctx, setCtx] = useState<WatchContext>(() => emptyWatchContext(bakuToday()));
  const [memory, setMemory] = useState<WatchMemory>(EMPTY_WATCH_MEMORY);
  const [issues, setIssues] = useState<WatchIssue[]>([]);
  const shown = useRef(new Set<string>());
  const applyRef = useRef(applyPatch);
  useEffect(() => {
    applyRef.current = applyPatch;
  }, [applyPatch]);

  // The form's facts, read again when the partner or the set of products changes.
  const productIds = useMemo(() => draft.lines.map((l) => l.productId).filter((id): id is string => !!id), [draft.lines]);
  const key = contextKey(draft.docType, draft.partnerId, productIds);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadWatchContext(draft.docType, draft.partnerId, productIds)
      .then((raw) => {
        if (!cancelled) setCtx(raw ? parseWatchContext(raw, bakuToday()) : emptyWatchContext(bakuToday()));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The key holds docType, partner and products.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);

  const log = useCallback(
    (code: string, action: WatchAction) => {
      void getSupabaseClient()
        .from("assistant_watch_events" as never)
        .insert({ form: formId, doc_type: draft.docType, code, action } as never)
        .then(() => undefined, () => undefined);
    },
    [formId, draft.docType]
  );

  // The rules, 400 ms after the last change.
  const debouncer = useMemo(
    () => createDebouncer<{ d: DocumentDraft; c: WatchContext }>(({ d, c }) => setIssues(checkDraft(d, c)), WATCH_DEBOUNCE_MS, { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) }),
    []
  );
  const draftKey = JSON.stringify(draft);
  useEffect(() => {
    if (!active) return;
    debouncer.push({ d: draft, c: ctx });
    // draftKey stands for the draft's content (the form rebuilds the object on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, draftKey, ctx, debouncer]);
  useEffect(() => () => debouncer.cancel(), [debouncer]);

  // Layer 2: Claude only when the rules cannot judge (a product this partner never had, a quantity far
  // from the usual). Asked once per draft, after the user stops typing; the server rate-limits and caches.
  const [aiNotes, setAiNotes] = useState<Record<string, string | null>>({});
  const unusual = useMemo(() => {
    const signals = unusualSignals(draft, ctx);
    if (!signals.length) return null;
    const summary = summarizeDraft(draft, ctx, signals);
    return { summary, hash: draftHash(summary) };
    // draftKey stands for the draft's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, ctx]);
  useEffect(() => {
    if (!active || !unusual || unusual.hash in aiNotes) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/assistant/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form: formId, locale, summary: unusual.summary }),
      })
        .then(async (res) => {
          if (!res.ok) return; // 429 or off: the next change tries again
          const body = (await res.json()) as { note?: string | null };
          setAiNotes((m) => ({ ...m, [unusual.hash]: typeof body.note === "string" ? body.note : null }));
        })
        .catch(() => undefined);
    }, WATCH_AI_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, unusual, aiNotes, formId, locale]);
  const aiNote = unusual ? aiNotes[unusual.hash] : null;

  const visible = useMemo(() => {
    const all: WatchIssue[] = aiNote ? [...issues, { code: "ai_note", severity: "warning", lineIndex: null, params: { text: aiNote } }] : issues;
    return visibleIssues(all, memory);
  }, [issues, memory, aiNote]);

  // Log each warning once per form when it first shows.
  useEffect(() => {
    for (const i of visible) {
      const id = issueId(i);
      if (shown.current.has(id)) continue;
      shown.current.add(id);
      log(i.code, "shown");
    }
  }, [visible, log]);

  const fix = useCallback(
    (issue: WatchIssue) => {
      if (!issue.fix) return;
      applyRef.current(issue.fix);
      log(issue.code, "fixed");
    },
    [log]
  );
  const ignore = useCallback(
    (issue: WatchIssue) => {
      setMemory((m) => ignoreIssue(m, issue));
      log(issue.code, "ignored");
    },
    [log]
  );
  const { ask, setWatch, dispatchAvatar } = ui;
  const why = useCallback(
    (issue: WatchIssue) => {
      log(issue.code, "why");
      ask(t("assistant.watch.whyQuestion", { issue: t(issueKey(issue.code), issue.params) }));
    },
    [ask, log, t]
  );

  // Publish to the bubble and the avatar.
  useEffect(() => {
    if (!active) {
      setWatch(null);
      return;
    }
    setWatch(visible.length ? { formId, issues: visible, fix, ignore, why } : null);
    const worst = worstSeverity(visible);
    dispatchAvatar(worst ? { type: "issue", severity: worst } : { type: "clear_issue" });
  }, [active, visible, formId, fix, ignore, why, setWatch, dispatchAvatar]);
  useEffect(
    () => () => {
      setWatch(null);
      dispatchAvatar({ type: "clear_issue" });
    },
    [setWatch, dispatchAvatar]
  );

  return { issues: visible };
}

/** How often, and for how long, a saved document is checked for new guard findings (polling; no Realtime). */
export const SAVED_POLL_MS = 60_000;
export const SAVED_POLL_FOR_MS = 15 * 60_000;

/**
 * After the user saves a document: ask every minute for 15 minutes whether the Accounting Guard found
 * something on it (only the person who saved it, or an admin, can see that). The avatar then says
 * "The document you just saved has a problem" with a link.
 */
export function useSavedDocumentWatch(input: { entityType: "sale" | "purchase"; entityId: string | null; docNo: string; href: string }) {
  const ui = useAssistantUi();
  const { active, setSavedNotice, dispatchAvatar } = ui;
  const { entityType, entityId, docNo, href } = input;
  useEffect(() => {
    if (!active || !entityId) return;
    const started = Date.now();
    let stopped = false;
    const check = async () => {
      if (stopped || Date.now() - started > SAVED_POLL_FOR_MS) return;
      const findings = await loadSavedDocumentFindings(entityType, entityId).catch(() => []);
      if (stopped || !findings.length) return;
      stopped = true;
      setSavedNotice({ docNo: findings[0].doc_no || docNo, href, rules: [...new Set(findings.map((f) => f.rule_code))] });
      dispatchAvatar({ type: "issue", severity: findings.some((f) => f.severity === "critical" || f.severity === "high") ? "error" : "warning" });
    };
    const timer = window.setInterval(() => void check(), SAVED_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, entityType, entityId, docNo, href, setSavedNotice, dispatchAvatar]);
}
