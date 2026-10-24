/**
 * To-do on the view engine (phase 22): the user's tasks as cards in their own stages (kanban,
 * drag between columns) and a list. Pure: the screen brings the records and the stages.
 */
import type { ViewDefinition } from "../../../views/types";
import { sortStages, stageLabel, type TodoRecord, type TodoStage } from "../lib/todo";

export const TODO_VIEW_KEY = "todo.tasks";

const PRIORITY_COLOR = { "0": "var(--ds-text-subtle)", "1": "var(--ds-warning)", "2": "var(--ds-danger-strong)" } as const;

export function todoDefinition(stages: readonly TodoStage[], t: (key: string) => string): ViewDefinition<TodoRecord> {
  const ordered = sortStages(stages);
  return {
    model: {
      key: TODO_VIEW_KEY,
      table: "todo_tasks",
      module: "todo",
      readPermission: "can_view_dashboard",
      writePermission: "can_view_dashboard",
      select: "*",
      order: { field: "created_at", dir: "desc" },
      toRecord: (row) => row as TodoRecord,
    },
    titleKey: "todo.title",
    fields: [
      { name: "title", labelKey: "todo.fields.title", type: "char", searchable: true, readonly: true },
      {
        name: "stage_id",
        labelKey: "todo.fields.stage",
        type: "selection",
        groupable: true,
        readonly: true,
        options: ordered.map((s) => ({ value: s.id, label: stageLabel(s, t) })),
      },
      {
        name: "priority",
        labelKey: "todo.fields.priority",
        type: "selection",
        groupable: true,
        readonly: true,
        options: (["0", "1", "2"] as const).map((v) => ({ value: v, labelKey: `todo.priority.p${v}`, color: PRIORITY_COLOR[v] })),
      },
      { name: "due_date", labelKey: "todo.fields.dueDate", type: "date", groupable: true, readonly: true },
      { name: "tags", labelKey: "todo.fields.tags", type: "char", searchable: true, readonly: true },
      { name: "checklist", labelKey: "todo.fields.checklist", type: "char", readonly: true, sortable: false },
      { name: "assignees", labelKey: "todo.fields.assignees", type: "integer", readonly: true },
      { name: "done", labelKey: "todo.fields.done", type: "boolean", readonly: true },
      { name: "sequence", labelKey: "todo.fields.rank", type: "integer", readonly: true },
    ],
    filters: [
      { key: "open", labelKey: "todo.filters.open", group: "state", conditions: () => [{ field: "done", op: "eq", value: false }] },
      { key: "overdue", labelKey: "todo.filters.overdue", group: "due", conditions: (ctx) => [{ field: "due_date", op: "lt", value: ctx.now.toISOString().slice(0, 10) }, { field: "done", op: "eq", value: false }] },
      { key: "urgent", labelKey: "todo.filters.important", group: "priority", conditions: () => [{ field: "priority", op: "in", value: ["1", "2"] }] },
    ],
    groupBys: ["stage_id", "priority", "due_date:week"],
    defaultSort: { field: "sequence", dir: "asc" },
    views: ["kanban", "list"],
    list: { columns: ["title", "stage_id", "priority", "due_date", "tags", "checklist", "assignees"] },
    kanban: {
      groupBy: "stage_id",
      title: "title",
      subtitle: "tags",
      fields: ["priority", "due_date", "checklist"],
      folded: ordered.filter((s) => s.folded).map((s) => s.id),
    },
    form: { title: "title", fields: ["stage_id", "priority", "due_date", "tags"] },
  };
}
