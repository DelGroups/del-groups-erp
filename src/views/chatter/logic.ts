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

/** Built-in activity types (translated by code); admins add more in public.activity_types. */
export const ACTIVITY_TYPES = ["todo", "call", "meeting"] as const;
export type BuiltInActivityType = (typeof ACTIVITY_TYPES)[number];
/** Code of a row in public.activity_types. */
export type ActivityType = string;
export const ACTIVITY_ICONS = ["todo", "call", "meeting", "email", "document"] as const;
export type ActivityIcon = (typeof ACTIVITY_ICONS)[number];
export type MessageKind = "note" | "message" | "log";

export interface ActivityTypeRow {
  code: string;
  name: string | null;
  icon: ActivityIcon;
  default_days: number;
  sequence: number;
  active: boolean;
}

/** The built-in rows, used until the table answers. */
export const DEFAULT_ACTIVITY_TYPES: ActivityTypeRow[] = [
  { code: "todo", name: null, icon: "todo", default_days: 0, sequence: 10, active: true },
  { code: "call", name: null, icon: "call", default_days: 1, sequence: 20, active: true },
  { code: "meeting", name: null, icon: "meeting", default_days: 3, sequence: 30, active: true },
];

export function isBuiltInType(code: string): code is BuiltInActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(code);
}

/** Label of an activity type: its own name, else the translated built-in, else the code. */
export function activityTypeLabel(code: string, types: readonly Pick<ActivityTypeRow, "code" | "name">[], t: (key: string) => string): string {
  const row = types.find((x) => x.code === code);
  if (row?.name) return row.name;
  return isBuiltInType(code) ? t(`views.chatter.type.${code}`) : code;
}

/** Active types in their order, for the composer. */
export function selectableTypes<T extends Pick<ActivityTypeRow, "active" | "sequence" | "code">>(types: readonly T[]): T[] {
  return types.filter((x) => x.active).sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
}

/** "YYYY-MM-DD" a number of days after now (local calendar). */
export function dueIn(days: number, now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Math.max(0, Math.trunc(days)));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A new activity type from the settings form, or an error key (same limits as the table). */
export function checkActivityType(
  input: { code: string; name: string; icon: string; default_days: number | string },
  existing: readonly string[],
): { ok: true; value: Pick<ActivityTypeRow, "code" | "name" | "icon" | "default_days"> } | { ok: false; error: string } {
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(code)) return { ok: false, error: "views.chatter.typesAdmin.errors.code" };
  if (existing.includes(code)) return { ok: false, error: "views.chatter.typesAdmin.errors.exists" };
  const name = input.name.trim();
  if (!name || name.length > 60) return { ok: false, error: "views.chatter.typesAdmin.errors.name" };
  if (!(ACTIVITY_ICONS as readonly string[]).includes(input.icon)) return { ok: false, error: "views.chatter.errors.type" };
  const days = Number(input.default_days);
  if (!Number.isInteger(days) || days < 0 || days > 365) return { ok: false, error: "views.chatter.typesAdmin.errors.days" };
  return { ok: true, value: { code, name, icon: input.icon as ActivityIcon, default_days: days } };
}

export interface ChatterMessage {
  id: string;
  kind: MessageKind;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  edited_at: string | null;
  mail_attachments?: ChatterAttachment[];
}

export interface ChatterAttachment {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
}

export interface Follower {
  id: string;
  user_id: string;
  added_by: string | null;
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

/** `types` are the codes the user may pick (active rows of public.activity_types). */
export function checkActivity(
  input: ActivityInput,
  types: readonly string[] = ACTIVITY_TYPES,
): { ok: true; value: Required<Omit<ActivityInput, "note">> & { note: string | null; activity_type: ActivityType } } | { ok: false; error: string } {
  if (!types.includes(input.activity_type)) return { ok: false, error: "views.chatter.errors.type" };
  const summary = input.summary.trim();
  if (!summary) return { ok: false, error: "views.chatter.errors.summary" };
  if (summary.length > SUMMARY_MAX) return { ok: false, error: "views.chatter.errors.tooLong" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date) || Number.isNaN(Date.parse(input.due_date))) return { ok: false, error: "views.chatter.errors.dueDate" };
  const note = (input.note ?? "").trim();
  return { ok: true, value: { activity_type: input.activity_type as ActivityType, summary, due_date: input.due_date, assigned_to: input.assigned_to || null, note: note ? note.slice(0, 5000) : null } };
}

export interface TrackedChange {
  field: string;
  from: unknown;
  to: unknown;
}

export type LogLine = { event: "activity_done"; type: ActivityType; summary: string } | { event: "tracking"; changes: TrackedChange[] };

/**
 * A system log line as data, or null for other text:
 * "activity_done:call:Follow-up call" (an activity was completed) or
 * "tracking:[{"f":"stage","o":"NEW","n":"WON"}]" (tracked fields changed, chatter_track_changes()).
 */
export function parseLog(body: string): LogLine | null {
  const done = /^activity_done:([a-z][a-z0-9_]*):([\s\S]*)$/.exec(body);
  if (done) return { event: "activity_done", type: done[1], summary: done[2] };
  if (!body.startsWith("tracking:")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice("tracking:".length));
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const changes = raw
    .filter((x): x is { f: string; o?: unknown; n?: unknown } => !!x && typeof x === "object" && typeof (x as { f?: unknown }).f === "string")
    .map((x) => ({ field: x.f, from: x.o ?? null, to: x.n ?? null }));
  return changes.length ? { event: "tracking", changes } : null;
}

/** Fields that write a tracking line, per table (must match the chatter_track_changes triggers in the migration). */
export const TRACKED_FIELDS: Partial<Record<ChatterModel, readonly string[]>> = {
  sales: ["status", "grand_total", "paid_amount", "due_date", "warehouse_slip_status"],
  purchases: ["status", "grand_total", "paid_amount", "due_date", "warehouse_slip_status"],
  customers: ["name", "phone", "address", "voen", "default_price_tier"],
  deals: ["title", "stage", "expected_value", "assigned_to"],
};
const TRACKED_USER_FIELDS = new Set(["assigned_to"]);

/** A tracked value for display: empty as "—", user ids as names, everything else as stored. */
export function trackedValue(field: string, value: unknown, users: readonly { id: string; full_name: string }[]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (TRACKED_USER_FIELDS.has(field) && typeof value === "string") return users.find((u) => u.id === value)?.full_name || "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ── Attachments ──────────────────────────────────────────────────────────────

export const ATTACHMENT_BUCKET = "chatter-attachments";
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 5;

/**
 * Storage path of a file on a message: "<model>/<record id>/<message id>/<unique>-<safe name>".
 * The bucket's policies read the first three parts: the record decides who may read the file,
 * and only the message's author may upload under it.
 */
export function attachmentPath(model: ChatterModel, recordId: string, messageId: string, fileName: string, unique: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${model}/${recordId}/${messageId}/${unique}-${stem || "file"}${ext ? `.${ext}` : ""}`;
}

/** Files to attach, or an error key: at most 5, none empty, each up to 10 MB (the bucket's limit). */
export function checkFiles(files: readonly { size: number }[]): { ok: true } | { ok: false; error: string } {
  if (files.length > ATTACHMENT_MAX_FILES) return { ok: false, error: "views.chatter.errors.tooManyFiles" };
  for (const f of files) {
    if (f.size <= 0) return { ok: false, error: "views.chatter.errors.emptyFile" };
    if (f.size > ATTACHMENT_MAX_BYTES) return { ok: false, error: "views.chatter.errors.fileTooBig" };
  }
  return { ok: true };
}

/** "512 B", "14 KB", "2.4 MB". */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── My activities ────────────────────────────────────────────────────────────

/** Where a record opens in the new UI, for the "My activities" list (null: no screen of its own yet). */
export function recordHref(model: string, id: string): string | null {
  switch (model) {
    case "deals":
      return `/crm/${id}`;
    case "sales":
      return `/sales/${id}`;
    case "purchases":
      return `/purchases?record=${id}`;
    case "customers":
      return `/customers?record=${id}`;
    default:
      return null;
  }
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
