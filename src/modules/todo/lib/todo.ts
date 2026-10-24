/**
 * To-do (phase 22), pure parts: stage labels, tasks as view records (the user's own stage and
 * order), quick capture text, the task form's checks, the priority stack's reordering and due-date
 * states. Kept free of React and Supabase so `node --test` covers it.
 */

export const STAGE_CODES = ["inbox", "today", "week", "later", "done"] as const;
export type StageCode = (typeof STAGE_CODES)[number];

export interface TodoStage {
  id: string;
  code: StageCode | null;
  name: string | null;
  sequence: number;
  is_done: boolean;
  folded: boolean;
}

export interface TodoTaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  due_date: string | null;
  tags: string[];
  done_at: string | null;
  created_by: string | null;
  created_at: string;
  todo_checklist_items?: { id: string; label: string; done: boolean; sequence: number }[];
  todo_task_members?: { user_id: string }[];
}

/** The user's member row with its task (what the screen reads). */
export interface MyTaskRow {
  task_id: string;
  stage_id: string | null;
  sequence: number;
  todo_tasks: TodoTaskRow | null;
}

export interface TodoRecord {
  id: string;
  title: string;
  description: string | null;
  priority: "0" | "1" | "2";
  due_date: string | null;
  tags: string;
  stage_id: string;
  sequence: number;
  done: boolean;
  checklist: string;
  assignees: number;
  created_by: string | null;
  [field: string]: unknown;
}

/** A stage's label: its own name, else the translated built-in. */
export function stageLabel(stage: Pick<TodoStage, "code" | "name">, t: (key: string) => string): string {
  if (stage.name) return stage.name;
  return stage.code ? t(`todo.stages.${stage.code}`) : "—";
}

export function sortStages<S extends Pick<TodoStage, "sequence" | "id">>(stages: readonly S[]): S[] {
  return [...stages].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}

/** The user's tasks as records of the view engine; a card without a stage goes to the first one. */
export function toTodoRecords(rows: readonly MyTaskRow[], stages: readonly TodoStage[]): TodoRecord[] {
  const first = sortStages(stages).find((s) => !s.is_done)?.id ?? "";
  const known = new Set(stages.map((s) => s.id));
  const out: TodoRecord[] = [];
  for (const row of rows) {
    const t = row.todo_tasks;
    if (!t) continue;
    const items = t.todo_checklist_items ?? [];
    out.push({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: String(Math.min(2, Math.max(0, t.priority))) as TodoRecord["priority"],
      due_date: t.due_date,
      tags: (t.tags ?? []).join(", "),
      stage_id: row.stage_id && known.has(row.stage_id) ? row.stage_id : first,
      sequence: row.sequence,
      done: !!t.done_at,
      checklist: items.length ? `${items.filter((i) => i.done).length}/${items.length}` : "",
      assignees: (t.todo_task_members ?? []).length,
      created_by: t.created_by,
    });
  }
  return out.sort((a, b) => a.sequence - b.sequence || a.title.localeCompare(b.title));
}

// ── Capture and form ─────────────────────────────────────────────────────────

export const TITLE_MAX = 300;
export const TAG_MAX = 40;
export const TAGS_MAX = 20;

/** Tags from "a, b,  a" → ["a", "b"] (trimmed, no duplicates, at most 20 of up to 40 characters). */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim().replace(/^#/, "").slice(0, TAG_MAX);
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, TAGS_MAX);
}

/**
 * Quick capture: "Call Acme about samples !! #sales #urgent" → title, priority (one "!" = high,
 * two or more = urgent) and tags. Marks are taken only as separate words.
 */
export function parseCapture(text: string): { title: string; priority: 0 | 1 | 2; tags: string[] } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let priority: 0 | 1 | 2 = 0;
  const tags: string[] = [];
  const title: string[] = [];
  for (const w of words) {
    if (/^!+$/.test(w)) priority = Math.max(priority, w.length >= 2 ? 2 : 1) as 0 | 1 | 2;
    else if (/^#[^#\s]+$/.test(w)) tags.push(w.slice(1));
    else title.push(w);
  }
  return { title: title.join(" ").slice(0, TITLE_MAX), priority, tags: parseTags(tags.join(",")) };
}

export interface TaskInput {
  title: string;
  description: string;
  priority: number;
  due_date: string;
  tags: string;
}

export interface TaskValue {
  title: string;
  description: string | null;
  priority: 0 | 1 | 2;
  due_date: string | null;
  tags: string[];
}

/** The task form as a row to save, or an error key (same limits as the table). */
export function checkTask(input: TaskInput): { ok: true; value: TaskValue } | { ok: false; error: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "todo.errors.title" };
  if (title.length > TITLE_MAX) return { ok: false, error: "todo.errors.tooLong" };
  if (input.due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date) || Number.isNaN(Date.parse(input.due_date)))) return { ok: false, error: "todo.errors.dueDate" };
  const description = input.description.trim();
  if (description.length > 10000) return { ok: false, error: "todo.errors.tooLong" };
  const priority = Math.min(2, Math.max(0, Math.trunc(Number(input.priority) || 0))) as 0 | 1 | 2;
  return { ok: true, value: { title, description: description || null, priority, due_date: input.due_date || null, tags: parseTags(input.tags) } };
}

// ── Priority stack ───────────────────────────────────────────────────────────

/** The list with one item moved from `from` to `to` (indexes clamped). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}

/** New order as stored sequences (10, 20, …), only for the rows whose sequence changes. */
export function sequenceUpdates(ids: readonly string[], current: ReadonlyMap<string, number>): { task_id: string; sequence: number }[] {
  return ids.map((task_id, i) => ({ task_id, sequence: (i + 1) * 10 })).filter((u) => current.get(u.task_id) !== u.sequence);
}

/** Where a pointer at `y` drops a dragged row, given the other rows' vertical midpoints in order. */
export function dropIndex(y: number, midpoints: readonly number[]): number {
  const i = midpoints.findIndex((m) => y < m);
  return i < 0 ? midpoints.length : i;
}

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

/** Due-date state of an open task ("soon" = within 7 days). */
export function dueState(due: string | null, now: Date): DueState {
  if (!due) return "none";
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  const day = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (day < today) return "overdue";
  if (day === today) return "today";
  return day - today <= 7 * 86_400_000 ? "soon" : "later";
}
