"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Lock, MapPin, Plus, Repeat, Users } from "lucide-react";
import { useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { PRODUCT_NAME } from "@/lib/brand";
import { EngineScreen, RecordPanel, useFormatter, useViewAccess, type Formatter, type ViewData } from "@/views";
import { useChatterUsers } from "@/views/chatter/data";
import { recordHref } from "@/views/chatter/logic";
import { buildIcs, calendarWindow, isMine, REMINDER_CHOICES, toCalendarRecords, userColor, type CalendarAttendee, type CalendarRecord, type CalendarScope } from "../lib/calendar";
import { useBusy, useCalendarActions, useCalendarEvent, useCalendarEvents } from "../lib/data";
import { calendarDefinition } from "../views/calendar";
import { EventForm } from "./EventForm";

/**
 * The Calendar module's screen (phase 20, new UI only): my calendar (events I organise or was
 * invited to) or the team calendar (every public event, colleagues' private ones as "busy"),
 * coloured by person, day / week / month and a list, on the view engine. New events, an event
 * panel (edit for the organizer, answer and reminder for attendees) and ICS export.
 */
export default function CalendarScreen() {
  const { t } = useI18n();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const definition = useMemo(() => calendarDefinition(), []);
  const access = useViewAccess(definition);
  const [scope, setScope] = useState<CalendarScope>("mine");
  const [range] = useState(() => calendarWindow(new Date()));
  const events = useCalendarEvents(range.from, range.to, access.ready && access.read);
  const busy = useBusy(range.from, range.to, access.ready && access.read && scope === "team");
  const users = useChatterUsers(true);

  const records = useMemo(() => {
    const name = (id: string | null) => (id ? (users.data?.find((u) => u.id === id)?.full_name || t("views.chatter.unnamedUser")) : "—");
    return toCalendarRecords(events.data ?? [], busy.data ?? [], range, scope, userId).map((r) => ({
      ...r,
      title: r.busy ? t("calendar.busy") : r.title,
      organizer_name: name(r.owner_id),
    }));
  }, [events.data, busy.data, range, scope, userId, users.data, t]);

  const data: ViewData<CalendarRecord> = {
    status: !access.ready ? "loading" : !access.read ? "forbidden" : events.isError ? "error" : events.data ? "ready" : "loading",
    definition,
    records,
    capped: (events.data?.length ?? 0) >= 2000,
    canWrite: access.write,
    error: events.error ? events.error.message : null,
    refetch: () => void events.refetch(),
  };

  const exportIcs = () => {
    const rows = (events.data ?? []).filter((e) => scope === "team" || isMine(e, userId));
    const blob = new Blob([buildIcs(rows, PRODUCT_NAME, new Date())], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = scope === "team" ? "team-calendar.ics" : "my-calendar.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <EngineScreen
      definition={definition}
      title={t("calendar.title")}
      data={data}
      header={
        <div role="group" aria-label={t("calendar.scope")} className="flex gap-2">
          {(["mine", "team"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} className={["ds-btn ds-btn-sm", scope === s ? "ds-btn-primary" : ""].join(" ")} onClick={() => setScope(s)}>
              {t(`calendar.scopes.${s}`)}
            </button>
          ))}
        </div>
      }
      actions={
        <>
          <button type="button" className="ds-btn ds-btn-sm" onClick={exportIcs} disabled={!events.data?.length}>
            <Download className="h-4 w-4" aria-hidden />
            {t("calendar.export")}
          </button>
          <NewEventButton />
        </>
      }
      recordTitle={(r) => r.title}
      renderRecord={(r, { close }) => <OccurrencePanel record={r} close={close} />}
    />
  );
}

function NewEventButton() {
  const fmt = useFormatter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const fail = (err: unknown) => toast(fmt.t("common.error"), err instanceof Error ? err.message : undefined, "error");
  return (
    <>
      <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        {fmt.t("calendar.new")}
      </button>
      <RecordPanel open={open} onClose={() => setOpen(false)} title={fmt.t("calendar.new")} closeLabel={fmt.t("common.close")}>
        {open ? <EventForm fmt={fmt} onDone={() => setOpen(false)} onError={fail} /> : null}
      </RecordPanel>
    </>
  );
}

const RESPONSES: CalendarAttendee["response"][] = ["accepted", "tentative", "declined"];

/** An opened occurrence: busy block, the organizer's editor, or details with my answer and reminder. */
function OccurrencePanel({ record, close }: { record: CalendarRecord; close: () => void }) {
  const fmt = useFormatter();
  const { t } = fmt;
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const userId = user?.id ?? null;
  const event = useCalendarEvent(record.busy ? null : record.event_id);
  const fail = (err: unknown) => toast(t("common.error"), err instanceof Error ? err.message : undefined, "error");

  if (record.busy) return <p className="ds-muted">{t("calendar.busyHint")}</p>;
  if (event.isLoading) return <p className="ds-muted">{t("common.loading")}</p>;
  if (!event.data) return <p className="ds-muted">{t("calendar.missing")}</p>;
  const row = event.data;
  const link = row.res_model && row.res_id ? recordHref(row.res_model, row.res_id) : null;
  const linkLine = link ? (
    <Link href={link} className="ds-btn ds-btn-sm ds-btn-ghost self-start">
      {t("calendar.openRecord", { model: t(`views.chatter.models.${row.res_model}`) })}
    </Link>
  ) : null;

  if (row.organizer_id === userId || isAdmin) {
    return (
      <div className="flex flex-col gap-3">
        {linkLine}
        <EventForm event={row} fmt={fmt} onDone={close} onError={fail} />
      </div>
    );
  }
  return <EventDetails row={row} record={record} fmt={fmt} userId={userId} linkLine={linkLine} onError={fail} />;
}

function EventDetails({
  row,
  record,
  fmt,
  userId,
  linkLine,
  onError,
}: {
  row: NonNullable<ReturnType<typeof useCalendarEvent>["data"]>;
  record: CalendarRecord;
  fmt: Formatter;
  userId: string | null;
  linkLine: React.ReactNode;
  onError: (err: unknown) => void;
}) {
  const { t, locale } = fmt;
  const users = useChatterUsers(true);
  const actions = useCalendarActions(userId);
  const mine = (row.calendar_attendees ?? []).find((a) => a.user_id === userId);
  const myReminder = (row.calendar_reminders ?? []).find((r) => r.user_id === userId && r.channel === "in_app");
  const name = (id: string | null) => (id ? users.data?.find((u) => u.id === id)?.full_name || t("views.chatter.unnamedUser") : "—");
  const when = record.all_day
    ? new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date(record.start_at))
    : `${new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(new Date(record.start_at))} – ${new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(record.end_at))}`;
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium">{when}</p>
      <ul className="flex flex-col gap-1 text-[length:var(--ds-text-sm)]">
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: userColor(row.organizer_id) }} aria-hidden />
          {t("calendar.organizedBy", { name: name(row.organizer_id) })}
        </li>
        {row.location ? (
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4" aria-hidden />
            {row.location}
          </li>
        ) : null}
        {row.recurrence ? (
          <li className="flex items-center gap-2">
            <Repeat className="h-4 w-4" aria-hidden />
            {t("calendar.recurring")}
          </li>
        ) : null}
        {row.privacy === "private" ? (
          <li className="flex items-center gap-2">
            <Lock className="h-4 w-4" aria-hidden />
            {t("calendar.privacy.private")}
          </li>
        ) : null}
        <li className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4" aria-hidden />
          <span>
            {(row.calendar_attendees ?? [])
              .map((a) => `${a.user_id ? name(a.user_id) : a.display_name || "—"} (${t(`calendar.response.${a.response}`)})`)
              .join(", ") || "—"}
          </span>
        </li>
      </ul>
      {row.description ? <p className="whitespace-pre-wrap ds-muted">{row.description}</p> : null}
      {linkLine}
      {mine ? (
        <div role="radiogroup" aria-label={t("calendar.yourAnswer")} className="flex flex-wrap gap-2">
          {RESPONSES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={mine.response === r} className={["ds-btn ds-btn-sm", mine.response === r ? "ds-btn-primary" : ""].join(" ")} onClick={() => actions.respond.mutate({ attendeeId: mine.id, response: r }, { onError })}>
              {t(`calendar.response.${r}`)}
            </button>
          ))}
        </div>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="ds-label">{t("calendar.fields.reminder")}</span>
        <select
          className="ds-input"
          value={myReminder ? String(myReminder.minutes_before) : ""}
          onChange={(e) => actions.setReminders.mutate({ event: row, minutes: e.target.value === "" ? [] : [Number(e.target.value)] }, { onError })}
        >
          <option value="">{t("calendar.reminder.none")}</option>
          {REMINDER_CHOICES.map((m) => (
            <option key={m} value={String(m)}>
              {t(`calendar.reminder.m${m}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
