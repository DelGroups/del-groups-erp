"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { advanceProvisioning, retryProvisioning, startProvisioning, type StartState } from "./actions";
import type { ProvisioningView } from "./view";

export interface ProvisioningLabels {
  intro: string;
  notConfigured: string;
  hasDatabase: string;
  form: Record<"modules" | "modulesHint" | "adminEmail" | "adminName" | "finalStatus" | "start" | "starting", string>;
  finalStatuses: Record<"trial" | "active", string>;
  steps: Record<string, string>;
  stepStatuses: Record<string, string>;
  jobStatuses: Record<string, string>;
  attempts: string;
  running: string;
  paused: string;
  continue: string;
  retry: string;
  done: string;
  log: string;
  noLog: string;
  errors: Record<string, string>;
}

const STEP_TONE: Record<string, string> = {
  pending: "cp-badge-muted",
  running: "cp-badge-info",
  succeeded: "cp-badge-success",
  failed: "cp-badge-danger",
};

/** Delay before the next call while the job runs: short while making progress, longer while waiting on Supabase. */
const NEXT_DELAY_MS = { progress: 800, waiting: 10_000 } as const;

export default function ProvisioningPanel({
  tenantId,
  initial,
  modules,
  missingSettings,
  hasDatabase,
  siteUrl,
  labels,
}: {
  tenantId: string;
  initial: ProvisioningView;
  modules: { id: string; name: string; isCore: boolean }[];
  missingSettings: string[];
  hasDatabase: boolean;
  siteUrl: string;
  labels: ProvisioningLabels;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [autoRun, setAutoRun] = useState(initial.job?.status === "running");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = startProvisioning.bind(null, tenantId);
  const [startState, startAction, starting] = useActionState<StartState, FormData>(start, {
    status: "idle",
    errors: {},
    formError: null,
  });

  // A job was just created: the server page re-renders and remounts this panel with it
  // (the page keys the panel by job id).
  useEffect(() => {
    if (startState.status === "started") router.refresh();
  }, [startState.status, router]);

  // One unit of work per call; the next call is scheduled from the result. Kept in a ref so
  // a scheduled call always runs the latest version.
  const jobId = view.job?.id;
  const runNext = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    runNext.current = async () => {
      if (!jobId) return;
      setBusy(true);
      try {
        const { result, view: next } = await advanceProvisioning(jobId);
        setView(next);
        if (result === "progress" || result === "busy") {
          timer.current = setTimeout(() => void runNext.current(), NEXT_DELAY_MS.progress);
        } else if (result === "waiting") {
          timer.current = setTimeout(() => void runNext.current(), NEXT_DELAY_MS.waiting);
        } else {
          setAutoRun(false);
        }
      } catch {
        setAutoRun(false);
      } finally {
        setBusy(false);
      }
    };
  }, [jobId]);

  const running = view.job?.status === "running";
  useEffect(() => {
    if (!autoRun || !running) return;
    timer.current = setTimeout(() => void runNext.current(), 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [autoRun, running]);

  const retry = async () => {
    if (!view.job) return;
    setBusy(true);
    try {
      setView(await retryProvisioning(view.job.id));
      setAutoRun(true);
    } finally {
      setBusy(false);
    }
  };

  const job = view.job;

  if (!job) {
    if (missingSettings.length) {
      return <p className="cp-muted">{labels.notConfigured.replace("{missing}", missingSettings.join(", "))}</p>;
    }
    if (hasDatabase) return <p className="cp-muted">{labels.hasDatabase}</p>;
    return (
      <form action={startAction} noValidate>
        <p className="cp-muted" style={{ marginBottom: "var(--erp-space-4)" }}>
          {labels.intro}
        </p>
        {startState.formError ? (
          <p className="cp-alert cp-alert-error" role="alert">
            {labels.errors[startState.formError] ?? startState.formError}
          </p>
        ) : null}
        <fieldset className="cp-field">
          <legend className="erp-label">{labels.form.modules}</legend>
          <span className="cp-hint">{labels.form.modulesHint}</span>
          <div className="cp-grid-2" style={{ gap: "var(--erp-space-1) var(--erp-space-4)" }}>
            {modules.map((m) => (
              <label key={m.id} style={{ display: "flex", gap: "var(--erp-space-2)", alignItems: "center" }}>
                <input type="checkbox" name="modules" value={m.id} defaultChecked disabled={m.isCore} />
                {m.name}
              </label>
            ))}
          </div>
          {startState.errors.modules ? <span className="cp-error">{labels.errors[startState.errors.modules]}</span> : null}
        </fieldset>
        <div className="cp-grid-2">
          <label className="cp-field">
            <span className="erp-label">{labels.form.adminEmail}</span>
            <input className="cp-input" name="adminEmail" type="email" required aria-invalid={startState.errors.adminEmail ? true : undefined} />
            {startState.errors.adminEmail ? <span className="cp-error">{labels.errors[startState.errors.adminEmail]}</span> : null}
          </label>
          <label className="cp-field">
            <span className="erp-label">{labels.form.adminName}</span>
            <input className="cp-input" name="adminName" required maxLength={200} aria-invalid={startState.errors.adminName ? true : undefined} />
            {startState.errors.adminName ? <span className="cp-error">{labels.errors[startState.errors.adminName]}</span> : null}
          </label>
          <label className="cp-field">
            <span className="erp-label">{labels.form.finalStatus}</span>
            <select className="cp-input" name="finalStatus" defaultValue="trial">
              <option value="trial">{labels.finalStatuses.trial}</option>
              <option value="active">{labels.finalStatuses.active}</option>
            </select>
          </label>
        </div>
        <button className="cp-button" type="submit" disabled={starting}>
          {starting ? labels.form.starting : labels.form.start}
        </button>
      </form>
    );
  }

  return (
    <div>
      {job.status === "succeeded" ? (
        <p className="cp-alert cp-alert-success" role="status">
          {labels.done.replace("{url}", siteUrl)}
        </p>
      ) : job.status === "running" ? (
        <p className="cp-muted" role="status">
          {autoRun ? labels.running : labels.paused}{" "}
          {!autoRun ? (
            <button className="cp-button cp-button-secondary" type="button" onClick={() => setAutoRun(true)} disabled={busy}>
              {labels.continue}
            </button>
          ) : null}
        </p>
      ) : (
        <p>
          <button className="cp-button" type="button" onClick={() => void retry()} disabled={busy}>
            {labels.retry}
          </button>
        </p>
      )}

      <table className="cp-table" style={{ marginBottom: "var(--erp-space-4)" }}>
        <tbody>
          {job.steps.map((s) => (
            <tr key={s.step}>
              <td>{labels.steps[s.step] ?? s.step}</td>
              <td>
                <span className={`cp-badge ${STEP_TONE[s.status] ?? "cp-badge-muted"}`}>{labels.stepStatuses[s.status]}</span>
                {s.attempts > 1 ? <span className="cp-muted"> {labels.attempts.replace("{count}", String(s.attempts))}</span> : null}
                {s.step === "apply_schema" && typeof s.output.applied === "number" && typeof s.output.total === "number" ? (
                  <span className="cp-muted">
                    {" "}
                    {s.output.applied}/{s.output.total}
                  </span>
                ) : null}
                {s.error ? <div className="cp-error">{s.error}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="erp-label">{labels.log}</h3>
      {view.log.length === 0 ? (
        <p className="cp-muted">{labels.noLog}</p>
      ) : (
        <pre
          style={{
            maxHeight: "18rem",
            overflow: "auto",
            background: "var(--erp-bg-table-header)",
            padding: "var(--erp-space-3)",
            fontFamily: "var(--erp-font-mono)",
            fontSize: "var(--erp-text-xs)",
            whiteSpace: "pre-wrap",
          }}
        >
          {view.log
            .map((l) => `${l.created_at.slice(0, 19).replace("T", " ")}  ${l.level.toUpperCase().padEnd(5)} ${l.step ?? "-"}: ${l.message}`)
            .join("\n")}
        </pre>
      )}
    </div>
  );
}
