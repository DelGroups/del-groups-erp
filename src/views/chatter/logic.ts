/**
 * Chatter and activities (phase 19), pure parts: which records carry chatter, the due-date state
 * of an activity, ordering, input checks and the system log lines. The table list must match
 * public.chatter_models() in supabase/migrations/20261015100000_activities_chatter.sql (a test
 * compares them).
 */

export const CHATTER_MODELS = [
  "accounts", "contracts", "customers", "deals", "employee_advances", "employee_leaves", "employees",
  "expenses", "inventory_counts", "inventory_initial_balances", "inventory_writeoffs", "payments",
  "payrolls", "production_orders", "products", "purchases", "sales", "sales_commissions", "suppliers",
  "transactions", "warehouse_slips",
] as const;
export type ChatterModel = (typeof CHATTER_MODELS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A record carries chatter when its table is listed and its id is a real row id. */
export function chatterEnabledFor(table: string | null | undefined, id: string | null | undefined): table is ChatterModel {
  return !!table && !!id && (CHATTER_MODELS as readonly string[]).includes(table) && UUID.test(id);
}

export const ACTIVITY_TYPES = ["todo", "call", "meeting"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type MessageKind = "note" | "message" | "log";

export interface ChatterMessage {
  id: string;
  kind: MessageKind;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface Activity {
  id: string;
  activity_type: ActivityType;
  summary: string;
  note: string | null;
  due_date: string;
  assigned_to: string | null;
  created_by: string | null;
  done_at: string | null;
  done_by: string | null;
}

export type ActivityState = "overdue" | "today" | "planned" | "done";

/** Calendar day of a "YYYY-MM-DD" in local time. */
function day(value: string): number {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function activityState(a: Pick<Activity, "due_date" | "done_at">, now: Date): ActivityState {
  if (a.done_at) return "done";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = day(a.due_date);
  return due < today ? "overdue" : due === today ? "today" : "planned";
}

/** Whole days from today to the due date (negative = late). */
export function daysUntil(dueDate: string, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((day(dueDate) - today) / 86400000);
}

/** Open activities first, by due date; done ones after, latest first. */
export function sortActivities<A extends Pick<Activity, "due_date" | "done_at">>(list: readonly A[]): A[] {
  return [...list].sort((a, b) => {
    if (!a.done_at !== !b.done_at) return a.done_at ? 1 : -1;
    if (a.done_at && b.done_at) return b.done_at.localeCompare(a.done_at);
    return a.due_date.localeCompare(b.due_date);
  });
}

export function counts(list: readonly Pick<Activity, "due_date" | "done_at">[], now: Date): Record<ActivityState, number> {
  const out: Record<ActivityState, number> = { overdue: 0, today: 0, planned: 0, done: 0 };
  for (const a of list) out[activityState(a, now)] += 1;
  return out;
}

export const MESSAGE_MAX = 10000;
export const SUMMARY_MAX = 200;

/** A message body to send, or an error key (same limits as the table). */
export function checkMessage(body: string): { ok: true; body: string } | { ok: false; error: string } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "views.chatter.errors.empty" };
  if (trimmed.length > MESSAGE_MAX) return { ok: false, error: "views.chatter.errors.tooLong" };
  return { ok: true, body: trimmed };
}

export interface ActivityInput {
  activity_type: string;
  summary: string;
  due_date: string;
  assigned_to: string | null;
  note?: string;
}

export function checkActivity(input: ActivityInput): { ok: true; value: Required<Omit<ActivityInput, "note">> & { note: string | null; activity_type: ActivityType } } | { ok: false; error: string } {
  if (!(ACTIVITY_TYPES as readonly string[]).includes(input.activity_type)) return { ok: false, error: "views.chatter.errors.type" };
  const summary = input.summary.trim();
  if (!summary) return { ok: false, error: "views.chatter.errors.summary" };
  if (summary.length > SUMMARY_MAX) return { ok: false, error: "views.chatter.errors.tooLong" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date) || Number.isNaN(Date.parse(input.due_date))) return { ok: false, error: "views.chatter.errors.dueDate" };
  const note = (input.note ?? "").trim();
  return { ok: true, value: { activity_type: input.activity_type as ActivityType, summary, due_date: input.due_date, assigned_to: input.assigned_to || null, note: note ? note.slice(0, 5000) : null } };
}

/** A system log line ("activity_done:call:Follow-up call") as data, or null for other text. */
export function parseLog(body: string): { event: "activity_done"; type: ActivityType | null; summary: string } | null {
  const m = /^activity_done:([a-z]+):([\s\S]*)$/.exec(body);
  if (!m) return null;
  return { event: "activity_done", type: (ACTIVITY_TYPES as readonly string[]).includes(m[1]) ? (m[1] as ActivityType) : null, summary: m[2] };
}

/** Two letters for an author's avatar. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Who may change an activity in the UI (the table's policy is the real check). */
export function canChangeActivity(a: Pick<Activity, "created_by" | "assigned_to">, userId: string | null, isAdmin: boolean): boolean {
  return isAdmin || (!!userId && (a.created_by === userId || a.assigned_to === userId));
}
export function canDeleteActivity(a: Pick<Activity, "created_by">, userId: string | null, isAdmin: boolean): boolean {
  return isAdmin || (!!userId && a.created_by === userId);
}
