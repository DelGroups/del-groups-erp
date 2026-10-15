"use client";

import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Layers, PencilLine, Plus, Printer, Trash2 } from "lucide-react";
import { TypeToConfirmDialog, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { usePermissions } from "@/hooks/usePermissions";
import { EngineScreen, FormView, invalidateModel, useFormatter, type FormAction } from "@/views";
import { deleteProductionOrderAction, fetchProductionLookupsAction, getProductionOrderAction, listProductionOrdersAction, updateProductionStatusAction } from "../actions/production";
import { withPrintableProductionContract } from "../lib/contracts";
import type { ProductionOrder, ProductionStatus } from "../lib/types";
import { productionDefinition, productionKpis, PRODUCTION_VIEW_KEY, type ProductionRecord } from "../views/production";
import ProductionJobCardPrintTemplate from "./ProductionJobCardPrintTemplate";
import ProductionOrderModal from "./ProductionOrderModal";
import ProductionWorkflowModal from "./ProductionWorkflowModal";

const fetchAll = async () => {
  const result = await listProductionOrdersAction();
  if (!result.success) throw new Error(result.error);
  return (result.data ?? []) as unknown as Record<string, unknown>[];
};

/** The production board on the view engine (new UI). */
export default function ProductionScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { canViewProductionFinancials } = usePermissions();
  const showFinancials = canViewProductionFinancials();
  const canManage = can("can_manage_production");
  const client = useQueryClient();
  const definition = useMemo(() => productionDefinition({ fetchAll }, showFinancials), [showFinancials]);
  const lookups = useQuery({
    queryKey: ["production", "lookups"],
    queryFn: async () => {
      const r = await fetchProductionLookupsAction();
      if (!r.success) throw new Error(r.error);
      return r.data ?? null;
    },
    enabled: canManage,
  });
  // The classic dialogs, opened from the page: new order, and the workflow of an order.
  const [creating, setCreating] = useState(false);
  const [workflow, setWorkflow] = useState<ProductionOrder | null>(null);
  const reload = () => invalidateModel(client, PRODUCTION_VIEW_KEY);

  return (
    <>
      <EngineScreen
        definition={definition}
        title={t("production.boardTitle")}
        kpis={(records, fmt) => productionKpis(records, fmt, showFinancials)}
        actions={
          <>
            <Link href="/production/bom" className="ds-btn ds-btn-sm">
              <Layers className="h-4 w-4" aria-hidden />
              {t("nav.items.productionBom")}
            </Link>
            {canManage ? (
              <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={!lookups.data} onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                {t("production.newOrder")}
              </button>
            ) : null}
          </>
        }
        recordTitle={(r) => `${r.order_no} · ${r.project_name}`}
        renderRecord={(r, { close }) => (
          <OrderRecordView
            record={r}
            definition={definition}
            canManage={canManage}
            openWorkflow={(order) => {
              close();
              setWorkflow(order);
            }}
            onDeleted={close}
          />
        )}
      />
      {creating && lookups.data ? (
        <ProductionOrderModal
          open
          lookups={lookups.data}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void reload();
          }}
        />
      ) : null}
      {workflow ? (
        <ProductionWorkflowModal
          open
          order={workflow}
          lookups={lookups.data ?? null}
          onClose={() => setWorkflow(null)}
          onUpdated={(order) => {
            setWorkflow(order);
            void reload();
          }}
          onCompleted={() => {
            setWorkflow(null);
            void reload();
          }}
        />
      ) : null}
    </>
  );
}

function OrderRecordView({
  record,
  definition,
  canManage,
  openWorkflow,
  onDeleted,
}: {
  record: ProductionRecord;
  definition: ReturnType<typeof productionDefinition>;
  canManage: boolean;
  openWorkflow: (order: ProductionOrder) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const fmt = useFormatter();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const companyName = useCompanyProfile().displayName;
  const { printData, setPrintData } = useDocumentPrint<{ order: ProductionOrder; companyName: string }>();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const full = async () => {
    const r = await getProductionOrderAction(record.id);
    return r.success && r.data ? r.data : null;
  };
  // The classic card's advance: one stage forward, then the workflow of the new stage.
  const advance = async (next: ProductionStatus) => {
    setBusy(true);
    const result = await updateProductionStatusAction(record.id, next);
    setBusy(false);
    if (!result.success) {
      toast(t("common.error"), result.error, "error");
      return;
    }
    await invalidateModel(client, PRODUCTION_VIEW_KEY);
    const order = result.data ?? (await full());
    if (order) openWorkflow(order);
  };
  const advanceLabel = record.status === "Draft" ? t("production.workflow.sendToProduction") : record.status === "In-Progress" ? t("production.workflow.sendToLogistics") : record.status === "Ready" ? t("production.workflow.markDelivered") : null;
  const actions: FormAction[] = [
    { key: "open", label: t("production.engine.openOrder"), icon: <ExternalLink className="h-4 w-4" aria-hidden />, onClick: () => router.push(`/production/${record.id}`) },
    ...(canManage && record.next_status && advanceLabel ? [{ key: "advance", label: advanceLabel, primary: true, disabled: busy, icon: <ArrowRight className="h-4 w-4" aria-hidden />, onClick: () => void advance(record.next_status!) }] : []),
    ...(canManage
      ? [{
          key: "workflow",
          label: t("common.edit"),
          disabled: busy,
          icon: <PencilLine className="h-4 w-4" aria-hidden />,
          onClick: async () => {
            const order = await full();
            if (order) openWorkflow(order);
          },
        }]
      : []),
    {
      key: "print",
      label: t("common.print"),
      icon: <Printer className="h-4 w-4" aria-hidden />,
      onClick: async () => {
        const order = await full();
        if (order) setPrintData({ order: withPrintableProductionContract(order, companyName), companyName });
      },
    },
    ...(canManage ? [{ key: "delete", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" aria-hidden />, onClick: () => setDeleting(true) }] : []),
  ];
  return (
    <>
      <FormView definition={definition} record={record} canWrite={false} fmt={fmt} actions={actions} />
      <TypeToConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        confirmText={record.order_no || record.project_name}
        labels={{
          title: t("common.deleteConfirmTitle"),
          description: t("production.workflow.deleteConfirm"),
          instruction: t("production.engine.typeOrderNo"),
          copy: t("sales.engine.void.copy"),
          cancel: t("common.cancel"),
          confirm: t("common.delete"),
          working: t("common.loading"),
          audit: t("production.engine.deleteAudit"),
        }}
        onConfirm={async () => {
          const result = await deleteProductionOrderAction(record.id);
          if (!result.success) {
            toast(t("common.error"), result.error, "error");
            return;
          }
          await invalidateModel(client, PRODUCTION_VIEW_KEY);
          onDeleted();
        }}
      />
      {printData ? createPortal(<div className="print-area"><ProductionJobCardPrintTemplate order={printData.order} companyName={printData.companyName} /></div>, document.body) : null}
    </>
  );
}
