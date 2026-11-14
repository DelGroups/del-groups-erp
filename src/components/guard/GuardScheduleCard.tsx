"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Chip, Combobox, ErrorState, Field, LoadingState, useToast, type ChipTone } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { comboboxLabels } from "@/i18n/uiStandardLabels";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { formatGridDateTime } from "@/lib/dates/localeDate";
import { guardScheduleStateAction, guardSetScheduleAction } from "@/lib/actions/accountingGuardSection";
import {
  INCREMENTAL_MINUTES,
  NIGHTLY_HOURS,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  bakuHour,
  hourText,
  scheduleChanged,
  validateSchedule,
  type GuardScheduleState,
  type ScheduleField,
  type ScheduleSettings,
} from "@/lib/guard/schedule";
import { GUARD_KEYS } from "./guardUi";

const RUN_TONE: Record<string, ChipTone> = { ok: "success", partial: "warning", failed: "danger", running: "info" };

/**
 * The "Automatic scan" card at the top of the Rules tab (GUARD-4): turn the scheduled scan on or off,
 * how often it looks at changed documents, when the nightly full scan runs, how long closed findings
 * and old scans are kept; the next runs and the last scheduled scan. It needs pg_cron in the database;
 * without it the card says what to do. The guard only reads business data and reports.
 */
export default function GuardScheduleCard() {
  const { t } = useI18n();
  const states = stateLabels(t);
  const query = useQuery({
    queryKey: GUARD_KEYS.schedule,
    queryFn: async () => {
      const r = await guardScheduleStateAction();
      if (!r.success) throw new Error(t(r.error));
      return r.data;
    },
  });
  if (query.isError) return <ErrorState title={states.errorTitle} description={query.error instanceof Error ? query.error.message : undefined} retryLabel={states.retry} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingState label={states.loading} variant="form" rows={2} />;
  // The form starts again from the stored settings whenever they change (after a save).
  return <Form key={JSON.stringify(query.data.settings)} state={query.data} />;
}

function Form({ state }: { state: GuardScheduleState }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const comboLabels = comboboxLabels(t);
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [enabled, setEnabled] = useState(state.settings.enabled);
  const [minutes, setMinutes] = useState(state.settings.incrementalMinutes);
  const [hour, setHour] = useState(state.settings.nightlyHourUtc);
  const [retention, setRetention] = useState(String(state.settings.retentionDays));
  const [invalid, setInvalid] = useState<ScheduleField | null>(null);
  const [busy, setBusy] = useState(false);

  const retentionDays = Number(retention.trim());
  const draft: ScheduleSettings = { enabled, incrementalMinutes: minutes, nightlyHourUtc: hour, retentionDays: Number.isFinite(retentionDays) ? retentionDays : NaN };
  const changed = scheduleChanged(state.settings, { ...draft, retentionDays: Number.isFinite(retentionDays) ? retentionDays : -1 });

  const save = async () => {
    const checked = validateSchedule(draft);
    if (!checked.ok) {
      setInvalid(checked.field);
      return;
    }
    setInvalid(null);
    setBusy(true);
    const result = await guardSetScheduleAction(checked.value);
    setBusy(false);
    if (!result.success) {
      toast(t("common.error"), t(result.error), "error");
      return;
    }
    toast(g("scheduleSaved"), result.data.pgCron ? undefined : g("scheduleSavedNoCron"), "success");
    queryClient.setQueryData(GUARD_KEYS.schedule, result.data);
    void queryClient.invalidateQueries({ queryKey: GUARD_KEYS.runs });
  };

  const when = (iso: string | null) => (iso ? formatGridDateTime(iso) : "—");
  const last = state.lastRun;

  return (
    <section className="ds-card flex flex-col gap-3 p-4" aria-labelledby="guard-schedule-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="guard-schedule-title" className="text-[length:var(--ds-text-sm)] font-semibold">
          {g("scheduleTitle")}
        </h2>
        <Chip tone={state.settings.enabled ? "success" : "neutral"}>{state.settings.enabled ? g("scheduleOn") : g("scheduleOff")}</Chip>
      </div>
      <p className="ds-muted max-w-[80ch] text-[length:var(--ds-text-sm)]">{g("scheduleHelp")}</p>

      {!state.pgCron ? (
        <div role="note" className="rounded-[var(--ds-radius-md)] border border-[var(--ds-border)] p-3 text-[length:var(--ds-text-sm)]" style={{ background: "var(--ds-warning-soft)" }}>
          <p className="font-semibold">{g("noCronTitle")}</p>
          <ol className="ms-5 mt-1 list-decimal">
            <li>{g("noCronStep1")}</li>
            <li>{g("noCronStep2")}</li>
            <li>{g("noCronStep3")}</li>
          </ol>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-h-9 items-center gap-2 text-[length:var(--ds-text-sm)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {g("scheduleEnabled")}
        </label>
        <Field label={g("scheduleEvery")} error={invalid === "incrementalMinutes" ? g("paramInvalid") : undefined}>
          {({ id }) => (
            <Combobox id={id} value={String(minutes)} width="sm" labels={comboLabels} options={INCREMENTAL_MINUTES.map((m) => ({ value: String(m), label: g("everyMinutes", { count: m }) }))} onChange={(v) => v && setMinutes(Number(v))} />
          )}
        </Field>
        <Field label={g("scheduleNightly")} error={invalid === "nightlyHourUtc" ? g("paramInvalid") : undefined} hint={g("scheduleNightlyHint")}>
          {({ id }) => (
            <Combobox id={id} value={String(hour)} width="sm" labels={comboLabels} options={NIGHTLY_HOURS.map((h) => ({ value: String(h), label: g("hourOption", { utc: hourText(h), baku: hourText(bakuHour(h)) }) }))} onChange={(v) => v && setHour(Number(v))} />
          )}
        </Field>
        <Field label={g("scheduleRetention")} error={invalid === "retentionDays" ? g("scheduleRetentionInvalid", { min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS }) : undefined} hint={g("scheduleRetentionHint")}>
          {({ id, describedBy, invalid: isInvalid }) => (
            <input id={id} className="ds-input w-28" inputMode="numeric" value={retention} aria-describedby={describedBy} aria-invalid={isInvalid || undefined} onChange={(e) => setRetention(e.target.value)} />
          )}
        </Field>
        <Button variant="secondary" onClick={() => void save()} loading={busy} disabled={!changed || busy}>
          {g("saveRule")}
        </Button>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-[length:var(--ds-text-sm)] sm:grid-cols-[auto_1fr]">
        <dt className="ds-muted">{g("nextQuick")}</dt>
        <dd>{state.settings.enabled ? when(state.nextIncremental) : g("scheduleOff")}</dd>
        <dt className="ds-muted">{g("nextNightly")}</dt>
        <dd>{state.settings.enabled ? when(state.nextFull) : g("scheduleOff")}</dd>
        <dt className="ds-muted">{g("lastScheduled")}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {last ? (
            <>
              {when(last.startedAt)}
              <Chip tone={RUN_TONE[last.status] ?? "neutral"}>{t(`guard.runStatus.${last.status}`)}</Chip>
              <span className="ds-muted">{last.since ? g("lastScheduledQuick") : g("lastScheduledFull")}</span>
            </>
          ) : (
            g("noScheduledRun")
          )}
        </dd>
        {state.pgCron ? (
          <>
            <dt className="ds-muted">{g("cronJobs")}</dt>
            <dd>{state.jobs.length > 0 ? state.jobs.map((j) => `${j.name} (${j.schedule})`).join(", ") : g("noCronJobs")}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
