"use client";

import { useState } from "react";
import { migrateTenantNow, setCanary, type MigrateResult } from "./actions";
import type { MigrationView } from "./view";

export interface MigrationLabels {
  intro: string;
  notConfigured: string;
  notMigratable: string;
  canary: string;
  canaryHint: string;
  status: string;
  statuses: Record<MigrationView["status"], string>;
  migrate: string;
  migrating: string;
  confirm: string;
  confirmYes: string;
  cancel: string;
  outcomes: Record<string, string>;
  errors: Record<string, string>;
  log: string;
  noLog: string;
}

const STATUS_TONE: Record<MigrationView["status"], string> = {
  idle: "cp-badge-muted",
  running: "cp-badge-info",
  succeeded: "cp-badge-success",
  failed: "cp-badge-danger",
};

export default function MigrationPanel({
  tenantId,
  initial,
  hasDatabase,
  canMigrate,
  missingSettings,
  labels,
}: {
  tenantId: string;
  initial: MigrationView;
  hasDatabase: boolean;
  canMigrate: boolean;
  missingSettings: string[];
  labels: MigrationLabels;
}) {
  const [view, setView] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Omit<MigrateResult, "view"> | null>(null);

  if (!hasDatabase) return <p className="cp-muted">{labels.notMigratable}</p>;

  const migrate = async () => {
    setConfirming(false);
    setBusy(true);
    setResult(null);
    try {
      const { view: next, ...rest } = await migrateTenantNow(tenantId);
      setView(next);
      setResult(rest);
    } catch {
      setResult({ outcome: "failedToStart", applied: [], version: null, error: null });
    } finally {
      setBusy(false);
    }
  };

  const toggleCanary = async (value: boolean) => {
    setBusy(true);
    try {
      setView(await setCanary(tenantId, value));
    } finally {
      setBusy(false);
    }
  };

  const resultText = result
    ? (labels.outcomes[result.outcome] ?? labels.errors[result.outcome] ?? result.outcome)
        .replace("{count}", String(result.applied.length))
        .replace("{version}", result.version ?? "—")
    : "";
  const resultOk = result && ["migrated", "up_to_date"].includes(result.outcome);

  return (
    <div>
      <p className="cp-muted" style={{ marginBottom: "var(--erp-space-3)" }}>
        {labels.intro}
      </p>

      <label style={{ display: "flex", gap: "var(--erp-space-2)", alignItems: "center", marginBottom: "var(--erp-space-1)" }}>
        <input type="checkbox" checked={view.isCanary} disabled={busy} onChange={(e) => void toggleCanary(e.target.checked)} />
        {labels.canary}
      </label>
      <p className="cp-hint" style={{ marginBottom: "var(--erp-space-3)" }}>
        {labels.canaryHint}
      </p>

      <p style={{ marginBottom: "var(--erp-space-3)" }}>
        {labels.status}: <span className={`cp-badge ${STATUS_TONE[view.status]}`}>{labels.statuses[view.status]}</span>
        {view.status === "failed" && view.error ? <span className="cp-error"> {view.error}</span> : null}
      </p>

      {result ? (
        <p className={`cp-alert ${resultOk ? "cp-alert-success" : "cp-alert-error"}`} role={resultOk ? "status" : "alert"}>
          {resultText}
          {result.error ? ` ${result.error}` : ""}
        </p>
      ) : null}

      {missingSettings.length ? (
        <p className="cp-muted">{labels.notConfigured.replace("{missing}", missingSettings.join(", "))}</p>
      ) : !canMigrate ? (
        <p className="cp-muted">{labels.notMigratable}</p>
      ) : confirming ? (
        <p style={{ display: "flex", gap: "var(--erp-space-2)", alignItems: "center", flexWrap: "wrap" }}>
          <span>{labels.confirm}</span>
          <button className="cp-button" type="button" onClick={() => void migrate()} disabled={busy}>
            {labels.confirmYes}
          </button>
          <button className="cp-button cp-button-secondary" type="button" onClick={() => setConfirming(false)} disabled={busy}>
            {labels.cancel}
          </button>
        </p>
      ) : (
        <p>
          <button className="cp-button" type="button" onClick={() => setConfirming(true)} disabled={busy}>
            {busy ? labels.migrating : labels.migrate}
          </button>
        </p>
      )}

      <h3 className="erp-label">{labels.log}</h3>
      {view.log.length === 0 ? (
        <p className="cp-muted">{labels.noLog}</p>
      ) : (
        <pre
          style={{
            maxHeight: "14rem",
            overflow: "auto",
            background: "var(--erp-bg-table-header)",
            padding: "var(--erp-space-3)",
            fontFamily: "var(--erp-font-mono)",
            fontSize: "var(--erp-text-xs)",
            whiteSpace: "pre-wrap",
          }}
        >
          {view.log
            .map((l) => `${l.created_at.slice(0, 19).replace("T", " ")}  ${l.level.toUpperCase().padEnd(5)} ${l.run_id}: ${l.message}`)
            .join("\n")}
        </pre>
      )}
    </div>
  );
}
