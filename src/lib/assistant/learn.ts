import { timingSafeEqual } from "node:crypto";

/**
 * How Del Assistant learns about employees (AST-3, plan section 4) without an LLM for counting:
 *   - routines: the same action on the same kind of record on the same weekday in at least 3 different weeks
 *     of the last 4 ("Usually creates sales on Mondays");
 *   - repeated corrections: a record changed again within 10 minutes of being saved, at least 3 times in
 *     14 days on the same kind of record (a skill gap worth a hint).
 * The notes are phrased by fixed templates (free and predictable); Haiku only proposes notes from a finished
 * conversation (see memory.ts). Pure functions over audit_logs rows, so `npm test` checks them on fixtures.
 */

type Env = Readonly<Record<string, string | undefined>>;

export interface AuditRow {
  user_id: string | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  created_at: string;
}

export interface LearnedNote {
  userId: string;
  kind: "routine" | "skill_gap";
  subject: string;
  body: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

const DAY = 86_400_000;
export const ROUTINE_MIN_WEEKS = 3;
export const ROUTINE_LOOKBACK_DAYS = 28;
export const CORRECTION_WINDOW_MS = 10 * 60_000;
export const CORRECTION_MIN_COUNT = 3;
export const CORRECTION_LOOKBACK_DAYS = 14;

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const VERB: Record<string, string> = { CREATE: "creates", UPDATE: "changes", DELETE: "deletes" };

/** "purchase_invoices" → "purchase invoices" (the table names are English nouns). */
export function recordLabel(table: string): string {
  return table.replace(/_/g, " ").trim();
}

/** ISO week number key (year-week), so "3 different weeks" counts weeks, not days. */
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-${week}`;
}

export function detectRoutines(rows: readonly AuditRow[], now: Date = new Date()): LearnedNote[] {
  const since = now.getTime() - ROUTINE_LOOKBACK_DAYS * DAY;
  const groups = new Map<string, { userId: string; action: string; table: string; weekday: number; weeks: Set<string>; count: number }>();
  for (const r of rows) {
    if (!r.user_id || !r.table_name || !VERB[r.action]) continue;
    const at = new Date(r.created_at);
    if (Number.isNaN(at.getTime()) || at.getTime() < since || at.getTime() > now.getTime()) continue;
    const key = `${r.user_id}|${r.action}|${r.table_name}|${at.getUTCDay()}`;
    const g = groups.get(key) ?? { userId: r.user_id, action: r.action, table: r.table_name, weekday: at.getUTCDay(), weeks: new Set<string>(), count: 0 };
    g.weeks.add(weekKey(at));
    g.count += 1;
    groups.set(key, g);
  }
  const out: LearnedNote[] = [];
  for (const g of groups.values()) {
    if (g.weeks.size < ROUTINE_MIN_WEEKS) continue;
    const label = recordLabel(g.table);
    out.push({
      userId: g.userId,
      kind: "routine",
      subject: `Routine: ${label} on ${WEEKDAYS[g.weekday]}`.slice(0, 120),
      body: `Usually ${VERB[g.action]} ${label} on ${WEEKDAYS[g.weekday]} (${g.weeks.size} of the last 4 weeks, ${g.count} times).`,
      confidence: Math.min(1, 0.6 + 0.1 * g.weeks.size),
      evidence: { source: "audit_logs", table: g.table, action: g.action, weekday: g.weekday, weeks: g.weeks.size, count: g.count },
    });
  }
  return out.sort((a, b) => a.subject.localeCompare(b.subject));
}

export function detectCorrections(rows: readonly AuditRow[], now: Date = new Date()): LearnedNote[] {
  const since = now.getTime() - CORRECTION_LOOKBACK_DAYS * DAY;
  // When each record was saved (created) by whom.
  const created = new Map<string, { userId: string; at: number }>();
  for (const r of rows) {
    if (r.action !== "CREATE" || !r.user_id || !r.record_id || !r.table_name) continue;
    const at = Date.parse(r.created_at);
    if (Number.isFinite(at)) created.set(`${r.table_name}|${r.record_id}`, { userId: r.user_id, at });
  }
  const counts = new Map<string, { userId: string; table: string; records: Set<string> }>();
  for (const r of rows) {
    if (r.action !== "UPDATE" || !r.user_id || !r.record_id || !r.table_name) continue;
    const at = Date.parse(r.created_at);
    if (!Number.isFinite(at) || at < since || at > now.getTime()) continue;
    const c = created.get(`${r.table_name}|${r.record_id}`);
    if (!c || c.userId !== r.user_id || at < c.at || at - c.at > CORRECTION_WINDOW_MS) continue;
    const key = `${r.user_id}|${r.table_name}`;
    const g = counts.get(key) ?? { userId: r.user_id, table: r.table_name, records: new Set<string>() };
    g.records.add(r.record_id);
    counts.set(key, g);
  }
  const out: LearnedNote[] = [];
  for (const g of counts.values()) {
    if (g.records.size < CORRECTION_MIN_COUNT) continue;
    const label = recordLabel(g.table);
    out.push({
      userId: g.userId,
      kind: "skill_gap",
      subject: `Corrects ${label} after saving`.slice(0, 120),
      body: `Often changes ${label} again within 10 minutes of saving them (${g.records.size} times in 14 days); a check before saving may help.`,
      confidence: Math.min(1, 0.55 + 0.05 * g.records.size),
      evidence: { source: "audit_logs", table: g.table, records: g.records.size },
    });
  }
  return out.sort((a, b) => a.subject.localeCompare(b.subject));
}

/** The nightly job's secret (ASSISTANT_CRON_SECRET, at least 16 characters), compared in constant time. */
export function assistantCronAuthorized(header: string | null, env: Env = process.env): boolean {
  const secret = (env.ASSISTANT_CRON_SECRET ?? "").trim().replace(/^["']|["']$/g, "");
  if (!secret || secret.length < 16) return false;
  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  if (!match) return false;
  const given = Buffer.from(match[1].trim());
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A conversation is "finished" after 10 minutes without a message (or when the user starts a new chat). */
export const CONVERSATION_IDLE_MS = 10 * 60_000;

/** The text the Haiku pass reads: the last turns, newest kept, cut to about 3 000 tokens. */
export function conversationTranscript(rows: ReadonlyArray<{ role: string; content: string }>, maxChars = 12_000): string {
  const lines = rows
    .filter((r) => (r.role === "user" || r.role === "assistant") && typeof r.content === "string" && r.content.trim())
    .map((r) => `${r.role === "user" ? "USER" : "ASSISTANT"}: ${r.content.replace(/\s+/g, " ").trim().slice(0, 1500)}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length > maxChars) break;
    kept.unshift(lines[i]);
    size += lines[i].length + 1;
  }
  return kept.join("\n");
}

/** Is a conversation worth a learning pass? At least 2 questions from the user and not learned before. */
export function worthLearning(input: { userMessages: number; learnedAt: unknown }): boolean {
  return input.userMessages >= 2 && !input.learnedAt;
}
