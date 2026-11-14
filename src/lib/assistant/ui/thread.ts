import { isSafeInternalHref } from "@/lib/ai/links";
import { parseSse, type AssistantStreamEvent } from "@/lib/assistant/sse";

/**
 * The conversation as the panel shows it (AST-2): messages built from the stream of /api/assistant/chat
 * (src/lib/assistant/sse.ts), errors with a reason the user can act on, the page context and the
 * suggestions. Pure, so `npm test` checks it.
 */

export type ErrorReason = "budget" | "permission" | "limit" | "rate_limit" | "disabled" | "network" | "unavailable" | "refused";

export interface ThreadStep {
  tool: string;
  summary: string;
  /** null while the tool runs. */
  ok: boolean | null;
}

export interface ThreadLink {
  label: string;
  href: string;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error" | "stopped";
  steps: ThreadStep[];
  links: ThreadLink[];
  error?: ErrorReason;
  /** On an assistant message: the question it answers, for Retry. */
  question?: string;
}

/** Only internal links (`/sales/…`), never another site (isSafeInternalHref). */
export function safeLinks(links: ReadonlyArray<{ label?: unknown; href?: unknown }> | null | undefined): ThreadLink[] {
  const out: ThreadLink[] = [];
  const seen = new Set<string>();
  for (const l of links ?? []) {
    const href = typeof l?.href === "string" ? l.href : "";
    const label = typeof l?.label === "string" && l.label.trim() ? l.label.trim() : href;
    if (!isSafeInternalHref(href) || seen.has(href)) continue;
    seen.add(href);
    out.push({ label, href });
  }
  return out.slice(0, 8);
}

function update(messages: ThreadMessage[], id: string, fn: (m: ThreadMessage) => ThreadMessage): ThreadMessage[] {
  return messages.map((m) => (m.id === id ? fn(m) : m));
}

/** Applies one stream event to the assistant message `id`. */
export function applyStreamEvent(messages: ThreadMessage[], id: string, event: AssistantStreamEvent): ThreadMessage[] {
  switch (event.type) {
    case "start":
      return messages;
    case "text_delta":
      return update(messages, id, (m) => ({ ...m, content: m.content + event.text }));
    case "tool_start":
      return update(messages, id, (m) => ({ ...m, steps: [...m.steps, { tool: event.tool, summary: event.summary || event.tool, ok: null }] }));
    case "tool_end":
      return update(messages, id, (m) => {
        const steps = [...m.steps];
        const i = steps.map((s) => s.tool === event.tool && s.ok === null).lastIndexOf(true);
        if (i >= 0) steps[i] = { ...steps[i], ok: event.ok };
        return { ...m, steps, links: safeLinks([...m.links, ...event.links]) };
      });
    case "done":
      return update(messages, id, (m) => ({
        ...m,
        // The final reply is the source of truth; deltas were only a preview of it.
        content: event.reply || m.content,
        status: "done",
        steps: m.steps.map((s) => (s.ok === null ? { ...s, ok: true } : s)),
        links: safeLinks([...m.links, ...event.links]),
      }));
    case "error":
      return update(messages, id, (m) => ({
        ...m,
        status: event.reason === "refused" && m.content ? "done" : "error",
        error: event.reason,
        steps: m.steps.map((s) => (s.ok === null ? { ...s, ok: false } : s)),
      }));
    default:
      return messages;
  }
}

/** The reason of a request that did not even start streaming. */
export function reasonFromResponse(status: number, body?: { code?: unknown } | null): ErrorReason {
  if (status === 401) return "permission";
  if (status === 403) return body && typeof body.code === "string" && body.code ? "limit" : "permission";
  if (status === 404) return "disabled";
  if (status === 429) return "rate_limit";
  return "unavailable";
}

/** i18n key of the plain-words explanation of an error. */
export function errorKey(reason: ErrorReason): string {
  return `assistant.errors.${reason}`;
}

/** Can the user try again with the same question? (Not when the assistant is off or out of budget.) */
export function canRetry(reason: ErrorReason | undefined): boolean {
  return reason === "network" || reason === "unavailable" || reason === "rate_limit";
}

/** A reply that was stopped keeps what arrived so far. */
export function stopMessage(messages: ThreadMessage[], id: string): ThreadMessage[] {
  return update(messages, id, (m) =>
    m.status === "streaming" ? { ...m, status: "stopped", steps: m.steps.map((s) => (s.ok === null ? { ...s, ok: false } : s)) } : m
  );
}

/** Messages of a saved conversation (ai_messages rows, oldest first). */
export function messagesFromHistory(rows: ReadonlyArray<{ id?: unknown; role?: unknown; content?: unknown; steps?: unknown }>): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  let lastQuestion = "";
  rows.forEach((row, i) => {
    const role = row.role === "user" || row.role === "assistant" ? row.role : null;
    const content = typeof row.content === "string" ? row.content : "";
    if (!role || !content) return;
    const steps = Array.isArray(row.steps)
      ? (row.steps as Array<Record<string, unknown>>).map((s) => ({ tool: String(s?.tool ?? ""), summary: String(s?.summary ?? s?.tool ?? ""), ok: s?.ok === false ? false : true }))
      : [];
    if (role === "user") lastQuestion = content;
    out.push({
      id: typeof row.id === "string" ? row.id : `h${i}`,
      role,
      content,
      status: "done",
      steps: role === "assistant" ? steps.filter((s) => s.tool) : [],
      links: [],
      ...(role === "assistant" ? { question: lastQuestion } : {}),
    });
  });
  return out;
}

/** Reads a text/event-stream body and calls `onEvent` for every event, in order. */
export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (e: AssistantStreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSse(buffer);
      buffer = parsed.rest;
      for (const e of parsed.events) onEvent(e);
    }
    buffer += decoder.decode();
    if (buffer.trim()) for (const e of parseSse(`${buffer}\n\n`).events) onEvent(e);
  } finally {
    reader.releaseLock();
  }
}

// ─── What the user is looking at ────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PageContext {
  page: string;
  recordType: "sale" | null;
  recordId: string | null;
}

/** The context sent with each question; the server reloads the record with the user's own client. */
export function contextFromPath(pathname: string | null | undefined): PageContext {
  const page = typeof pathname === "string" && pathname.startsWith("/") ? pathname.split("?")[0].slice(0, 200) : "/";
  const sale = page.match(/^\/sales\/([^/]+)$/);
  if (sale && UUID.test(sale[1])) return { page, recordType: "sale", recordId: sale[1] };
  return { page, recordType: null, recordId: null };
}

/** The first name for the greeting ("Aysel Məmmədova" → "Aysel"); empty when there is none. */
export function firstName(fullName: string | null | undefined): string {
  const name = (fullName ?? "").trim();
  if (!name || name.includes("@")) return "";
  return name.split(/\s+/)[0];
}

// ─── Suggestions ────────────────────────────────────────────────────────────

export type SuggestionId =
  | "saleSummary"
  | "saleCustomerUnpaid"
  | "salesToday"
  | "salesTopCustomers"
  | "debtors"
  | "lowStock"
  | "financeSummary"
  | "productionStatus";

const NEEDS: Record<SuggestionId, string> = {
  saleSummary: "can_view_sales",
  saleCustomerUnpaid: "can_view_sales",
  salesToday: "can_view_sales",
  salesTopCustomers: "can_view_sales",
  debtors: "can_view_customers",
  lowStock: "can_view_products",
  financeSummary: "can_view_finance",
  productionStatus: "can_view_production",
};

/**
 * Up to `max` suggestions for this page and role: the record first, then the page's area, then what the
 * user may see in general. A suggestion whose data the user may not read is never offered.
 */
export function suggestionsFor(input: { context: PageContext; can: (permission: string) => boolean; max?: number }): SuggestionId[] {
  const { context, can } = input;
  const page = context.page;
  const ordered: SuggestionId[] = [];
  if (context.recordType === "sale") ordered.push("saleSummary", "saleCustomerUnpaid");
  if (page.startsWith("/sales")) ordered.push("salesToday", "salesTopCustomers");
  if (page.startsWith("/customers") || page.startsWith("/crm")) ordered.push("debtors");
  if (page.startsWith("/products") || page.startsWith("/inventory") || page.startsWith("/warehouse")) ordered.push("lowStock");
  if (page.startsWith("/finance") || page.startsWith("/cash-bank") || page.startsWith("/reports")) ordered.push("financeSummary", "debtors");
  if (page.startsWith("/production")) ordered.push("productionStatus", "lowStock");
  ordered.push("salesToday", "debtors", "lowStock", "financeSummary", "productionStatus");
  const out: SuggestionId[] = [];
  for (const id of ordered) {
    if (out.includes(id) || !can(NEEDS[id])) continue;
    out.push(id);
    if (out.length >= (input.max ?? 4)) break;
  }
  return out;
}

export function suggestionKey(id: SuggestionId): string {
  return `assistant.suggestions.${id}`;
}
