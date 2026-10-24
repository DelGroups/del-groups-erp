"use client";

import React, { useId, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/design-system/components";
import type { Formatter } from "@/views";
import { Chatter } from "@/views/chatter/Chatter";
import { useChatterUsers } from "@/views/chatter/data";
import { checkTask, sortStages, stageLabel, type TodoStage, type TodoTaskRow } from "../lib/todo";
import { useTask, useTodoActions } from "../lib/data";

/**
 * An opened task: the form (title, notes, stage, priority, due date, tags), assignees, the
 * checklist, and the task's chatter (activities, messages, files). Every member may edit; the
 * creator (or an admin) deletes.
 */
export function TaskPanel({ taskId, stageId, stages, fmt, onClose }: { taskId: string; stageId: string; stages: readonly TodoStage[]; fmt: Formatter; onClose: () => void }) {
  const { t } = fmt;
  const task = useTask(taskId);
  if (task.isLoading) return <p className="ds-muted">{t("common.loading")}</p>;
  if (!task.data) return <p className="ds-muted">{t("todo.missing")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <TaskForm key={task.data.id} task={task.data} stageId={stageId} stages={stages} fmt={fmt} onClose={onClose} />
      <Checklist task={task.data} fmt={fmt} />
      <Chatter model="todo_tasks" recordId={task.data.id} fmt={fmt} />
    </div>
  );
}

function TaskForm({ task, stageId, stages, fmt, onClose }: { task: TodoTaskRow; stageId: string; stages: readonly TodoStage[]; fmt: Formatter; onClose: () => void }) {
  const { t } = fmt;
  const { user, isAdmin } = useAuth();
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const users = useChatterUsers(true);
  const actions = useTodoActions(userId);
  const base = useId();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [due, setDue] = useState(task.due_date ?? "");
  const [tags, setTags] = useState((task.tags ?? []).join(", "));
  const [stage, setStage] = useState(stageId);
  const members = (task.todo_task_members ?? []).map((m) => m.user_id);
  const [assignees, setAssignees] = useState<string[]>(members);
  const [error, setError] = useState<string | null>(null);
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
  const busy = actions.update.isPending || actions.setAssignees.isPending || actions.move.isPending;

  const save = async () => {
    const checked = checkTask({ title, description, priority, due_date: due, tags });
    if (!checked.ok) {
      setError(t(checked.error));
      return;
    }
    setError(null);
    try {
      await actions.update.mutateAsync({ id: task.id, patch: checked.value });
      if (stage && stage !== stageId) await actions.move.mutateAsync({ taskId: task.id, stageId: stage });
      if (assignees.join() !== members.join()) await actions.setAssignees.mutateAsync({ taskId: task.id, want: assignees, have: members });
      toast(t("todo.saved"), undefined, "success");
    } catch (err) {
      fail(err);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="flex flex-col gap-1" htmlFor={`${base}-title`}>
        <span className="ds-label">{t("todo.fields.title")}</span>
        <input id={`${base}-title`} className="ds-input" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1" htmlFor={`${base}-stage`}>
          <span className="ds-label">{t("todo.fields.stage")}</span>
          <select id={`${base}-stage`} className="ds-input" value={stage} onChange={(e) => setStage(e.target.value)}>
            {sortStages(stages).map((s) => (
              <option key={s.id} value={s.id}>
                {stageLabel(s, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-priority`}>
          <span className="ds-label">{t("todo.fields.priority")}</span>
          <select id={`${base}-priority`} className="ds-input" value={String(priority)} onChange={(e) => setPriority(Number(e.target.value))}>
            {[0, 1, 2].map((p) => (
              <option key={p} value={String(p)}>
                {t(`todo.priority.p${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-due`}>
          <span className="ds-label">{t("todo.fields.dueDate")}</span>
          <input id={`${base}-due`} type="date" className="ds-input" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1" htmlFor={`${base}-tags`}>
        <span className="ds-label">{t("todo.fields.tags")}</span>
        <input id={`${base}-tags`} className="ds-input" value={tags} placeholder={t("todo.tagsHint")} onChange={(e) => setTags(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${base}-notes`}>
        <span className="ds-label">{t("todo.fields.description")}</span>
        <textarea id={`${base}-notes`} className="ds-input min-h-20 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="ds-label mb-1">{t("todo.fields.assignees")}</legend>
        <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-[var(--ds-radius-md)] border p-2" style={{ borderColor: "var(--ds-border)" }}>
          {(users.data ?? []).map((u) => (
            <label key={u.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={assignees.includes(u.id)}
                disabled={u.id === userId}
                onChange={(e) => setAssignees(e.target.checked ? [...assignees, u.id] : assignees.filter((x) => x !== u.id))}
              />
              <span>{u.full_name || t("views.chatter.unnamedUser")}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
          {error}
        </p>
      ) : null}
      <div className="flex justify-between gap-2">
        <span>
          {task.created_by === userId || isAdmin ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={busy} onClick={() => actions.remove.mutate(task.id, { onSuccess: onClose, onError: fail })}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("todo.delete")}
            </button>
          ) : null}
        </span>
        <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy}>
          {t("common.save")}
        </button>
      </div>
    </form>
  );
}

function Checklist({ task, fmt }: { task: TodoTaskRow; fmt: Formatter }) {
  const { t } = fmt;
  const { user } = useAuth();
  const { toast } = useToast();
  const actions = useTodoActions(user?.id ?? null);
  const [label, setLabel] = useState("");
  const items = [...(task.todo_checklist_items ?? [])].sort((a, b) => a.sequence - b.sequence);
  const done = items.filter((i) => i.done).length;
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
  const add = () => {
    const text = label.trim().slice(0, 300);
    if (!text) return;
    actions.addItem.mutate({ taskId: task.id, label: text, sequence: (items.at(-1)?.sequence ?? 0) + 10 }, { onSuccess: () => setLabel(""), onError: fail });
  };
  return (
    <section className="ds-card ds-card-pad flex flex-col gap-2" aria-labelledby={`checklist-${task.id}`}>
      <h3 id={`checklist-${task.id}`} className="ds-label flex items-center gap-2">
        {t("todo.checklist.title")}
        {items.length ? <span className="ds-chip">{`${done}/${items.length}`}</span> : null}
      </h3>
      {items.length ? (
        <ul className="flex flex-col gap-1">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <input type="checkbox" checked={i.done} aria-label={i.label} onChange={(e) => actions.toggleItem.mutate({ id: i.id, done: e.target.checked }, { onError: fail })} />
              <span className="min-w-0 flex-1" style={i.done ? { textDecoration: "line-through", color: "var(--ds-text-subtle)" } : undefined}>
                {i.label}
              </span>
              <button type="button" className="ds-icon-btn h-7 w-7" aria-label={t("todo.checklist.remove", { label: i.label })} onClick={() => actions.removeItem.mutate(i.id, { onError: fail })}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ds-muted text-[length:var(--ds-text-xs)]">{t("todo.checklist.empty")}</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="sr-only" htmlFor={`checklist-add-${task.id}`}>
          {t("todo.checklist.add")}
        </label>
        <input id={`checklist-add-${task.id}`} className="ds-input flex-1" maxLength={300} value={label} placeholder={t("todo.checklist.add")} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" className="ds-btn ds-btn-sm" disabled={!label.trim() || actions.addItem.isPending} aria-label={t("todo.checklist.add")}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </form>
      {items.length && done === items.length ? (
        <p className="flex items-center gap-1 text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-success)" }}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          {t("todo.checklist.allDone")}
        </p>
      ) : null}
    </section>
  );
}
