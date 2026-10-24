"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Columns3, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { EngineScreen, RecordPanel, RECORD_PARAM, useFormatter, useViewAccess, type ViewData } from "@/views";
import { parseCapture, sortStages, stageLabel, toTodoRecords, type TodoRecord, type TodoStage } from "../lib/todo";
import { useMyTasks, useStageActions, useStages, useTodoActions } from "../lib/data";
import { todoDefinition } from "../views/todo";
import { PriorityStack } from "./PriorityStack";
import { TaskPanel } from "./TaskPanel";

/**
 * The To-do module's screen (phase 22, new UI only): the user's tasks as a kanban of their own
 * stages (drag to move, into "Done" finishes) and a list, the priority stack on top, quick
 * capture ("?capture=1" from the command palette opens it), the stage editor and the task panel.
 */
export default function TodoScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const stages = useStages(userId);
  const tasks = useMyTasks(userId);
  const actions = useTodoActions(userId);
  const stageList = useMemo(() => stages.data ?? [], [stages.data]);
  const definition = useMemo(() => todoDefinition(stageList, t), [stageList, t]);
  const access = useViewAccess(definition);
  const records = useMemo(() => toTodoRecords(tasks.data ?? [], stageList), [tasks.data, stageList]);

  const data: ViewData<TodoRecord> = {
    status: !access.ready ? "loading" : !access.read ? "forbidden" : tasks.isError || stages.isError ? "error" : tasks.data && stages.data ? "ready" : "loading",
    definition,
    records,
    capped: (tasks.data?.length ?? 0) >= 2000,
    canWrite: access.write,
    error: tasks.error?.message ?? stages.error?.message ?? null,
    refetch: () => void tasks.refetch(),
  };

  return (
    <EngineScreen
      definition={definition}
      title={t("todo.title")}
      data={data}
      actions={
        <>
          <StagesButton stages={stageList} />
          <CaptureButton stages={stageList} />
        </>
      }
      dashboard={(rs, fmt) => <PriorityStack records={rs} fmt={fmt} onReorder={(updates) => actions.reorder.mutate(updates)} hrefOf={(r) => `/todo?${RECORD_PARAM}=${encodeURIComponent(r.id)}`} />}
      onMove={(r, value) => actions.move.mutate({ taskId: r.id, stageId: value })}
      recordTitle={(r) => r.title}
      renderRecord={(r, { close }) => <TaskPanelInScope record={r} stages={stageList} onClose={close} />}
    />
  );
}

function TaskPanelInScope({ record, stages, onClose }: { record: TodoRecord; stages: readonly TodoStage[]; onClose: () => void }) {
  const fmt = useFormatter();
  return <TaskPanel taskId={record.id} stageId={record.stage_id} stages={stages} fmt={fmt} onClose={onClose} />;
}

/** Quick capture: one line with "!" / "!!" for priority and "#tag", the stage and a due date. */
function CaptureButton({ stages }: { stages: readonly TodoStage[] }) {
  const fmt = useFormatter();
  const { t } = fmt;
  const { user } = useAuth();
  const { toast } = useToast();
  const actions = useTodoActions(user?.id ?? null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Opened from the command palette ("New to-do" → /todo?capture=1).
  useEffect(() => {
    if (params.get("capture") !== "1") return;
    const timer = window.setTimeout(() => {
      setOpen(true);
      router.replace(pathname, { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [params, router, pathname]);

  const submit = () => {
    const parsed = parseCapture(text);
    if (!parsed.title) {
      setError(t("todo.errors.title"));
      return;
    }
    setError(null);
    actions.create.mutate(
      { title: parsed.title, description: null, priority: parsed.priority, tags: parsed.tags, due_date: due || null, stage_id: stage || null },
      {
        onSuccess: () => {
          setText("");
          setDue("");
          setOpen(false);
          toast(t("todo.captured"), parsed.title, "success");
        },
        onError: (err) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error"),
      }
    );
  };

  return (
    <>
      <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("todo.new")}
      </button>
      <RecordPanel open={open} onClose={() => setOpen(false)} title={t("todo.new")} closeLabel={t("common.close")}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-1" htmlFor="todo-capture">
            <span className="ds-label">{t("todo.capture.label")}</span>
            <input id="todo-capture" className="ds-input" autoFocus maxLength={400} value={text} placeholder={t("todo.capture.placeholder")} onChange={(e) => setText(e.target.value)} aria-describedby="todo-capture-hint" />
          </label>
          <p id="todo-capture-hint" className="ds-subtle text-[length:var(--ds-text-xs)]">
            {t("todo.capture.hint")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1" htmlFor="todo-capture-stage">
              <span className="ds-label">{t("todo.fields.stage")}</span>
              <select id="todo-capture-stage" className="ds-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">{t("todo.capture.firstStage")}</option>
                {sortStages(stages)
                  .filter((s) => !s.is_done)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {stageLabel(s, t)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1" htmlFor="todo-capture-due">
              <span className="ds-label">{t("todo.fields.dueDate")}</span>
              <input id="todo-capture-due" type="date" className="ds-input" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={actions.create.isPending}>
              {t("todo.capture.save")}
            </button>
          </div>
        </form>
      </RecordPanel>
    </>
  );
}

/** The user's own stages: rename, reorder, add, delete (its cards go to the first stage). */
function StagesButton({ stages }: { stages: readonly TodoStage[] }) {
  const fmt = useFormatter();
  const { t } = fmt;
  const { user } = useAuth();
  const { toast } = useToast();
  const actions = useStageActions(user?.id ?? null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ordered = sortStages(stages);
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    actions.setSequence.mutate(next.map((s, k) => ({ id: s.id, sequence: (k + 1) * 10 })), { onError: fail });
  };
  return (
    <>
      <button type="button" className="ds-btn ds-btn-sm" onClick={() => setOpen(true)}>
        <Columns3 className="h-4 w-4" aria-hidden />
        {t("todo.stagesEditor.open")}
      </button>
      <RecordPanel open={open} onClose={() => setOpen(false)} title={t("todo.stagesEditor.title")} closeLabel={t("common.close")}>
        <ul className="flex flex-col gap-2">
          {ordered.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`stage-${s.id}`}>
                {t("todo.stagesEditor.name")}
              </label>
              <input
                id={`stage-${s.id}`}
                className="ds-input flex-1"
                maxLength={60}
                defaultValue={stageLabel(s, t)}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== stageLabel(s, t)) actions.rename.mutate({ id: s.id, name: v }, { onError: fail });
                }}
              />
              {s.is_done ? <span className="ds-chip">{t("todo.stagesEditor.doneStage")}</span> : null}
              <button type="button" className="ds-icon-btn h-8 w-8" aria-label={t("todo.stagesEditor.up", { name: stageLabel(s, t) })} disabled={i === 0} onClick={() => swap(i, i - 1)}>
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" className="ds-icon-btn h-8 w-8" aria-label={t("todo.stagesEditor.down", { name: stageLabel(s, t) })} disabled={i === ordered.length - 1} onClick={() => swap(i, i + 1)}>
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className="ds-icon-btn h-8 w-8"
                aria-label={t("todo.stagesEditor.delete", { name: stageLabel(s, t) })}
                disabled={s.is_done || ordered.filter((x) => !x.is_done).length <= 1}
                onClick={() => actions.remove.mutate(s.id, { onError: fail })}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = name.trim();
            if (!v) return;
            const doneSeq = ordered.find((s) => s.is_done)?.sequence;
            const lastOpen = ordered.filter((s) => !s.is_done).at(-1)?.sequence ?? 0;
            const sequence = doneSeq !== undefined && doneSeq > lastOpen + 1 ? Math.floor((lastOpen + doneSeq) / 2) : lastOpen + 10;
            actions.add.mutate({ name: v, sequence }, { onSuccess: () => setName(""), onError: fail });
          }}
        >
          <label className="sr-only" htmlFor="todo-stage-new">
            {t("todo.stagesEditor.add")}
          </label>
          <input id="todo-stage-new" className="ds-input flex-1" maxLength={60} value={name} placeholder={t("todo.stagesEditor.add")} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="ds-btn ds-btn-sm" disabled={!name.trim()}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("todo.stagesEditor.addButton")}
          </button>
        </form>
      </RecordPanel>
    </>
  );
}
