/**
 * The "unusual draft" check (AST-5, plan section 5, layer 2): Claude only when the rules cannot say it.
 * The browser asks only when a draft shows a signal the rules leave open (a product this partner has never
 * bought or sold, a quantity far from the usual); the server asks Haiku once per draft (cached by hash),
 * at most once every 20 seconds per user and form, inside the monthly budget. Pure helpers here; the
 * server side is in unusualServer.ts and the route is /api/assistant/watch.
 */
import { MIN_HISTORY, QUANTITY_FACTOR, type DocumentDraft, type WatchContext } from "./rules";

/** At most one call per user and form in this window. */
export const WATCH_AI_INTERVAL_MS = 20_000;
/** How long one answer is kept for the same draft. */
export const WATCH_AI_CACHE_MS = 30 * 60_000;
/** The browser waits this long after the last change before asking (the rules already ran at 400 ms). */
export const WATCH_AI_IDLE_MS = 2_500;
/** A partner needs this many earlier documents before "never had this product" means anything. */
export const RARE_MIN_DOCUMENTS = 5;
export const NOTE_MAX = 220;

export type UnusualSignal = { kind: "rare_product"; product: string } | { kind: "quantity_far"; product: string; quantity: number; usual: number };

/** What, in this draft, the rules cannot judge alone. Empty → no call. */
export function unusualSignals(draft: DocumentDraft, ctx: WatchContext): UnusualSignal[] {
  const out: UnusualSignal[] = [];
  const docs = ctx.partner?.documents ?? 0;
  for (const l of draft.lines) {
    if (!l.productId) continue;
    const facts = ctx.products[l.productId];
    if (!facts) continue;
    const times = facts.times ?? 0;
    if (docs >= RARE_MIN_DOCUMENTS && times === 0) out.push({ kind: "rare_product", product: l.productName });
    const usual = Number(facts.usual_qty);
    if (times >= MIN_HISTORY && usual > 0 && l.quantity > 0 && (l.quantity >= usual * QUANTITY_FACTOR || l.quantity * QUANTITY_FACTOR <= usual)) {
      out.push({ kind: "quantity_far", product: l.productName, quantity: l.quantity, usual: Math.round(usual * 100) / 100 });
    }
  }
  return out.slice(0, 5);
}

/** What the server receives: no ids, no prices of other partners; just enough to judge this draft. */
export interface DraftSummary {
  docType: "sale" | "purchase";
  date: string | null;
  partnerDocuments: number;
  partnerMedianTotal: number | null;
  total: number;
  lines: Array<{ product: string; quantity: number; unit: string; unitPrice: number; usualPrice: number | null; usualQty: number | null; times: number }>;
  signals: UnusualSignal[];
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function summarizeDraft(draft: DocumentDraft, ctx: WatchContext, signals: UnusualSignal[]): DraftSummary {
  return {
    docType: draft.docType,
    date: draft.date,
    partnerDocuments: ctx.partner?.documents ?? 0,
    partnerMedianTotal: ctx.partner?.median_total ?? null,
    total: Math.round(draft.total * 100) / 100,
    lines: draft.lines.slice(0, 30).map((l) => {
      const f = (l.productId && ctx.products[l.productId]) || {};
      return {
        product: clip(l.productName, 80),
        quantity: l.quantity,
        unit: clip(l.unit, 16),
        unitPrice: l.unitPrice,
        usualPrice: f.usual_price ?? null,
        usualQty: f.usual_qty ?? null,
        times: f.times ?? 0,
      };
    }),
    signals,
  };
}

/** Checks what the browser sent; anything odd → null (the route answers 400). */
export function parseDraftSummary(raw: unknown): DraftSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.docType !== "sale" && o.docType !== "purchase") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = (v: unknown, max: number) => (typeof v === "string" ? clip(v, max) : "");
  if (!Array.isArray(o.lines) || o.lines.length === 0 || o.lines.length > 30) return null;
  if (!Array.isArray(o.signals) || o.signals.length === 0 || o.signals.length > 5) return null;
  const lines = o.lines.map((x) => {
    const l = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return { product: s(l.product, 80), quantity: n(l.quantity) ?? 0, unit: s(l.unit, 16), unitPrice: n(l.unitPrice) ?? 0, usualPrice: n(l.usualPrice), usualQty: n(l.usualQty), times: n(l.times) ?? 0 };
  });
  const signals: UnusualSignal[] = [];
  for (const x of o.signals) {
    const g = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (g.kind === "rare_product") signals.push({ kind: "rare_product", product: s(g.product, 80) });
    else if (g.kind === "quantity_far") signals.push({ kind: "quantity_far", product: s(g.product, 80), quantity: n(g.quantity) ?? 0, usual: n(g.usual) ?? 0 });
  }
  if (!signals.length) return null;
  const date = typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
  return { docType: o.docType, date, partnerDocuments: n(o.partnerDocuments) ?? 0, partnerMedianTotal: n(o.partnerMedianTotal), total: n(o.total) ?? 0, lines, signals };
}

/** A stable hash of the summary (FNV-1a over its JSON): the same draft is never asked twice. */
export function draftHash(summary: DraftSummary): string {
  const text = JSON.stringify(summary);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const UNUSUAL_SYSTEM_PROMPT = [
  "You check one sales or purchase document that an employee of a small trading company in Azerbaijan is filling in.",
  "Rules in the software already caught prices below cost, stock, duplicates, credit limits and similar; you only judge the signals you are given (a product this partner never had, a quantity far from the usual).",
  "Say whether this is likely a mistake. Most of the time it is not: new products and big orders happen.",
  "Answer with JSON only: {\"unusual\": true|false, \"note\": \"one short sentence for the employee, at most 200 characters, in the language given\"}.",
  "Set unusual to true only when a typo or wrong product is the most likely explanation (for example a quantity of 1000 where 10 is usual, or a price that fits another unit).",
  "Never invent numbers; use only those in the document. No greetings.",
].join("\n");

export function unusualUserMessage(summary: DraftSummary, language: string, memory: string): string {
  return [
    `Language for the note: ${language}.`,
    memory ? `What you know about this employee and company:\n${memory}` : "",
    `Document:\n${JSON.stringify(summary)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Haiku's reply → a note, or null when it is not unusual or the reply is not the expected JSON. */
export function parseUnusualReply(text: string): string | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { unusual?: unknown; note?: unknown };
    if (o.unusual !== true || typeof o.note !== "string") return null;
    const note = o.note.replace(/\s+/g, " ").trim();
    return note ? clip(note, NOTE_MAX) : null;
  } catch {
    return null;
  }
}

/** A small in-memory cache with a time limit (one server process; enough for "same draft, same answer"). */
export function createAnswerCache<T>(ttlMs: number, max = 500, now: () => number = Date.now) {
  const map = new Map<string, { at: number; value: T }>();
  return {
    get(key: string): T | undefined {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T) {
      if (map.size >= max) {
        const first = map.keys().next().value;
        if (first !== undefined) map.delete(first);
      }
      map.set(key, { at: now(), value });
    },
    get size() {
      return map.size;
    },
  };
}
