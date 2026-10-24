"use client";

import React, { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useChatterUsers } from "@/views/chatter/data";
import type { Formatter } from "@/views";
import { checkEvent, eventToInput, REMINDER_CHOICES, type CalendarEventRow, type EventInput } from "../lib/calendar";
import { useCalendarActions, type EventSave } from "../lib/data";

/** Repeat choices of the form, as RRULE text ("" = no repeat). */
export const REPEAT_CHOICES = [
  { value: "", key: "none" },
  { value: "FREQ=DAILY", key: "daily" },
  { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", key: "weekdays" },
  { value: "FREQ=WEEKLY", key: "weekly" },
  { value: "FREQ=MONTHLY", key: "monthly" },
  { value: "FREQ=YEARLY", key: "yearly" },
] as const;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The base rule of a stored rule (without COUNT/UNTIL), to pick its repeat choice. */
function baseRule(rule: string): string {
  return rule
    .split(";")
    .filter((p) => !p.startsWith("COUNT=") && !p.startsWith("UNTIL="))
    .join(";");
}

/**
 * Create or edit an event (phase 20): title, day and time (or all day), place, notes, privacy,
 * repeat, colleagues, the record's customer, and the user's own reminder. Only the organizer
 * (or an admin) edits; the database enforces it too.
 */
export function EventForm({
  event,
  partner,
  link,
  fmt,
  onDone,
  onError,
}: {
  event?: CalendarEventRow | null;
  /** The record's customer/supplier, offered as an attendee (new events from a record). */
  partner?: EventSave["partner"];
  link?: { res_model: string; res_id: string } | null;
  fmt: Formatter;
  onDone: () => void;
  onError: (err: unknown) => void;
}) {
  const { t } = fmt;
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const users = useChatterUsers(true);
  const actions = useCalendarActions(userId);
  const base = useId();
  const [input, setInput] = useState<EventInput>(() =>
    event ? eventToInput(event) : { title: "", date: today(), startTime: "09:00", endTime: "10:00", allDay: false, location: "", description: "", privacy: "public", recurrence: "" }
  );
  const [repeatCount, setRepeatCount] = useState(() => {
    const m = /COUNT=(\d+)/.exec(event?.recurrence ?? "");
    return m ? m[1] : "";
  });
  const [invited, setInvited] = useState<string[]>(() => (event?.calendar_attendees ?? []).filter((a) => a.user_id).map((a) => a.user_id!));
  const existingPartner = (event?.calendar_attendees ?? []).find((a) => a.partner_id);
  const offeredPartner: EventSave["partner"] = existingPartner
    ? { partner_model: existingPartner.partner_model!, partner_id: existingPartner.partner_id!, display_name: existingPartner.display_name ?? "" }
    : (partner ?? null);
  const [withPartner, setWithPartner] = useState(!!existingPartner || !!partner);
  const [reminder, setReminder] = useState<string>(() => {
    const mine = (event?.calendar_reminders ?? []).find((r) => r.user_id === userId && r.channel === "in_app");
    return mine ? String(mine.minutes_before) : event ? "" : "15";
  });
  const [error, setError] = useState<string | null>(null);
  const busy = actions.create.isPending || actions.update.isPending || actions.remove.isPending;
  const set = <K extends keyof EventInput>(key: K, value: EventInput[K]) => setInput((i) => ({ ...i, [key]: value }));
  const repeatBase = baseRule(input.recurrence);

  const submit = () => {
    const recurrence = repeatBase ? (repeatCount ? `${repeatBase};COUNT=${repeatCount}` : repeatBase) : "";
    const checked = checkEvent({ ...input, recurrence });
    if (!checked.ok) {
      setError(t(checked.error));
      return;
    }
    setError(null);
    const save: EventSave = {
      value: { ...checked.value, ...(link && !event ? { res_model: link.res_model, res_id: link.res_id } : {}) },
      users: invited,
      partner: withPartner ? offeredPartner : null,
      reminders: reminder === "" ? [] : [Number(reminder)],
    };
    if (event) actions.update.mutate({ event, save }, { onSuccess: onDone, onError });
    else actions.create.mutate(save, { onSuccess: onDone, onError });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-1" htmlFor={`${base}-title`}>
        <span className="ds-label">{t("calendar.fields.title")}</span>
        <input id={`${base}-title`} className="ds-input" autoFocus maxLength={200} value={input.title} onChange={(e) => set("title", e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1" htmlFor={`${base}-date`}>
          <span className="ds-label">{t("calendar.fields.date")}</span>
          <input id={`${base}-date`} type="date" className="ds-input" value={input.date} onChange={(e) => set("date", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-start`}>
          <span className="ds-label">{t("calendar.fields.start")}</span>
          <input id={`${base}-start`} type="time" className="ds-input" disabled={input.allDay} value={input.startTime} onChange={(e) => set("startTime", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-end`}>
          <span className="ds-label">{t("calendar.fields.end")}</span>
          <input id={`${base}-end`} type="time" className="ds-input" disabled={input.allDay} value={input.endTime} onChange={(e) => set("endTime", e.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={input.allDay} onChange={(e) => set("allDay", e.target.checked)} />
        <span>{t("calendar.fields.allDay")}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor={`${base}-repeat`}>
          <span className="ds-label">{t("calendar.fields.repeat")}</span>
          <select
            id={`${base}-repeat`}
            className="ds-input"
            value={REPEAT_CHOICES.some((c) => c.value === repeatBase) ? repeatBase : "custom"}
            onChange={(e) => set("recurrence", e.target.value === "custom" ? input.recurrence : e.target.value)}
          >
            {REPEAT_CHOICES.map((c) => (
              <option key={c.key} value={c.value}>
                {t(`calendar.repeat.${c.key}`)}
              </option>
            ))}
            {REPEAT_CHOICES.some((c) => c.value === repeatBase) ? null : <option value="custom">{input.recurrence}</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-count`}>
          <span className="ds-label">{t("calendar.fields.repeatCount")}</span>
          <input id={`${base}-count`} type="number" min={1} max={999} className="ds-input" disabled={!repeatBase} value={repeatCount} placeholder={t("calendar.repeat.forever")} onChange={(e) => setRepeatCount(e.target.value.replace(/\D/g, "").slice(0, 3))} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor={`${base}-location`}>
          <span className="ds-label">{t("calendar.fields.location")}</span>
          <input id={`${base}-location`} className="ds-input" maxLength={200} value={input.location} onChange={(e) => set("location", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${base}-privacy`}>
          <span className="ds-label">{t("calendar.fields.privacy")}</span>
          <select id={`${base}-privacy`} className="ds-input" value={input.privacy} onChange={(e) => set("privacy", e.target.value === "private" ? "private" : "public")}>
            <option value="public">{t("calendar.privacy.public")}</option>
            <option value="private">{t("calendar.privacy.private")}</option>
          </select>
        </label>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="ds-label mb-1">{t("calendar.fields.colleagues")}</legend>
        <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-[var(--ds-radius-md)] border p-2" style={{ borderColor: "var(--ds-border)" }}>
          {(users.data ?? [])
            .filter((u) => u.id !== (event?.organizer_id ?? userId))
            .map((u) => (
              <label key={u.id} className="flex items-center gap-2">
                <input type="checkbox" checked={invited.includes(u.id)} onChange={(e) => setInvited(e.target.checked ? [...invited, u.id] : invited.filter((x) => x !== u.id))} />
                <span>{u.full_name || t("views.chatter.unnamedUser")}</span>
              </label>
            ))}
        </div>
      </fieldset>
      {offeredPartner ? (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={withPartner} onChange={(e) => setWithPartner(e.target.checked)} />
          <span>{t("calendar.invitePartner", { name: offeredPartner.display_name || "—" })}</span>
        </label>
      ) : null}
      <label className="flex flex-col gap-1" htmlFor={`${base}-reminder`}>
        <span className="ds-label">{t("calendar.fields.reminder")}</span>
        <select id={`${base}-reminder`} className="ds-input" value={reminder} onChange={(e) => setReminder(e.target.value)}>
          <option value="">{t("calendar.reminder.none")}</option>
          {REMINDER_CHOICES.map((m) => (
            <option key={m} value={String(m)}>
              {t(`calendar.reminder.m${m}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${base}-notes`}>
        <span className="ds-label">{t("calendar.fields.description")}</span>
        <textarea id={`${base}-notes`} className="ds-input min-h-16 py-2" maxLength={5000} value={input.description} onChange={(e) => set("description", e.target.value)} />
      </label>
      {error ? (
        <p role="alert" className="text-[length:var(--ds-text-xs)]" style={{ color: "var(--ds-danger-strong)" }}>
          {error}
        </p>
      ) : null}
      <div className="flex justify-between gap-2">
        <span>
          {event ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" disabled={busy} onClick={() => actions.remove.mutate(event.id, { onSuccess: onDone, onError })}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("calendar.delete")}
            </button>
          ) : null}
        </span>
        <button type="submit" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy}>
          {event ? t("common.save") : t("calendar.create")}
        </button>
      </div>
    </form>
  );
}
