// To-do (phase 22): stage labels and order, tasks as records (own stage and order), quick capture,
// the task form's checks, the priority stack's reordering, due states, the module's
// registration, the migration's access rules and the az/en/ru texts. The RLS behaviour itself is
// checked in supabase/tests/todo.sql.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkTask, dropIndex, dueState, moveItem, parseCapture, parseTags, sequenceUpdates, sortStages, stageLabel, STAGE_CODES, toTodoRecords } from "../src/modules/todo/lib/todo.ts";
import { MODULES } from "../src/modules/registry.ts";
import { SHELL_EXTRA_ITEMS } from "../src/lib/shell/shell.ts";
import { CHATTER_MODELS, recordHref } from "../src/views/chatter/logic.ts";
import { azMessages, enMessages, ruMessages } from "../src/i18n/messages/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const MIGRATION = "supabase/migrations/20261024110000_todo.sql";
const NOW = new Date(2026, 9, 24, 12);

const STAGES = [
  { id: "s-done", code: "done", name: null, sequence: 50, is_done: true, folded: true },
  { id: "s-inbox", code: "inbox", name: null, sequence: 10, is_done: false, folded: false },
  { id: "s-mine", code: null, name: "Waiting", sequence: 30, is_done: false, folded: false },
];

test("stages: built-in ones are translated, own ones keep their name, ordered by sequence", () => {
  const t = (k) => `T(${k})`;
  assert.equal(stageLabel(STAGES[1], t), "T(todo.stages.inbox)");
  assert.equal(stageLabel(STAGES[2], t), "Waiting");
  assert.deepEqual(sortStages(STAGES).map((s) => s.id), ["s-inbox", "s-mine", "s-done"]);
  // The built-in codes are the ones the migration seeds.
  const sql = read(MIGRATION);
  for (const code of STAGE_CODES) assert.match(sql, new RegExp(`\\(p_user, '${code}', `), code);
});

test("records: the user's stage and order; unknown stages fall back to the first open one", () => {
  const task = (id, over = {}) => ({ id, title: id, description: null, priority: 1, due_date: null, tags: ["a", "b"], done_at: null, created_by: "u", created_at: "", todo_checklist_items: [{ id: "1", label: "x", done: true, sequence: 1 }, { id: "2", label: "y", done: false, sequence: 2 }], todo_task_members: [{ user_id: "u" }, { user_id: "v" }], ...over });
  const recs = toTodoRecords(
    [
      { task_id: "b", stage_id: "s-mine", sequence: 20, todo_tasks: task("b") },
      { task_id: "a", stage_id: "gone", sequence: 10, todo_tasks: task("a", { done_at: "2026-10-01", priority: 9 }) },
      { task_id: "x", stage_id: "s-inbox", sequence: 5, todo_tasks: null },
    ],
    STAGES
  );
  assert.deepEqual(recs.map((r) => [r.id, r.stage_id]), [["a", "s-inbox"], ["b", "s-mine"]]);
  assert.equal(recs[0].done, true);
  assert.equal(recs[0].priority, "2");
  assert.equal(recs[1].checklist, "1/2");
  assert.equal(recs[1].tags, "a, b");
  assert.equal(recs[1].assignees, 2);
});

test("quick capture: ! / !! set priority, #tags become tags, the rest is the title", () => {
  assert.deepEqual(parseCapture("  Call Acme about samples !! #sales #Urgent "), { title: "Call Acme about samples", priority: 2, tags: ["sales", "Urgent"] });
  assert.deepEqual(parseCapture("Pay rent !"), { title: "Pay rent", priority: 1, tags: [] });
  assert.deepEqual(parseCapture("Hello! #a #A"), { title: "Hello!", priority: 0, tags: ["a"] });
  assert.equal(parseCapture("x".repeat(400)).title.length, 300);
  assert.deepEqual(parseTags(" #sales, , urgent,Sales "), ["sales", "urgent"]);
  assert.equal(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(",")).length, 20);
});

test("task form: checks mirror the table", () => {
  assert.deepEqual(checkTask({ title: " Order ", description: "  ", priority: 5, due_date: "", tags: "a, b" }), { ok: true, value: { title: "Order", description: null, priority: 2, due_date: null, tags: ["a", "b"] } });
  assert.equal(checkTask({ title: " ", description: "", priority: 0, due_date: "", tags: "" }).error, "todo.errors.title");
  assert.equal(checkTask({ title: "x".repeat(301), description: "", priority: 0, due_date: "", tags: "" }).error, "todo.errors.tooLong");
  assert.equal(checkTask({ title: "x", description: "", priority: 0, due_date: "24.10.2026", tags: "" }).error, "todo.errors.dueDate");
  const sql = read(MIGRATION);
  assert.match(sql, /title text not null check \(length\(btrim\(title\)\) between 1 and 300\)/);
  assert.match(sql, /priority smallint not null default 0 check \(priority between 0 and 2\)/);
});

test("priority stack: moving, drop position, and only changed sequences are saved", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, -5), ["c", "a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
  assert.equal(dropIndex(5, [10, 30, 50]), 0);
  assert.equal(dropIndex(35, [10, 30, 50]), 2);
  assert.equal(dropIndex(99, [10, 30, 50]), 3);
  assert.deepEqual(sequenceUpdates(["b", "a", "c"], new Map([["a", 10], ["b", 20], ["c", 30]])), [{ task_id: "b", sequence: 10 }, { task_id: "a", sequence: 20 }]);
});

test("due states", () => {
  assert.equal(dueState(null, NOW), "none");
  assert.equal(dueState("2026-10-23", NOW), "overdue");
  assert.equal(dueState("2026-10-24", NOW), "today");
  assert.equal(dueState("2026-10-30", NOW), "soon");
  assert.equal(dueState("2026-11-30", NOW), "later");
});

test("the to-do module is registered, new UI only, reachable from the shell and the palette", () => {
  const m = MODULES.find((x) => x.id === "todo");
  assert.deepEqual([m.depends, m.menus, m.routes], [["core"], [], [{ prefix: "/todo", permission: "can_view_dashboard" }]]);
  assert.ok(SHELL_EXTRA_ITEMS.some((i) => i.path === "/todo" && i.module === "todo"));
  assert.match(read("src/app/todo/page.tsx"), /if \(!isNewUiEnabled\(\)\) notFound\(\);/);
  assert.match(read("src/components/shell/NewShell.tsx"), /isEnabled\("todo"\) \? \{ id: "todo", label: t\("shell\.newTodo"\), href: "\/todo\?capture=1"/);
  assert.match(read("src/modules/todo/components/TodoScreen.tsx"), /params\.get\("capture"\) !== "1"/);
  // Due tasks in "My activities"; tasks carry chatter and open from it.
  assert.match(read("src/components/shell/MyActivitiesButton.tsx"), /useMyDueTasks\(user\?\.id \?\? null, isEnabled\("todo"\)\)/);
  assert.ok(CHATTER_MODELS.includes("todo_tasks"));
  assert.equal(recordHref("todo_tasks", "t1"), "/todo?record=t1");
  assert.match(read("control-panel/supabase/migrations/20261024110000_todo_module.sql"), /\('todo', 'To-do', '\{core\}', false\)/);
});

test("one migration; RLS on every table; members only; own cards and stages", () => {
  assert.equal(readdirSync(join(root, "supabase/migrations")).filter((f) => f.startsWith("20261024110000")).length, 1);
  const sql = read(MIGRATION);
  for (const table of ["todo_stages", "todo_tasks", "todo_task_members", "todo_checklist_items"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`), table);
  }
  assert.match(sql, /create policy todo_stages_own on public\.todo_stages\s+for all to authenticated\s+using \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /create policy todo_task_members_update on public\.todo_task_members\s+for update to authenticated\s+using \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /using \(created_by = auth\.uid\(\) or public\.is_admin\(\)\)/);
  assert.doesNotMatch(sql, /grant [^;]* to anon/);
  assert.match(read(".github/workflows/db-baseline.yml"), /supabase\/tests\/todo\.sql/);
  assert.match(read("supabase/scripts/tenant1_preflight.sql"), /20261024110000_todo/);
});

test("every to-do text exists in az, en and ru", () => {
  const keys = new Set();
  for (const f of ["src/modules/todo/components/TodoScreen.tsx", "src/modules/todo/components/TaskPanel.tsx", "src/modules/todo/components/PriorityStack.tsx", "src/modules/todo/lib/todo.ts", "src/modules/todo/views/todo.ts", "src/app/todo/page.client.tsx", "src/components/shell/MyActivitiesButton.tsx"]) {
    for (const m of read(f).matchAll(/["'`](todo\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) keys.add(m[1]);
  }
  keys.delete("todo.tasks"); // the view's model key, not a text
  for (const c of STAGE_CODES) keys.add(`todo.stages.${c}`);
  for (const p of [0, 1, 2]) keys.add(`todo.priority.p${p}`);
  for (const d of ["overdue", "today", "soon", "later"]) keys.add(`todo.due.${d}`);
  for (const k of ["modules.names.todo", "newShell.extra_todo", "shell.newTodo", "views.chatter.models.todo_tasks"]) keys.add(k);
  const get = (messages, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), messages);
  assert.ok(keys.size > 50, String(keys.size));
  for (const [name, messages] of [["az", azMessages], ["en", enMessages], ["ru", ruMessages]]) {
    const missing = [...keys].filter((k) => typeof get(messages, k) !== "string");
    assert.deepEqual(missing, [], `${name} misses ${missing.join(", ")}`);
  }
});
