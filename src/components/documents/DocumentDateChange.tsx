"use client";

import { useId, useReducer, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, OctagonX } from "lucide-react";
import { Button, DateField, Dialog, Field } from "@/design-system/components";
import ClassicButton from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { dateFieldLabels } from "@/i18n/uiStandardLabels";
import {
  canApply,
  checkBlockedReason,
  dateChangeReducer,
  initialDateChangeState,
  isoToDots,
  issueItems,
  issueText,
  type DateChangeDocumentType,
  type DateChangeIssue,
} from "@/lib/documents/dateChange";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { useDocDateChangeAllowed } from "./DocDateChangeFlag";

export interface DateChangeTarget {
  type: DateChangeDocumentType;
  id: string;
  /** Document number for the title. */
  label: string;
  /** The current document date (yyyy-mm-dd). */
  date: string | null;
  /** The new date to start with (a form's date-only amendment). */
  initialDate?: string | null;
}

/** The row "…" key of the date change; the opened invoice runs it (?do=change_date). */
export const DATE_CHANGE_ACTION_KEY = "change_date";

/**
 * DATE-1: "Tarixi dəyiş" for posted invoices, shown only while DOC_DATE_CHANGE is on and the user
 * is an admin. One hook for every list and form: menu entries, open(), and the dialog to render.
 */
export function useDocumentDateChange(onChanged?: (target: DateChangeTarget) => void) {
  const allowed = useDocDateChangeAllowed();
  const { t } = useI18n();
  const [target, setTarget] = useState<DateChangeTarget | null>(null);
  const label = t("dateChange.action");
  const icon = <CalendarClock className="h-4 w-4" aria-hidden />;

  return {
    allowed,
    open: (next: DateChangeTarget) => setTarget(next),
    /** The opened invoice's action (FormView); none unless allowed and posted. */
    formActions: (posted: boolean, next: DateChangeTarget) =>
      allowed && posted ? [{ key: DATE_CHANGE_ACTION_KEY, label, icon, onClick: () => setTarget(next) }] : [],
    dialog: target ? (
      <DocumentDateChangeDialog
        key={`${target.type}:${target.id}`}
        target={target}
        onClose={() => setTarget(null)}
        onChanged={() => {
          onChanged?.(target);
          setTarget(null);
        }}
      />
    ) : null,
  };
}

function DocumentDateChangeDialog({ target, onClose, onChanged }: { target: DateChangeTarget; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [state, dispatch] = useReducer(dateChangeReducer, target.initialDate ?? null, initialDateChangeState);
  const reasonId = useId();
  const dateId = useId();
  const blockedKey = checkBlockedReason(state, target.date);
  const busy = state.step === "checking" || state.step === "applying";
  const preview = state.preview;

  const check = async () => {
    if (blockedKey || !state.newDate) return;
    dispatch({ type: "check" });
    try {
      const { previewDocumentDateChange } = await import("@/lib/documents/dateChangeApi");
      dispatch({ type: "previewed", preview: await previewDocumentDateChange(target.type, target.id, state.newDate, state.options) });
    } catch (e) {
      dispatch({ type: "failed", message: formatRpcError(e instanceof Error ? e.message : null, t) });
    }
  };

  const apply = async () => {
    if (!canApply(state) || !state.newDate) return;
    dispatch({ type: "apply" });
    try {
      const { applyDocumentDateChange } = await import("@/lib/documents/dateChangeApi");
      await applyDocumentDateChange(target.type, target.id, state.newDate, state.reason.trim(), state.options, state.acknowledged);
      dispatch({ type: "applied" });
      toast.success(t("dateChange.done", { from: isoToDots(target.date ?? ""), to: isoToDots(state.newDate) }));
      onChanged();
    } catch (e) {
      dispatch({ type: "failed", message: formatRpcError(e instanceof Error ? e.message : null, t) });
    }
  };

  const checked = state.step === "checked" && preview;
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t("dateChange.title", { doc: target.label })}
      description={t("dateChange.description")}
      labels={{ close: t("common.close") }}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          {checked && preview.ok ? (
            <Button variant="primary" onClick={() => void apply()} disabled={!canApply(state)} loading={state.step === "applying"} data-date-change-apply="">
              {t("dateChange.apply")}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void check()} disabled={Boolean(blockedKey) || busy} loading={state.step === "checking"} data-date-change-check="">
              {t("dateChange.check")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p>
          <span className="ds-muted">{t("dateChange.currentDate")}: </span>
          <span className="font-semibold tabular-nums">{target.date ? isoToDots(target.date) : "—"}</span>
        </p>
        <Field label={t("dateChange.newDate")} htmlFor={dateId} hint={blockedKey && state.newDate ? t(blockedKey) : t("dateChange.newDateHint")} required>
          <DateField id={dateId} value={state.newDate} onChange={(value) => dispatch({ type: "date", value })} locale={locale} labels={dateFieldLabels(t)} width="sm" invalid={Boolean(state.newDate && blockedKey)} />
        </Field>
        <Field label={t("dateChange.reason")} htmlFor={reasonId} hint={t("dateChange.reasonHint")} required>
          <textarea id={reasonId} className="ds-input min-h-20" value={state.reason} maxLength={500} onChange={(e) => dispatch({ type: "reason", value: e.target.value })} />
        </Field>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={state.options.move_same_day_payments}
            onChange={(e) => dispatch({ type: "option", key: "move_same_day_payments", value: e.target.checked })}
          />
          <span>
            {t("dateChange.moveSameDayPayments")}
            <span className="block text-[length:var(--ds-text-xs)] ds-muted">{t("dateChange.moveSameDayPaymentsHint")}</span>
          </span>
        </label>

        {state.error ? (
          <p role="alert" className="text-[length:var(--ds-text-sm)]" style={{ color: "var(--ds-danger-strong)" }}>
            {state.error}
          </p>
        ) : null}

        {checked ? (
          <section aria-label={t("dateChange.result")} className="flex flex-col gap-3" data-date-change-result="">
            {preview.blockers.length ? (
              <IssueList tone="danger" title={t("dateChange.blockers")} issues={preview.blockers} t={t} />
            ) : (
              <p className="font-semibold" style={{ color: "var(--ds-success-strong, var(--ds-text))" }}>
                {t("dateChange.allClear")}
              </p>
            )}
            {preview.warnings.length ? (
              <fieldset className="flex flex-col gap-2 rounded-[var(--ds-radius-md)] border p-3" style={{ borderColor: "var(--ds-warning)" }}>
                <legend className="px-1 font-semibold">{t("dateChange.warnings")}</legend>
                {preview.warnings.map((w) => (
                  <label key={w.code} className="flex items-start gap-2" data-date-change-warning={w.code}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={state.acknowledged.includes(w.code)}
                      onChange={(e) => dispatch({ type: "acknowledge", code: w.code, value: e.target.checked })}
                    />
                    <span className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--ds-warning)" }} aria-hidden />
                      {issueText(w, t)}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {preview.ok ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[length:var(--ds-text-sm)] sm:grid-cols-3" data-date-change-affected="">
                {(["journals", "cash", "stock_moves", "batches", "pieces", "payments"] as const).map((k) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="ds-muted">{t(`dateChange.affected.${k}`)}</dt>
                    <dd className="tabular-nums">{preview.affected[k] ?? 0}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

function IssueList({ tone, title, issues, t }: { tone: "danger"; title: string; issues: DateChangeIssue[]; t: (key: string, params?: Record<string, string | number>) => string }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--ds-radius-md)] border p-3" style={{ borderColor: tone === "danger" ? "var(--ds-danger-strong)" : "var(--ds-warning)" }} role="alert">
      <p className="font-semibold">{title}</p>
      <ul className="flex flex-col gap-2">
        {issues.map((issue) => (
          <li key={issue.code} className="flex items-start gap-1.5" data-date-change-blocker={issue.code}>
            <OctagonX className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--ds-danger-strong)" }} aria-hidden />
            <span>
              {issueText(issue, t)}
              {issueItems(issue).length ? (
                <ul className="mt-1 list-disc ps-5 text-[length:var(--ds-text-xs)] ds-muted">
                  {issueItems(issue).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The classic invoice pages (no action menu): "Tarixi dəyiş" as a small secondary button. */
export function DateChangeButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <ClassicButton type="button" appearance="solid" color="secondary" size="sm" disabled={disabled} onClick={onClick} data-date-change-open="">
      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{t("dateChange.action")}</span>
    </ClassicButton>
  );
}
