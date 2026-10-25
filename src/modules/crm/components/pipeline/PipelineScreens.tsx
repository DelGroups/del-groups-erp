"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Inbox, Plus, SlidersHorizontal } from "lucide-react";
import { EmptyState, SkeletonList, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { invalidateModel, useFilterContext, useFormatter, useRecordMutation, useViewData, ViewEngine, ViewScope } from "@/views";
import { createPipelineDealAction, markLostAction, movePipelineDealAction, type PipelineDealInput } from "../../actions/pipeline";
import { usePipeline } from "../../hooks/usePipeline";
import { LEADS_VIEW_KEY, PIPELINE_VIEW_KEY, type PipelineRecord } from "../../views/pipeline";
import { LostDialog, QuickCreateDialog } from "./PipelineDialogs";
import { pipelineError } from "./errors";

/** The new CRM pipeline (prompt 21, NEW_CRM): opportunities, kanban by stage first. */
export function PipelineScreen() {
  return (
    <ViewScope>
      <DealsBody type="opportunity" />
    </ViewScope>
  );
}

/** Leads not qualified yet (prompt 21, NEW_CRM): a list to work through, converted from their form. */
export function LeadsScreen() {
  return (
    <ViewScope>
      <DealsBody type="lead" />
    </ViewScope>
  );
}

function DealsBody({ type }: { type: "lead" | "opportunity" }) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const ctx = useFilterContext();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const pipeline = usePipeline();
  const def = type === "lead" ? pipeline.leads : pipeline.opportunities;
  const data = useViewData(def, { enabled: pipeline.ready });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [losing, setLosing] = useState<{ record: PipelineRecord; stageId: string } | null>(null);
  const { stages } = pipeline.settings;

  const move = useRecordMutation(
    def,
    (v: { id: string; stageId: string }) => movePipelineDealAction(v.id, v.stageId),
    (v) => ({ id: v.id, patch: { stage_id: v.stageId } })
  );

  const onMove = (record: PipelineRecord, value: string) => {
    if (type === "lead") return;
    const target = stages.find((s) => s.id === value);
    // Dropping on a lost column asks for the reason first.
    if (target?.is_lost) {
      setLosing({ record, stageId: value });
      return;
    }
    move.mutate({ id: record.id, stageId: value }, { onError: (err) => toast(t("crm.pipeline.moveFailed"), pipelineError(err.message, t), "error") });
  };

  const create = async (input: PipelineDealInput) => {
    setSaving(true);
    const result = await createPipelineDealAction(input);
    setSaving(false);
    if (!result.success || !result.data) {
      toast(t("crm.pipeline.createFailed"), pipelineError(result.error, t), "error");
      return;
    }
    setCreating(false);
    await invalidateModel(client, type === "lead" ? LEADS_VIEW_KEY : PIPELINE_VIEW_KEY);
    toast(type === "lead" ? t("crm.pipeline.quick.leadCreated") : t("crm.pipeline.quick.opportunityCreated"), undefined, "success");
    router.push(`/crm/${result.data.id}`);
  };

  const lose = async (reasonId: string | null, note: string) => {
    if (!losing) return;
    setSaving(true);
    const result = await markLostAction(losing.record.id, { reasonId, note, stageId: losing.stageId });
    setSaving(false);
    if (!result.success) {
      toast(t("crm.pipeline.moveFailed"), pipelineError(result.error, t), "error");
      return;
    }
    setLosing(null);
    await invalidateModel(client, PIPELINE_VIEW_KEY);
    toast(t("crm.pipeline.lost.done", { title: losing.record.title }), undefined, "success");
  };

  if (!pipeline.ready) {
    if (pipeline.error) return <EmptyState icon={Inbox} title={t("crm.pipeline.notReady")} description={t("crm.pipeline.notReadyHint")} action={<button type="button" className="ds-btn ds-btn-sm" onClick={pipeline.refetchSettings}>{t("views.retry")}</button>} />;
    return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
  }

  const links = (
    <>
      {type === "opportunity" ? (
        <Link href="/crm/leads" className="ds-btn ds-btn-sm ds-btn-ghost">
          <Inbox className="h-4 w-4" aria-hidden />
          {t("crm.pipeline.leadsTitle")}
        </Link>
      ) : (
        <Link href="/crm" className="ds-btn ds-btn-sm ds-btn-ghost">{t("crm.pipeline.title")}</Link>
      )}
      <Link href="/crm/reports" className="ds-btn ds-btn-sm ds-btn-ghost">
        <BarChart3 className="h-4 w-4" aria-hidden />
        {t("crm.pipeline.reports.title")}
      </Link>
      {can("can_manage_settings") ? (
        <Link href="/crm/config" className="ds-btn ds-btn-sm ds-btn-ghost" aria-label={t("crm.pipeline.config.title")}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </>
  );

  return (
    <>
      <ViewEngine
        data={data}
        title={type === "lead" ? t("crm.pipeline.leadsTitle") : t("crm.pipeline.title")}
        fmt={fmt}
        ctx={ctx}
        openHref={(r) => `/crm/${r.id}`}
        onMove={type === "opportunity" ? onMove : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {links}
            {data.canWrite ? (
              <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                {type === "lead" ? t("crm.pipeline.quick.newLead") : t("crm.pipeline.quick.newOpportunity")}
              </button>
            ) : null}
          </div>
        }
      />
      <QuickCreateDialog
        open={creating}
        onOpenChange={setCreating}
        type={type}
        teams={pipeline.settings.teams}
        stages={stages}
        customers={pipeline.customers}
        busy={saving}
        onSubmit={create}
      />
      <LostDialog open={!!losing} onOpenChange={(o) => (o ? undefined : setLosing(null))} title={losing?.record.title ?? ""} reasons={pipeline.settings.lostReasons} busy={saving} onSubmit={lose} />
    </>
  );
}
