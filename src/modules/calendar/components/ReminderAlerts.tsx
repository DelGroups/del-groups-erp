"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/AuthProvider";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useI18n } from "@/i18n/I18nProvider";
import { useNow } from "@/views/chatter/data";
import { dueReminders, type DueReminder } from "../lib/calendar";
import { calendarKeys, fetchEvents, markDelivered, useDeliveries } from "../lib/data";
import { dateFormat } from "@/lib/dates/localeDate";

/**
 * In-app reminders (phase 20) in the new shell: checks the user's events every minute and shows
 * a reminder when its time has come (each occurrence once, also across tabs and devices: the
 * delivery is stored). Dismissing or opening it marks it shown. Nothing renders while there is
 * nothing to remind or the calendar module is off.
 */
export function ReminderAlerts() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { isEnabled } = useEnabledModules();
  const userId = user?.id ?? null;
  const enabled = !!userId && isEnabled("calendar");
  const client = useQueryClient();
  const now = useNow();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  // The next four weeks (longest reminder is four weeks), refreshed every five minutes.
  const events = useQuery({
    queryKey: [...calendarKeys.all, "reminders", userId ?? ""],
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: () => fetchEvents(new Date(Date.now() - 2 * 3_600_000), new Date(Date.now() + 29 * 86_400_000)),
  });
  const delivered = useDeliveries(enabled ? userId : null);
  const due = useMemo<DueReminder[]>(
    () => (enabled && events.data && delivered.data ? dueReminders(events.data, delivered.data, userId!, now).filter((r) => !hidden.has(`${r.reminder_id}|${r.occurrence_start}`)) : []),
    [enabled, events.data, delivered.data, userId, now, hidden]
  );
  if (!due.length) return null;

  const done = (r: DueReminder) => {
    setHidden((h) => new Set(h).add(`${r.reminder_id}|${r.occurrence_start}`));
    void markDelivered(r.reminder_id, r.occurrence_start).then(() => client.invalidateQueries({ queryKey: calendarKeys.deliveries(userId!) }));
  };
  const time = (iso: string) => dateFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 md:bottom-4" aria-live="assertive">
      {due.slice(0, 3).map((r) => (
        <div key={`${r.reminder_id}|${r.occurrence_start}`} role="alert" className="ds-card pointer-events-auto flex items-start gap-2 p-3" style={{ boxShadow: "var(--ds-elevation-3, var(--ds-elevation-1))" }}>
          <BellRing className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--ds-brand)" }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{r.title}</p>
            <p className="ds-muted text-[length:var(--ds-text-xs)]">{t("calendar.reminderAt", { time: time(r.occurrence_start) })}</p>
            <Link href={`/calendar?record=${encodeURIComponent(`${r.event_id}@${r.occurrence_start}`)}`} className="text-[length:var(--ds-text-xs)] underline" onClick={() => done(r)}>
              {t("calendar.openEvent")}
            </Link>
          </div>
          <button type="button" className="ds-icon-btn h-7 w-7" aria-label={t("calendar.dismiss", { title: r.title })} onClick={() => done(r)}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
