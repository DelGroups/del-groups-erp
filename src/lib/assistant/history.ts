/**
 * Conversation history of Del Assistant (AST-2): the user's own `ai_conversations` (RLS: user_id =
 * auth.uid()), read and changed only with the user's own client. Delete is soft and needs no migration:
 * the conversation's `context` jsonb (AST-1 column) gets `hidden: true`, and the list leaves it out.
 * Pure helpers here; the route handlers live in src/app/api/assistant/conversations.
 */

export const HISTORY_LIMIT = 50;
export const TITLE_MAX = 80;

export interface ConversationRow {
  id: string;
  title: string | null;
  updated_at: string;
  context: Record<string, unknown> | null;
}

export interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

export function isHidden(context: unknown): boolean {
  return !!context && typeof context === "object" && (context as Record<string, unknown>).hidden === true;
}

/** Rows → the list the panel shows: hidden ones left out, newest first, titles trimmed. */
export function toConversationItems(rows: ReadonlyArray<Partial<ConversationRow>> | null | undefined): ConversationItem[] {
  return (rows ?? [])
    .filter((r) => typeof r.id === "string" && !isHidden(r.context))
    .map((r) => ({ id: r.id as string, title: (r.title ?? "").trim(), updatedAt: String(r.updated_at ?? "") }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** A new title: one line, trimmed, at most 80 characters; null when nothing usable is left. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const printable = Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  }).join("");
  const one = printable.replace(/\s+/g, " ").trim();
  return one ? one.slice(0, TITLE_MAX) : null;
}

/** The context with the soft-delete mark; what was there stays. */
export function hiddenContext(context: unknown): Record<string, unknown> {
  const base = context && typeof context === "object" && !Array.isArray(context) ? (context as Record<string, unknown>) : {};
  return { ...base, hidden: true, hiddenAt: new Date().toISOString() };
}

export type ConversationPatch = { kind: "rename"; title: string } | { kind: "hide" } | { kind: "invalid" };

export function parsePatch(body: unknown): ConversationPatch {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (o.hidden === true) return { kind: "hide" };
  const title = cleanTitle(o.title);
  return title ? { kind: "rename", title } : { kind: "invalid" };
}
