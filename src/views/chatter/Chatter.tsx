"use client";

import React, { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CalendarClock, Check, CheckCircle2, ListTodo, MessageSquare, Phone, StickyNote, Trash2, Undo2, Users } from "lucide-react";
import { useToast } from "@/design-system/components";
import { listItemVariants, motionPreset } from "@/design-system/motion";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Formatter } from "../logic";
import { useActivities, useChatterActions, useChatterUsers, useMessages } from "./data";
import {
  ACTIVITY_TYPES,
  activityState,
  canChangeActivity,
  canDeleteActivity,
  checkActivity,
  checkMessage,
  counts,
  daysUntil,
  initials,
  parseLog,
  sortActivities,
  type Activity,
  type ActivityState,
  type ActivityType,
  type ChatterMessage,
  type ChatterModel,
} from "./logic";

const TYPE_ICON: Record<ActivityType, React.ComponentType<{ className?: string }>> = { todo: ListTodo, call: Phone, meeting: Users };
const STATE_COLOR: Record<ActivityState, string> = { overdue: "var(--ds-danger-strong)", today: "var(--ds-warning)", planned: "var(--ds-success)", done: "var(--ds-text-subtle)" };

type Mode = "message" | "note" | "activity" | null;

/**
 * Chatter of a record (phase 19; references dashboards/dashboards-activity-feed-panel and
 * blog/blog-comment-thread-with-replies, rebuilt): send a message, log an internal note, schedule
 * a to-do / call / meeting; the record's activities by due date (overdue, today, planned) with a
 * done switch; and the thread, newest first. What a user sees and may write follows the
 * record's own access (row level security).
 */
export function Chatter({ model, recordId, fmt }: { model: ChatterModel; recordId: string; fmt: Formatter }) {
  const { t } = fmt;
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const reduced = useReducedMotion();
  const messages = useMessages(model, recordId);
  const activities = useActivities(model, recordId);
  const actions = useChatterActions(model, recordId);
  const [mode, setMode] = useState<Mode>(null);
  const [now] = useState(() => new Date());
  const userId = user?.id ?? null;
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");

  const list = sortActivities(activities.data ?? []);
  const open = list.filter((a) => !a.done_at);
  const done = list.filter((a) => a.done_at);
  const c = counts(list, now);

  return (
    <section className="ds-card ds-card-pad flex flex-col gap-4" aria-label={t("views.chatter.title")}>
      <div role="toolbar" aria-label={t("views.chatter.title")} className="flex flex-wrap gap-2">
        {(
          [
            ["message", MessageSquare, t("views.chatter.sendMessage")],
            ["note", StickyNote, t("views.chatter.logNote")],
            ["activity", CalendarClock, t("views.chatter.schedule")],
          ] as const
        ).map(([m, Icon, label]) => (
          <button key={m} type="button" className={["ds-btn ds-btn-sm", mode === m ? "ds-btn-primary" : ""].join(" ")} aria-pressed={mode === m} onClick={() => setMode(mode === m ? null : m)}>
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {mode === "message" || mode === "note" ? (
        <MessageComposer
          kind={mode}
          fmt={fmt}
          busy={actions.post.isPending}
          onCancel={() => setMode(null)}
          onSubmit={(body) => actions.post.mutate({ kind: mode, body }, { onSuccess: () => setMode(null), onError: fail })}
        />
      ) : null}
      {mode === "activity" ? (
        <ActivityComposer fmt={fmt} busy={actions.schedule.isPending} onCancel={() => setMode(null)} onSubmit={(v) => actions.schedule.mutate(v, { onSuccess: () => setMode(null), onError: fail })} />
      ) : null}

      <div>
        <h3 className="mb-2 flex items-center gap-2 ds-label">
          {t("views.chatter.activities")}
          {c.overdue ? <span className="ds-chip" style={{ background: "var(--ds-danger-soft)", color: "var(--ds-danger-strong)" }}>{t("views.chatter.overdueCount", { count: c.overdue })}</span> : null}
          {c.today ? <span className="ds-chip" style={{ background: "var(--ds-warning-soft)", color: "var(--ds-text)" }}>{t("views.chatter.todayCount", { count: c.today })}</span> : null}
        </h3>
        {activities.isLoading ? (
          <p className="ds-muted">{t("common.loading")}</p>
        ) : open.length === 0 ? (
          <p className="ds-muted text-[length:var(--ds-text-xs)]">{t("views.chatter.noActivities")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {open.map((a) => (
                <motion.li key={a.id} layout={!reduced} variants={motionPreset(listItemVariants, reduced)} initial="initial" animate="enter" exit="exit">
                  <ActivityRow
                    activity={a}
                    now={now}
                    fmt={fmt}
                    canChange={canChangeActivity(a, userId, isAdmin)}
                    canDelete={canDeleteActivity(a, userId, isAdmin)}
                    onDone={(value) => actions.setDone.mutate({ id: a.id, done: value }, { onError: fail })}
                    onDelete={() => actions.removeActivity.mutate(a.id, { onError: fail })}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {done.length ? (
          <details className="mt-2">
            <summary className="cursor-pointer ds-muted text-[length:var(--ds-text-xs)]">{t("views.chatter.doneCount", { count: done.length })}</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {done.map((a) => (
                <li key={a.id}>
                  <ActivityRow
                    activity={a}
                    now={now}
                    fmt={fmt}
                    canChange={canChangeActivity(a, userId, isAdmin)}
                    canDelete={canDeleteActivity(a, userId, isAdmin)}
                    onDone={(value) => actions.setDone.mutate({ id: a.id, done: value }, { onError: fail })}
                    onDelete={() => actions.removeActivity.mutate(a.id, { onError: fail })}
                  />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 ds-label">{t("views.chatter.thread")}</h3>
        {messages.isLoading ? (
          <p className="ds-muted">{t("common.loading")}</p>
        ) : !messages.data?.length ? (
          <p className="ds-muted text-[length:var(--ds-text-xs)]">{t("views.chatter.noMessages")}</p>
        ) : (
          <ol className="flex flex-col gap-3" aria-live="polite">
            <AnimatePresence initial={false}>
              {messages.data.map((m) => (
                <motion.li key={m.id} variants={motionPreset(listItemVariants, reduced)} initial="initial" animate="enter" exit="exit">
                  <MessageRow message={m} fmt={fmt} canDelete={!!userId && m.author_id === userId && m.kind !== "log"} onDelete={() => actions.removeMessage.mutate(m.id, { onError: fail })} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </section>
  );
}

function MessageComposer({ kind, fmt, busy, onCancel, onSubmit }: { kind: "message" | "note"; fmt: Formatter; busy: boolean; onCancel: () => void; onSubmit: (body: string) => void }) {
  const { t } = fmt;
  const id = useId();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const checked = checkMessage(body);
    if (!checked.ok) {
      setError(t(checked.error));
      return;
    }
    setError(null);
    onSubmit(checked.body);
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {kind === "note" ? t("views.chatter.logNote") : t("views.chatter.sendMessage")}
      </label>
      <textarea
        id={id}
        autoFocus
        className="ds-input min-h-24 py-2"
        style={kind === "note" ? { background: "var(--ds-warning-soft)" } : undefined}
        placeholder={kind === "note" ? t("views.chatter.notePlaceholder") : t("views.chatter.messagePlaceholder")}
        value={body}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : `${id}-hint`}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="ds-subtle text-[length:var(--ds-text-xs)]">
          {kind === "note" ? t("views.chatter.noteHint") : t("views.chatter.messageHint")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy}>
          {kind === "note" ? t("views.chatter.logNote") : t("views.chatter.send")}
        </button>
      </div>
    </form>
  );
}

function ActivityComposer({
  fmt,
  busy,
  onCancel,
  onSubmit,
}: {
  fmt: Formatter;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { activity_type: ActivityType; summary: string; due_date: string; assigned_to: string | null; note: string | null }) => void;
}) {
  const { t } = fmt;
  const { user } = useAuth();
  const users = useChatterUsers(true);
  const base = useId();
  const [type, setType] = useState<ActivityType>("todo");
  const [summary, setSummary] = useState("");
  const [due, setDue] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [assignee, setAssignee] = useState<string>(user?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--ds-radius-md)] p-3"
      style={{ background: "var(--ds-surface-sunken)" }}
      onSubmit={(e) => {
        e.preventDefault();
        const checked = checkActivity({ activity_type: type, summary, due_date: due, assigned_to: assignee || null, note });
        if (!checked.ok) {
          setError(t(checked.error));
          return;
        }
        setError(null);
        onSubmit(checked.value);
      }}
    >
      <div role="radiogroup" aria-label={t("views.chatter.activityType")} className="flex flex-wrap gap-2">
        {ACTIVITY_TYPES.map((value) => {
          const Icon = TYPE_ICON[value];
          return (
            <button key={value} type="button" role="radio" aria-checked={type === value} className={["ds-btn ds-btn-sm", type === value ? "ds-btn-primary" : ""].join(" ")} onClick={() => setType(value)}>
              <Icon className="h-4 w-4" aria-hidden />
              {t(`views.chatter.type.${value}`)}
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1" htmlFor={`${base}-summary`}>
        <span className="ds-label">{t("views.chatter.summary")}</span>
        <input id={`${base}-summary`} className="ds-input" autoFocus maxLength={200} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor={`${base}-due`}>
          <span className="ds-label">{t("views.chatter.dueDate")}</span>
          <input id={`${base}-due`} type="date" className="ds-input" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-who`}>
          <span className="ds-label">{t("views.chatter.assignee")}</span>
          <select id={`${base}-who`} className="ds-input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">—</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1" htmlFor={`${base}-note`}>
        <span className="ds-label">{t("views.chatter.activityNote")}</span>
        <textarea id={`${base}-note`} className="ds-input min-h-16 py-2" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy}>
          {t("views.chatter.schedule")}
        </button>
      </div>
    </form>
  );
}

function ActivityRow({ activity: a, now, fmt, canChange, canDelete, onDone, onDelete }: { activity: Activity; now: Date; fmt: Formatter; canChange: boolean; canDelete: boolean; onDone: (done: boolean) => void; onDelete: () => void }) {
  const { t } = fmt;
  const users = useChatterUsers(true);
  const state = activityState(a, now);
  const Icon = TYPE_ICON[a.activity_type] ?? ListTodo;
  const days = daysUntil(a.due_date, now);
  const who = users.data?.find((u) => u.id === a.assigned_to)?.full_name;
  const when = state === "done" ? t("views.chatter.state.done") : state === "today" ? t("views.chatter.state.today") : state === "overdue" ? t("views.chatter.state.overdue", { days: -days }) : t("views.chatter.state.planned", { days });
  return (
    <div className="flex items-start gap-2 rounded-[var(--ds-radius-md)] border p-2" style={{ borderColor: "var(--ds-border)", opacity: state === "done" ? 0.7 : 1 }}>
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: "var(--ds-surface-sunken)", color: STATE_COLOR[state] }} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium" style={state === "done" ? { textDecoration: "line-through" } : undefined}>
          {a.summary}
        </p>
        <p className="text-[length:var(--ds-text-xs)]">
          <span style={{ color: STATE_COLOR[state] }}>{when}</span>
          <span className="ds-muted">{` · ${t(`views.chatter.type.${a.activity_type}`)}${who ? ` · ${who}` : ""}`}</span>
        </p>
        {a.note ? <p className="mt-1 whitespace-pre-wrap ds-muted text-[length:var(--ds-text-xs)]">{a.note}</p> : null}
      </div>
      {canChange ? (
        <button type="button" className="ds-icon-btn h-8 w-8" aria-label={a.done_at ? t("views.chatter.reopen", { summary: a.summary }) : t("views.chatter.markDone", { summary: a.summary })} onClick={() => onDone(!a.done_at)}>
          {a.done_at ? <Undo2 className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        </button>
      ) : null}
      {canDelete ? (
        <button type="button" className="ds-icon-btn h-8 w-8" aria-label={t("views.chatter.deleteActivity", { summary: a.summary })} onClick={onDelete}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function MessageRow({ message: m, fmt, canDelete, onDelete }: { message: ChatterMessage; fmt: Formatter; canDelete: boolean; onDelete: () => void }) {
  const { t, locale } = fmt;
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(m.created_at));
  const log = m.kind === "log" ? parseLog(m.body) : null;
  if (m.kind === "log") {
    return (
      <div className="flex items-center gap-2 text-[length:var(--ds-text-xs)] ds-muted">
        <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "var(--ds-success)" }} aria-hidden />
        <span>
          {log ? t("views.chatter.logActivityDone", { name: m.author_name ?? "—", type: log.type ? t(`views.chatter.type.${log.type}`) : "", summary: log.summary }) : m.body}
        </span>
        <time dateTime={m.created_at} className="ml-auto shrink-0 ds-subtle">
          {time}
        </time>
      </div>
    );
  }
  return (
    <article className="flex gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[length:var(--ds-text-xs)] font-semibold" style={{ background: "var(--ds-brand-soft)", color: "var(--ds-brand)" }} aria-hidden>
        {initials(m.author_name)}
      </span>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{m.author_name ?? "—"}</span>
          {m.kind === "note" ? <span className="ds-chip" style={{ background: "var(--ds-warning-soft)", color: "var(--ds-text)" }}>{t("views.chatter.noteBadge")}</span> : null}
          <time dateTime={m.created_at} className="ds-subtle text-[length:var(--ds-text-xs)]">
            {time}
            {m.edited_at ? ` · ${t("views.chatter.edited")}` : ""}
          </time>
          {canDelete ? (
            <button type="button" className="ml-auto ds-icon-btn h-7 w-7" aria-label={t("views.chatter.deleteMessage")} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </header>
        <p className="whitespace-pre-wrap break-words rounded-[var(--ds-radius-md)] px-3 py-2" style={{ background: m.kind === "note" ? "var(--ds-warning-soft)" : "var(--ds-surface-sunken)" }}>
          {m.body}
        </p>
      </div>
    </article>
  );
}
