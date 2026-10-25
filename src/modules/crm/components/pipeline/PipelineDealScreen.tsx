"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightLeft, FilePlus2, FileText, Lock, Printer, ReceiptText, RotateCcw, SearchX, ThumbsDown, Trophy } from "lucide-react";
import { EmptyState, SkeletonList, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRecordCrumb } from "@/components/shell/useShell";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { FormView, invalidateModel, useFormatter, useRecordMutation, useViewRecord, ViewScope, type FormAction } from "@/views";
import type { CrmQuotation, QuotationItem } from "@/types/database.types";
import QuotationBuilderModal from "../QuotationBuilderModal";
import QuotationPrintTemplate, { type QuotationPrintData } from "../QuotationPrintTemplate";
import { saveQuotationAction } from "../../actions/crm";
import { convertLeadAction, markLostAction, markWonAction, movePipelineDealAction, reopenDealAction, updatePipelineDealAction, type PipelineDealInput } from "../../actions/pipeline";
import { fetchCrmProducts, mapDeal } from "../../lib/api";
import { lostReasonLabel, teamLabel } from "../../lib/pipeline";
import { useCrmConfig } from "../../hooks/useCrmConfig";
import { usePipeline } from "../../hooks/usePipeline";
import { LEADS_VIEW_KEY, PIPELINE_VIEW_KEY, type PipelineRecord } from "../../views/pipeline";
import { ConvertDialog, LostDialog } from "./PipelineDialogs";
import { pipelineError } from "./errors";
import { quotationToDraftInvoice } from "./quoteToInvoice";

/** One lead or opportunity of the new CRM (prompt 21, NEW_CRM). */
export function PipelineDealScreen({ id }: { id: string }) {
  return (
    <ViewScope>
      <DealForm id={id} />
    </ViewScope>
  );
}

const WON_QUOTES = ["WON", "ACCEPTED"];

/** Form changes → the action's fields. */
export function formChangesToInput(changes: Record<string, unknown>): PipelineDealInput {
  const input: PipelineDealInput = {};
  const str = (k: string) => (changes[k] === null || changes[k] === undefined ? null : String(changes[k]));
  if ("title" in changes) input.title = String(changes.title ?? "");
  if ("client_id" in changes) input.clientId = str("client_id");
  if ("contact_name" in changes) input.contactName = str("contact_name");
  if ("company_name" in changes) input.companyName = str("company_name");
  if ("email" in changes) input.email = str("email");
  if ("phone" in changes) input.phone = str("phone");
  if ("expected_value" in changes) input.expectedValue = Number(changes.expected_value) || 0;
  if ("probability" in changes && changes.probability !== null && changes.probability !== "") input.probability = Number(changes.probability);
  if ("expected_close" in changes) input.expectedClose = str("expected_close");
  if ("priority" in changes) input.priority = Number(changes.priority) || 0;
  if ("tags" in changes) input.tags = String(changes.tags ?? "");
  if ("team_id" in changes) input.teamId = str("team_id");
  if ("assigned_to" in changes) input.assignedTo = str("assigned_to");
  if ("source" in changes) input.source = str("source");
  if ("medium" in changes) input.medium = str("medium");
  if ("notes" in changes) input.notes = str("notes");
  return input;
}

function DealForm({ id }: { id: string }) {
  const { t, formatDate } = useI18n();
  const fmt = useFormatter();
  const router = useRouter();
  const { can, profile } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const branding = useCompanyBranding();
  const { config: crmConfig } = useCrmConfig();
  const { printData, setPrintData } = useDocumentPrint<QuotationPrintData>();
  const pipeline = usePipeline();
  const data = useViewRecord(pipeline.opportunities, id);
  const deal = useMemo(() => (data.row ? mapDeal(data.row) : null), [data.row]);
  const record = data.record as PipelineRecord | null;
  const [quote, setQuote] = useState<{ open: boolean; quotation: CrmQuotation | null }>({ open: false, quotation: null });
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: "lost"; stageId: string | null } | { kind: "convert" }>(null);
  const products = useQuery({ queryKey: ["crm", "products"], queryFn: fetchCrmProducts, enabled: quote.open });
  useRecordCrumb(record?.title);

  const refresh = async () => {
    await Promise.all([invalidateModel(client, PIPELINE_VIEW_KEY), invalidateModel(client, LEADS_VIEW_KEY)]);
  };
  const save = useRecordMutation(pipeline.opportunities, (changes: Record<string, unknown>) => updatePipelineDealAction(id, formChangesToInput(changes)));
  const move = useRecordMutation(
    pipeline.opportunities,
    (stageId: string) => movePipelineDealAction(id, stageId),
    (stageId) => ({ id, patch: { stage_id: stageId } })
  );

  if (!pipeline.ready || data.status === "loading") return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
  if (data.status === "forbidden") return <EmptyState icon={Lock} title={t("views.forbidden")} description={t("views.forbiddenHint")} />;
  if (data.status === "error") return <EmptyState icon={AlertTriangle} title={t("views.error")} action={<button type="button" className="ds-btn ds-btn-sm" onClick={data.refetch}>{t("views.retry")}</button>} />;
  if (!record || !deal) return <EmptyState icon={SearchX} title={t("crm.pipeline.notFound")} action={<Link href="/crm" className="ds-btn ds-btn-sm">{t("crm.pipeline.backToPipeline")}</Link>} />;

  const isLead = record.type === "lead";
  const definition = isLead ? pipeline.leads : data.definition;
  const canWrite = data.canWrite;
  const stages = pipeline.settings.stages;
  const quotations = [...(deal.quotations ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const latest = quotations[0] ?? null;
  const canInvoice = canWrite && can("can_create_invoice");

  const run = async (work: () => Promise<{ success: boolean; error?: string }>, done: string) => {
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (!result.success) {
      toast(t("crm.pipeline.actionFailed"), pipelineError(result.error, t), "error");
      return false;
    }
    toast(done, undefined, "success");
    await refresh();
    return true;
  };

  const onStatusChange = (stageId: string) => {
    if (stages.find((s) => s.id === stageId)?.is_lost) {
      setDialog({ kind: "lost", stageId });
      return;
    }
    move.mutate(stageId, { onError: (err) => toast(t("crm.pipeline.moveFailed"), pipelineError(err.message, t), "error") });
  };

  const saveQuote = async (payload: { items: QuotationItem[]; discount: number; taxRate: number; validUntil: string; notes: string; status: "DRAFT" | "SENT" | "WON" }) => {
    setBusy(true);
    const result = await saveQuotationAction({ dealId: id, quotationId: quote.quotation?.id ?? null, ...payload });
    setBusy(false);
    if (!result.success) {
      toast(t("crm.engine.quoteFailed"), pipelineError(result.error, t), "error");
      return;
    }
    toast(t("crm.quote.saved", { number: result.data?.quoteNumber || "" }), undefined, "success");
    setQuote({ open: false, quotation: null });
    await refresh();
  };

  const invoice = async (q: CrmQuotation) => {
    setBusy(true);
    const result = await quotationToDraftInvoice({
      quotation: q,
      customerId: record.client_id,
      customerName: record.customer_name ?? "",
      seller: { id: record.assigned_to ?? profile?.id ?? null, name: record.salesperson ?? profile?.full_name ?? null },
      note: t("crm.pipeline.invoice.note", { quote: q.quote_number, deal: record.title }),
    });
    setBusy(false);
    if (!result.ok) {
      const detail =
        result.error === "missingProducts"
          ? t("crm.pipeline.invoice.missingProducts", { lines: (result.missing ?? []).join(", ") })
          : result.error === "save" || result.error === "link"
            ? pipelineError(result.detail, t)
            : t(`crm.pipeline.invoice.${result.error}`);
      toast(t("crm.pipeline.invoice.failed"), detail, "error");
      return;
    }
    toast(t("crm.pipeline.invoice.created", { number: result.docNo }), undefined, "success");
    await refresh();
    router.push(`/sales/${result.saleId}`);
  };

  const actions: FormAction[] = [];
  if (canWrite && isLead) {
    actions.push({ key: "convert", label: t("crm.pipeline.convert.action"), icon: <ArrowRightLeft className="h-4 w-4" aria-hidden />, primary: true, onClick: () => setDialog({ kind: "convert" }) });
  }
  if (canWrite && !isLead && record.outcome === "open") {
    actions.push({ key: "won", label: t("crm.pipeline.won.action"), icon: <Trophy className="h-4 w-4" aria-hidden />, primary: true, onClick: () => void run(() => markWonAction(id), t("crm.pipeline.won.done", { title: record.title })) });
    actions.push({ key: "lost", label: t("crm.pipeline.lost.action"), icon: <ThumbsDown className="h-4 w-4" aria-hidden />, onClick: () => setDialog({ kind: "lost", stageId: null }) });
  }
  if (canWrite && !isLead && record.outcome !== "open") {
    actions.push({ key: "reopen", label: t("crm.pipeline.reopen"), icon: <RotateCcw className="h-4 w-4" aria-hidden />, onClick: () => void run(() => reopenDealAction(id), t("crm.pipeline.reopened")) });
  }
  if (canWrite && !isLead) {
    actions.push({ key: "quote", label: latest ? t("crm.engine.newQuote") : t("crm.engine.firstQuote"), icon: <FilePlus2 className="h-4 w-4" aria-hidden />, onClick: () => setQuote({ open: true, quotation: null }) });
    if (latest) actions.push({ key: "print", label: t("common.print"), icon: <Printer className="h-4 w-4" aria-hidden />, onClick: () => setPrintData({ quotation: latest, deal, branding, crmConfig }) });
  }

  const money = (n: number) => `${new Intl.NumberFormat(fmt.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${t("common.currency")}`;

  const quotationsTab = (
    <div className="overflow-x-auto">
      {quotations.length === 0 ? (
        <p className="ds-muted">{t("crm.engine.noQuotes")}</p>
      ) : (
        <table className="w-full min-w-[36rem] border-collapse text-left">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1.5 ds-label">{t("crm.print.quoteNo")}</th>
              <th scope="col" className="px-2 py-1.5 ds-label">{t("crm.engine.fields.status")}</th>
              <th scope="col" className="px-2 py-1.5 ds-label">{t("crm.quote.validUntil")}</th>
              <th scope="col" className="px-2 py-1.5 text-right ds-label">{t("crm.quote.total")}</th>
              <th scope="col" className="px-2 py-1.5"><span className="sr-only">{t("crm.engine.quoteActions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {quotations.map((q) => (
              <tr key={q.id} style={{ borderTop: "1px solid var(--ds-border)" }}>
                <td className="px-2 py-1.5 ds-mono">{q.quote_number}</td>
                <td className="px-2 py-1.5"><span className="ds-chip ds-chip-flat">{t(`crm.quoteStatus.${q.status}`)}</span></td>
                <td className="px-2 py-1.5">{q.valid_until ? formatDate(q.valid_until) : "—"}</td>
                <td className="px-2 py-1.5 text-right ds-mono">{money(q.total_amount)}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap justify-end gap-1">
                    {canWrite && q.status !== "CONVERTED" ? (
                      <button type="button" className="ds-btn ds-btn-sm" onClick={() => setQuote({ open: true, quotation: q })}>
                        <FileText className="h-4 w-4" aria-hidden />
                        {t("crm.quote.open")}
                      </button>
                    ) : null}
                    <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setPrintData({ quotation: q, deal, branding, crmConfig })} aria-label={`${t("common.print")} ${q.quote_number}`}>
                      <Printer className="h-4 w-4" aria-hidden />
                    </button>
                    {canInvoice && WON_QUOTES.includes(q.status) && !q.sale_id && !q.production_order_id ? (
                      <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy} onClick={() => void invoice(q)}>
                        <ReceiptText className="h-4 w-4" aria-hidden />
                        {t("crm.pipeline.invoice.action")}
                      </button>
                    ) : null}
                    {q.sale_id ? (
                      <Link href={`/sales/${q.sale_id}`} className="ds-btn ds-btn-sm">{t("crm.pipeline.invoice.open")}</Link>
                    ) : null}
                    {q.production_order_id ? (
                      <Link href={`/production/${q.production_order_id}`} className="ds-btn ds-btn-sm">{t("crm.quote.viewOrder")}</Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const team = pipeline.settings.teams.find((x) => x.id === record.team_id);
  const reason = pipeline.settings.lostReasons.find((r) => r.id === record.lost_reason_id);

  return (
    <>
      <FormView
        definition={definition}
        record={record}
        canWrite={canWrite}
        fmt={fmt}
        onSave={async (changes) => {
          try {
            await save.mutateAsync(changes);
            await refresh();
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? pipelineError(err.message, t) : undefined };
          }
        }}
        onStatusChange={isLead ? undefined : onStatusChange}
        actions={actions}
        extraTabs={isLead ? [] : [{ key: "quotations", label: t("crm.engine.quotations", { count: quotations.length }), content: quotationsTab }]}
        chatter={
          <section className="ds-card ds-card-pad flex flex-col gap-2" aria-labelledby="deal-summary">
            <h2 id="deal-summary" className="ds-label">{isLead ? t("crm.pipeline.leadSummary") : t("crm.pipeline.summary")}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[length:var(--ds-text-xs)]">
              {!isLead ? (
                <>
                  <dt className="ds-muted">{t("crm.pipeline.fields.weightedValue")}</dt>
                  <dd className="ds-mono">{money(record.weighted_value)}</dd>
                </>
              ) : null}
              <dt className="ds-muted">{t("crm.pipeline.fields.team")}</dt>
              <dd>{teamLabel(team, t)}</dd>
              <dt className="ds-muted">{t("crm.pipeline.fields.createdAt")}</dt>
              <dd>{record.created_at ? formatDate(record.created_at) : "—"}</dd>
              {record.won_at ? (
                <>
                  <dt className="ds-muted">{t("crm.pipeline.fields.wonAt")}</dt>
                  <dd>{formatDate(record.won_at)}</dd>
                </>
              ) : null}
              {record.outcome === "lost" ? (
                <>
                  <dt className="ds-muted">{t("crm.pipeline.fields.lostReason")}</dt>
                  <dd>{lostReasonLabel(reason, t)}</dd>
                </>
              ) : null}
            </dl>
          </section>
        }
      />
      <QuotationBuilderModal
        isOpen={quote.open}
        deal={deal}
        quotation={quote.quotation}
        products={products.data ?? []}
        saving={busy}
        defaultValidityDays={crmConfig.default_validity_days}
        onClose={() => setQuote({ open: false, quotation: null })}
        onSubmit={saveQuote}
      />
      <LostDialog
        open={dialog?.kind === "lost"}
        onOpenChange={(o) => (o ? undefined : setDialog(null))}
        title={record.title}
        reasons={pipeline.settings.lostReasons}
        busy={busy}
        onSubmit={async (reasonId, note) => {
          const stageId = dialog?.kind === "lost" ? dialog.stageId : null;
          if (await run(() => markLostAction(id, { reasonId, note, stageId }), t("crm.pipeline.lost.done", { title: record.title }))) setDialog(null);
        }}
      />
      <ConvertDialog
        open={dialog?.kind === "convert"}
        onOpenChange={(o) => (o ? undefined : setDialog(null))}
        lead={record}
        customers={pipeline.customers}
        canCreateCustomer={can("can_manage_customers")}
        busy={busy}
        onSubmit={async (choice) => {
          if (await run(() => convertLeadAction(id, choice), t("crm.pipeline.convert.done", { title: record.title }))) {
            setDialog(null);
            await client.invalidateQueries({ queryKey: ["crm", "customers"] });
          }
        }}
      />
      {printData ? (
        <div className="print-area">
          <QuotationPrintTemplate data={printData} />
        </div>
      ) : null}
    </>
  );
}
