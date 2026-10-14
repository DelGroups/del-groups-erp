"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useToast } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { invalidateModel, useFilterContext, useFormatter, useRecordMutation, useViewData, ViewEngine, ViewScope } from "@/views";
import DealFormModal from "./DealFormModal";
import { createDealAction, updateDealStageAction } from "../actions/crm";
import { fetchCrmCustomers } from "../lib/api";
import { DEALS_VIEW_KEY, type DealRecord } from "../views/deals";
import { useDealsDefinition } from "../hooks/useDealsDefinition";

/** CRM deals on the view engine (new UI): kanban, list, pivot, graph and calendar. */
export default function DealsScreen() {
  return (
    <ViewScope>
      <DealsBody />
    </ViewScope>
  );
}

function DealsBody() {
  const { t } = useI18n();
  const fmt = useFormatter();
  const ctx = useFilterContext();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const def = useDealsDefinition();
  const data = useViewData(def);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const customers = useQuery({ queryKey: ["crm", "customers"], queryFn: fetchCrmCustomers, enabled: creating });

  const move = useRecordMutation(
    def,
    (v: { id: string; stage: string }) => updateDealStageAction(v.id, v.stage),
    (v) => ({ id: v.id, patch: { stage: v.stage } })
  );

  const onMove = (record: DealRecord, stage: string) =>
    move.mutate(
      { id: record.id, stage },
      { onError: (err) => toast(t("crm.engine.moveFailed"), formatRpcError(err.message, t), "error") }
    );

  const create = async (payload: { title: string; clientId: string; expectedValue: number; notes: string }) => {
    setSaving(true);
    const result = await createDealAction(payload);
    setSaving(false);
    if (!result.success || !result.data) {
      toast(t("crm.engine.createFailed"), formatRpcError(result.error, t), "error");
      return;
    }
    setCreating(false);
    await invalidateModel(client, DEALS_VIEW_KEY);
    toast(t("crm.deal.created"), undefined, "success");
    router.push(`/crm/${result.data.id}`);
  };

  return (
    <>
      <ViewEngine
        data={data}
        title={t("crm.engine.title")}
        fmt={fmt}
        ctx={ctx}
        openHref={(r) => `/crm/${r.id}`}
        onMove={onMove}
        actions={
          data.canWrite ? (
            <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("crm.deal.newTitle")}
            </button>
          ) : null
        }
      />
      <DealFormModal isOpen={creating} customers={customers.data ?? []} saving={saving} onClose={() => setCreating(false)} onSubmit={create} />
    </>
  );
}
