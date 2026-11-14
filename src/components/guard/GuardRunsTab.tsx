"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, Dialog, ErrorState, LoadingState, type ChipTone } from "@/design-system/components";
import { StandardGrid, type StandardColumn } from "@/components/lists/StandardGrid";
import { useI18n } from "@/i18n/I18nProvider";
import { stateLabels } from "@/i18n/uiUnifiedLabels";
import { formatGridDateTime } from "@/lib/dates/localeDate";
import { listGuardRunsAction } from "@/lib/actions/accountingGuardSection";
import { runSeconds, type GuardRun } from "@/lib/guard/findings";
import { GUARD_KEYS, Fact } from "./guardUi";

const RUN_TONE: Record<string, ChipTone> = { ok: "success", partial: "warning", failed: "danger", running: "info" };

/** The Runs tab: every scan (who started it, how, what it ran, what it found, what failed). */
export default function GuardRunsTab() {
  const { t } = useI18n();
  const states = stateLabels(t);
  const g = (key: string, p?: Record<string, string | number>) => t(`guard.ui.${key}`, p);
  const [open, setOpen] = useState<GuardRun | null>(null);
  const runs = useQuery({
    queryKey: GUARD_KEYS.runs,
    queryFn: async () => {
      const r = await listGuardRunsAction();
      if (!r.success) throw new Error(t(r.error));
      return r.data;
    },
  });

  const columns: StandardColumn<GuardRun>[] = [
    { key: "started", header: g("colStarted"), type: "datetime", cell: (r) => formatGridDateTime(r.startedAt), sortValue: (r) => r.startedAt },
    { key: "trigger", header: g("colTrigger"), width: 130, cell: (r) => t(`guard.trigger.${r.trigger}`), sortValue: (r) => r.trigger },
    { key: "scope", header: g("colScope"), width: 180, cell: (r) => (r.scope.length > 0 ? r.scope.join(", ") : g("scopeAll")) },
    { key: "status", header: g("colStatus"), width: 120, cell: (r) => <Chip tone={RUN_TONE[r.status] ?? "neutral"}>{t(`guard.runStatus.${r.status}`)}</Chip>, sortValue: (r) => r.status },
    { key: "new", header: g("colNew"), type: "number", cell: (r) => String(r.newCount), sortValue: (r) => r.newCount },
    { key: "open", header: g("colOpen"), type: "number", cell: (r) => String(r.openCount), sortValue: (r) => r.openCount },
    { key: "resolved", header: g("colResolved"), type: "number", cell: (r) => String(r.resolvedCount), sortValue: (r) => r.resolvedCount },
    { key: "seconds", header: g("colSeconds"), type: "number", cell: (r) => (runSeconds(r) ?? "—").toString(), sortValue: (r) => runSeconds(r) },
    { key: "errors", header: g("colErrors"), width: 140, cell: (r) => (Object.keys(r.ruleErrors).length > 0 ? Object.keys(r.ruleErrors).join(", ") : "—") },
  ];

  if (runs.isError) return <ErrorState title={states.errorTitle} description={runs.error instanceof Error ? runs.error.message : undefined} retryLabel={states.retry} onRetry={() => void runs.refetch()} />;
  if (!runs.data) return <LoadingState label={states.loading} rows={6} />;
  return (
    <>
      <StandardGrid<GuardRun> id="guard-runs" label={g("tab_runs")} rows={runs.data} rowKey={(r) => r.id} columns={columns} onOpen={setOpen} empty={g("noRuns")} />
      <Dialog
        open={open !== null}
        onOpenChange={(next) => (next ? undefined : setOpen(null))}
        size="md"
        title={open ? formatGridDateTime(open.startedAt) : ""}
        labels={{ close: t("common.close") }}
        footer={
          <Button variant="secondary" onClick={() => setOpen(null)}>
            {t("common.close")}
          </Button>
        }
      >
        {open ? (
          <dl>
            <Fact label={g("colTrigger")}>{t(`guard.trigger.${open.trigger}`)}</Fact>
            <Fact label={g("colScope")}>{open.scope.length > 0 ? open.scope.join(", ") : g("scopeAll")}</Fact>
            <Fact label={g("colStatus")}>{t(`guard.runStatus.${open.status}`)}</Fact>
            <Fact label={g("rulesRun")}>{open.rulesRun.join(", ") || "—"}</Fact>
            <Fact label={g("colNew")}>{open.newCount}</Fact>
            <Fact label={g("colOpen")}>{open.openCount}</Fact>
            <Fact label={g("colResolved")}>{open.resolvedCount}</Fact>
            {Object.entries(open.ruleErrors).map(([code, message]) => (
              <Fact key={code} label={g("ruleError", { code })}>
                {message}
              </Fact>
            ))}
            {open.error && Object.keys(open.ruleErrors).length === 0 ? <Fact label={g("colErrors")}>{open.error}</Fact> : null}
          </dl>
        ) : null}
      </Dialog>
    </>
  );
}
