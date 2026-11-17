"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { safeLinks, type ThreadMessage } from "@/lib/assistant/ui/thread";

export interface MorningBriefing {
  id: string;
  day: string;
  body: string;
  all_well: boolean;
  links: Array<{ label: string; href: string }>;
  seen_at: string | null;
}

/** The briefing as the first assistant message of the day (only internal links survive). */
export function briefingMessage(b: MorningBriefing): ThreadMessage {
  return { id: `briefing-${b.id}`, role: "assistant", content: b.body, status: "done", steps: [], links: safeLinks(b.links) };
}

/**
 * Today's morning briefing (AST-6), fetched once when the panel first opens. Marked read the first time it
 * is shown; it stays the first message of the day until the user starts a chat.
 */
export function useMorningBriefing(input: { active: boolean; open: boolean; onAllWell: () => void }) {
  const { active, open, onAllWell } = input;
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const asked = useRef(false);
  const seen = useRef<string | null>(null);
  const allWell = useRef(onAllWell);
  useEffect(() => {
    allWell.current = onAllWell;
  }, [onAllWell]);

  useEffect(() => {
    if (!active || !open || asked.current) return;
    asked.current = true;
    void fetch("/api/assistant/briefing")
      .then(async (res) => (res.ok ? ((await res.json()) as { briefing?: MorningBriefing | null }) : null))
      .then((body) => {
        if (body?.briefing && typeof body.briefing.body === "string") setBriefing(body.briefing);
      })
      .catch(() => undefined);
  }, [active, open]);

  useEffect(() => {
    if (!briefing || !open || seen.current === briefing.id) return;
    seen.current = briefing.id;
    if (briefing.all_well) allWell.current();
    if (!briefing.seen_at) {
      void fetch("/api/assistant/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: briefing.id }) }).catch(() => undefined);
    }
  }, [briefing, open]);

  const message = useMemo(() => (briefing ? briefingMessage(briefing) : null), [briefing]);
  return { briefing, message };
}
