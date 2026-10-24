"use client";

import React, { useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Bell,
  BellOff,
  CalendarClock,
  Check,
  CheckCircle2,
  FileText,
  History,
  ListTodo,
  Mail,
  MessageSquare,
  Paperclip,
  Phone,
  StickyNote,
  Trash2,
  Undo2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useToast } from "@/design-system/components";
import { listItemVariants, motionPreset } from "@/design-system/motion";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Formatter } from "../logic";
import { attachmentUrl, useNow, useActivities, useActivityTypes, useChatterActions, useChatterUsers, useFollowers, useMessages } from "./data";
import {
  activityState,
  activityTypeLabel,
  canChangeActivity,
  canDeleteActivity,
  checkActivity,
  checkFiles,
  checkMessage,
  counts,
  daysUntil,
  dueIn,
  fileSize,
  initials,
  parseLog,
  selectableTypes,
  sortActivities,
  trackedValue,
  type Activity,
  type ActivityIcon,
  type ActivityState,
  type ActivityType,
  type ActivityTypeRow,
  type ChatterAttachment,
  type ChatterMessage,
  type ChatterModel,
} from "./logic";

export const ACTIVITY_ICON: Record<ActivityIcon, React.ComponentType<{ className?: string }>> = { todo: ListTodo, call: Phone, meeting: Users, email: Mail, document: FileText };
const STATE_COLOR: Record<ActivityState, string> = { overdue: "var(--ds-danger-strong)", today: "var(--ds-warning)", planned: "var(--ds-success)", done: "var(--ds-text-subtle)" };


type Mode = "message" | "note" | "activity" | null;

/**
 * Chatter of a record (phase 19; references dashboards/dashboards-activity-feed-panel and
 * blog/blog-comment-thread-with-replies, rebuilt): send a message or log an internal note with
 * files, schedule an activity of any configured type; follow the record; the record's
 * activities by due date (overdue, today, planned) with a done switch; and the thread, newest
 * first, with tracked field changes. What a user sees and may write follows the record's own
 * access (row level security).
 */
export function Chatter({ model, recordId, fmt }: { model: ChatterModel; recordId: string; fmt: Formatter }) {
  const { t } = fmt;
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const reduced = useReducedMotion();
  const messages = useMessages(model, recordId);
  const activities = useActivities(model, recordId);
  const types = useActivityTypes().data ?? [];
  const actions = useChatterActions(model, recordId);
  const [mode, setMode] = useState<Mode>(null);
  const now = useNow();
  const userId = user?.id ?? null;
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");

  const list = sortActivities(activities.data ?? []);
  const open = list.filter((a) => !a.done_at);
  const done = list.filter((a) => a.done_at);
  const c = counts(list, now);

  return (
    <section className="ds-card ds-card-pad flex flex-col gap-4" aria-label={t("views.chatter.title")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
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
        <Followers model={model} recordId={recordId} fmt={fmt} onError={fail} />
      </div>

      {mode === "message" || mode === "note" ? (
        <MessageComposer
          kind={mode}
          fmt={fmt}
          busy={actions.post.isPending}
          onCancel={() => setMode(null)}
          onSubmit={(body, files) => actions.post.mutate({ kind: mode, body, files }, { onSuccess: () => setMode(null), onError: fail })}
        />
      ) : null}
      {mode === "activity" ? (
        <ActivityComposer fmt={fmt} types={types} busy={actions.schedule.isPending} onCancel={() => setMode(null)} onSubmit={(v) => actions.schedule.mutate(v, { onSuccess: () => setMode(null), onError: fail })} />
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
                    types={types}
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
                    types={types}
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
                  <MessageRow message={m} fmt={fmt} types={types} onError={fail} canDelete={!!userId && m.author_id === userId && m.kind !== "log"} onDelete={() => actions.removeMessage.mutate(m, { onError: fail })} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </section>
  );
}

/** Who follows the record: follow / unfollow yourself, add a colleague, remove followers you may remove. */
function Followers({ model, recordId, fmt, onError }: { model: ChatterModel; recordId: string; fmt: Formatter; onError: (err: unknown) => void }) {
  const { t } = fmt;
  const { user, isAdmin } = useAuth();
  const followers = useFollowers(model, recordId);
  const actions = useChatterActions(model, recordId);
  const [open, setOpen] = useState(false);
  const users = useChatterUsers(open);
  const list = followers.data ?? [];
  const mine = list.find((f) => f.user_id === user?.id);
  const name = (id: string) => users.data?.find((u) => u.id === id)?.full_name || t("views.chatter.unnamedUser");
  const addable = (users.data ?? []).filter((u) => !list.some((f) => f.user_id === u.id));
  const selectId = useId();
  return (
    <div className="flex items-center gap-1">
      {user ? (
        <button
          type="button"
          className="ds-btn ds-btn-sm ds-btn-ghost"
          aria-pressed={!!mine}
          disabled={actions.follow.isPending || actions.unfollow.isPending}
          onClick={() => (mine ? actions.unfollow.mutate(mine.id, { onError }) : actions.follow.mutate(user.id, { onError }))}
        >
          {mine ? <BellOff className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
          {mine ? t("views.chatter.unfollow") : t("views.chatter.follow")}
        </button>
      ) : null}
      <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="relative">
        <summary className="ds-btn ds-btn-sm ds-btn-ghost cursor-pointer list-none" aria-label={t("views.chatter.followersCount", { count: list.length })}>
          <Users className="h-4 w-4" aria-hidden />
          {list.length}
        </summary>
        <div className="ds-menu absolute right-0 z-10 mt-1 w-64 p-2">
          <p className="px-1 pb-1 font-semibold">{t("views.chatter.followers")}</p>
          {list.length ? (
            <ul className="flex flex-col gap-1">
              {list.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-1">
                  <span className="min-w-0 flex-1 truncate">{name(f.user_id)}</span>
                  {f.user_id === user?.id || f.added_by === user?.id || isAdmin ? (
                    <button type="button" className="ds-icon-btn h-7 w-7" aria-label={t("views.chatter.removeFollower", { name: name(f.user_id) })} onClick={() => actions.unfollow.mutate(f.id, { onError })}>
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 ds-muted text-[length:var(--ds-text-xs)]">{t("views.chatter.noFollowers")}</p>
          )}
          {addable.length ? (
            <div className="mt-2 flex items-center gap-1">
              <label htmlFor={selectId} className="sr-only">
                {t("views.chatter.addFollower")}
              </label>
              <UserPlus className="h-4 w-4 shrink-0 ds-muted" aria-hidden />
              <select
                id={selectId}
                className="ds-input h-8 flex-1"
                value=""
                onChange={(e) => {
                  if (e.target.value) actions.follow.mutate(e.target.value, { onError });
                }}
              >
                <option value="">{t("views.chatter.addFollower")}</option>
                {addable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || t("views.chatter.unnamedUser")}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function MessageComposer({ kind, fmt, busy, onCancel, onSubmit }: { kind: "message" | "note"; fmt: Formatter; busy: boolean; onCancel: () => void; onSubmit: (body: string, files: File[]) => void }) {
  const { t } = fmt;
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const checked = checkMessage(body);
    if (!checked.ok) {
      setError(t(checked.error));
      return;
    }
    const filesOk = checkFiles(files);
    if (!filesOk.ok) {
      setError(t(filesOk.error));
      return;
    }
    setError(null);
    onSubmit(checked.body, files);
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
      {files.length ? (
        <ul className="flex flex-wrap gap-1" aria-label={t("views.chatter.files")}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="ds-chip flex items-center gap-1">
              <Paperclip className="h-3 w-3" aria-hidden />
              <span className="max-w-40 truncate">{f.name}</span>
              <span className="ds-subtle">{fileSize(f.size)}</span>
              <button type="button" className="ds-icon-btn h-5 w-5" aria-label={t("views.chatter.removeFile", { name: f.name })} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="ds-subtle text-[length:var(--ds-text-xs)]">
          {kind === "note" ? t("views.chatter.noteHint") : t("views.chatter.messageHint")}
        </p>
      )}
      <div className="flex justify-between gap-2">
        <span>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              setFiles([...files, ...picked]);
            }}
          />
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => fileInput.current?.click()}>
            <Paperclip className="h-4 w-4" aria-hidden />
            {t("views.chatter.attach")}
          </button>
        </span>
        <span className="flex gap-2">
          <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy}>
            {kind === "note" ? t("views.chatter.logNote") : t("views.chatter.send")}
          </button>
        </span>
      </div>
    </form>
  );
}

function ActivityComposer({
  fmt,
  types,
  busy,
  onCancel,
  onSubmit,
}: {
  fmt: Formatter;
  types: readonly ActivityTypeRow[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { activity_type: ActivityType; summary: string; due_date: string; assigned_to: string | null; note: string | null }) => void;
}) {
  const { t } = fmt;
  const { user } = useAuth();
  const users = useChatterUsers(true);
  const base = useId();
  const choices = selectableTypes(types);
  const [type, setType] = useState<ActivityType>(choices[0]?.code ?? "todo");
  const [summary, setSummary] = useState("");
  const [due, setDue] = useState(() => dueIn(choices[0]?.default_days ?? 0, new Date()));
  const [assignee, setAssignee] = useState<string>(user?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pick = (row: ActivityTypeRow) => {
    setType(row.code);
    setDue(dueIn(row.default_days, new Date()));
  };
  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--ds-radius-md)] p-3"
      style={{ background: "var(--ds-surface-sunken)" }}
      onSubmit={(e) => {
        e.preventDefault();
        const checked = checkActivity(
          { activity_type: type, summary, due_date: due, assigned_to: assignee || null, note },
          choices.map((x) => x.code),
        );
        if (!checked.ok) {
          setError(t(checked.error));
          return;
        }
        setError(null);
        onSubmit(checked.value);
      }}
    >
      <div role="radiogroup" aria-label={t("views.chatter.activityType")} className="flex flex-wrap gap-2">
        {choices.map((row) => {
          const Icon = ACTIVITY_ICON[row.icon] ?? ListTodo;
          return (
            <button key={row.code} type="button" role="radio" aria-checked={type === row.code} className={["ds-btn ds-btn-sm", type === row.code ? "ds-btn-primary" : ""].join(" ")} onClick={() => pick(row)}>
              <Icon className="h-4 w-4" aria-hidden />
              {activityTypeLabel(row.code, types, t)}
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
                {u.full_name || t("views.chatter.unnamedUser")}
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

function ActivityRow({
  activity: a,
  now,
  fmt,
  types,
  canChange,
  canDelete,
  onDone,
  onDelete,
}: {
  activity: Activity;
  now: Date;
  fmt: Formatter;
  types: readonly ActivityTypeRow[];
  canChange: boolean;
  canDelete: boolean;
  onDone: (done: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = fmt;
  const users = useChatterUsers(true);
  const state = activityState(a, now);
  const Icon = ACTIVITY_ICON[types.find((x) => x.code === a.activity_type)?.icon ?? "todo"] ?? ListTodo;
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
          <span className="ds-muted">{` · ${activityTypeLabel(a.activity_type, types, t)}${who ? ` · ${who}` : ""}`}</span>
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

function Attachments({ files, fmt, onError }: { files: readonly ChatterAttachment[]; fmt: Formatter; onError: (err: unknown) => void }) {
  const { t } = fmt;
  if (!files.length) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label={t("views.chatter.files")}>
      {files.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            className="ds-chip flex items-center gap-1"
            aria-label={t("views.chatter.download", { name: f.file_name })}
            onClick={() => {
              // Opened now, while the click still counts as the user's (Safari blocks a window
              // opened after the await); filled with the signed link once it arrives.
              const win = window.open("about:blank", "_blank");
              if (win) win.opener = null;
              attachmentUrl(f.storage_path).then(
                (url) => {
                  if (win) win.location.href = url;
                  else window.location.assign(url);
                },
                (err) => {
                  win?.close();
                  onError(err);
                },
              );
            }}
          >
            <Paperclip className="h-3 w-3" aria-hidden />
            <span className="max-w-48 truncate">{f.file_name}</span>
            <span className="ds-subtle">{fileSize(f.size_bytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function LogRow({ message: m, fmt, types, time }: { message: ChatterMessage; fmt: Formatter; types: readonly ActivityTypeRow[]; time: string }) {
  const { t } = fmt;
  const log = parseLog(m.body);
  const users = useChatterUsers(log?.event === "tracking");
  const name = m.author_name ?? (m.author_id ? t("views.chatter.unnamedUser") : t("views.chatter.system"));
  return (
    <div className="flex items-start gap-2 text-[length:var(--ds-text-xs)] ds-muted">
      {log?.event === "tracking" ? (
        <History className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--ds-brand)" }} aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--ds-success)" }} aria-hidden />
      )}
      {log?.event === "tracking" ? (
        <div className="min-w-0 flex-1">
          <span>{t("views.chatter.logChanged", { name })}</span>
          <ul className="mt-0.5">
            {log.changes.map((c) => (
              <li key={c.field}>
                <span className="font-medium" style={{ color: "var(--ds-text)" }}>
                  {t(`views.chatter.tracked.${c.field}`)}
                </span>
                {`: ${trackedValue(c.field, c.from, users.data ?? [])} → ${trackedValue(c.field, c.to, users.data ?? [])}`}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <span className="min-w-0 flex-1">{log ? t("views.chatter.logActivityDone", { name, type: activityTypeLabel(log.type, types, t), summary: log.summary }) : m.body}</span>
      )}
      <time dateTime={m.created_at} className="ml-auto shrink-0 ds-subtle">
        {time}
      </time>
    </div>
  );
}

function MessageRow({
  message: m,
  fmt,
  types,
  canDelete,
  onDelete,
  onError,
}: {
  message: ChatterMessage;
  fmt: Formatter;
  types: readonly ActivityTypeRow[];
  canDelete: boolean;
  onDelete: () => void;
  onError: (err: unknown) => void;
}) {
  const { t, locale } = fmt;
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(m.created_at));
  if (m.kind === "log") return <LogRow message={m} fmt={fmt} types={types} time={time} />;
  return (
    <article className="flex gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[length:var(--ds-text-xs)] font-semibold" style={{ background: "var(--ds-brand-soft)", color: "var(--ds-brand)" }} aria-hidden>
        {initials(m.author_name)}
      </span>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{m.author_name ?? t("views.chatter.unnamedUser")}</span>
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
        <Attachments files={m.mail_attachments ?? []} fmt={fmt} onError={onError} />
      </div>
    </article>
  );
}
