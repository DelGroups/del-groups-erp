"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Factory, FilePlus2, FileText, Lock, Printer, SearchX } from "lucide-react";
import { EmptyState, SkeletonList, useToast } from "@/design-system/components";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRecordCrumb } from "@/components/shell/useShell";
import { useI18n } from "@/i18n/I18nProvider";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { FormView, invalidateModel, useFormatter, useRecordMutation, useViewRecord, ViewScope, type FormAction } from "@/views";
import type { CrmQuotation, QuotationItem } from "@/types/database.types";
import QuotationBuilderModal from "./QuotationBuilderModal";
import QuotationPrintTemplate, { type QuotationPrintData } from "./QuotationPrintTemplate";
import { convertQuotationToProductionAction, saveQuotationAction, updateDealAction, updateDealStageAction } from "../actions/crm";
import { fetchCrmProducts, mapDeal } from "../lib/api";
import { useCrmConfig } from "../hooks/useCrmConfig";
import { DEALS_VIEW_KEY } from "../views/deals";
import { useDealsDefinition } from "../hooks/useDealsDefinition";

/** One deal in the view engine's form (new UI): status bar, fields, notes and quotations. */
export default function DealFormScreen({ id }: { id: string }) {
  return (
    <ViewScope>
      <DealForm id={id} />
    </ViewScope>
  );
}

const WON = ["WON", "ACCEPTED"];

function DealForm({ id }: { id: string }) {
  const { t, formatDate } = useI18n();
  const fmt = useFormatter();
  const { can } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const branding = useCompanyBranding();
  const { config: crmConfig } = useCrmConfig();
  const { printData, setPrintData } = useDocumentPrint<QuotationPrintData>();
  const def = useDealsDefinition();
  const data = useViewRecord(def, id);
  const deal = useMemo(() => (data.row ? mapDeal(data.row) : null), [data.row]);
  const [quote, setQuote] = useState<{ open: boolean; quotation: CrmQuotation | null }>({ open: false, quotation: null });
  const [busy, setBusy] = useState(false);
  const products = useQuery({ queryKey: ["crm", "products"], queryFn: fetchCrmProducts, enabled: quote.open });
  useRecordCrumb(data.record?.title);

  const save = useRecordMutation(def, (changes: Record<string, unknown>) =>
    updateDealAction(id, {
      ...("title" in changes ? { title: String(changes.title ?? "") } : {}),
      ...("client_id" in changes ? { clientId: (changes.client_id as string | null) ?? null } : {}),
      ...("expected_value" in changes ? { expectedValue: Number(changes.expected_value) || 0 } : {}),
      ...("notes" in changes ? { notes: (changes.notes as string | null) ?? null } : {}),
    })
  );
  const stage = useRecordMutation(
    def,
    (value: string) => updateDealStageAction(id, value),
    (value) => ({ id, patch: { stage: value } })
  );

  if (data.status === "loading") return <SkeletonList loading rows={6} label={t("common.loading")}>{null}</SkeletonList>;
  if (data.status === "forbidden") return <EmptyState icon={Lock} title={t("views.forbidden")} description={t("views.forbiddenHint")} />;
  if (data.status === "error") return <EmptyState icon={AlertTriangle} title={t("views.error")} action={<button type="button" className="ds-btn ds-btn-sm" onClick={data.refetch}>{t("views.retry")}</button>} />;
  if (!data.record || !deal) return <EmptyState icon={SearchX} title={t("crm.engine.notFound")} action={<Link href="/crm" className="ds-btn ds-btn-sm">{t("crm.engine.backToDeals")}</Link>} />;

  const canWrite = data.canWrite;
  const canConvert = canWrite && can("can_manage_production");
  const quotations = [...(deal.quotations ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const latest = quotations[0] ?? null;

  const saveQuote = async (payload: { items: QuotationItem[]; discount: number; taxRate: number; validUntil: string; notes: string; status: "DRAFT" | "SENT" | "WON" }) => {
    setBusy(true);
    const result = await saveQuotationAction({ dealId: id, quotationId: quote.quotation?.id ?? null, ...payload });
    setBusy(false);
    if (!result.success) {
      toast(t("crm.engine.quoteFailed"), formatRpcError(result.error, t), "error");
      return;
    }
    toast(t("crm.quote.saved", { number: result.data?.quoteNumber || "" }), undefined, "success");
    setQuote({ open: false, quotation: null });
    void invalidateModel(client, DEALS_VIEW_KEY);
  };

  const convert = async (q: CrmQuotation) => {
    setBusy(true);
    const result = await convertQuotationToProductionAction(q.id);
    setBusy(false);
    if (!result.success) {
      toast(t("crm.engine.convertFailed"), formatRpcError(result.error, t), "error");
      return;
    }
    toast(t("crm.quote.converted", { order: result.data?.orderNo || "" }), undefined, "success");
    void invalidateModel(client, DEALS_VIEW_KEY);
  };

  const actions: FormAction[] = canWrite
    ? [
        { key: "quote", label: latest ? t("crm.engine.newQuote") : t("crm.engine.firstQuote"), icon: <FilePlus2 className="h-4 w-4" aria-hidden />, primary: !latest, onClick: () => setQuote({ open: true, quotation: null }) },
        ...(latest ? [{ key: "print", label: t("common.print"), icon: <Printer className="h-4 w-4" aria-hidden />, onClick: () => setPrintData({ quotation: latest, deal, branding, crmConfig }) }] : []),
      ]
    : [];

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
                <td className="px-2 py-1.5 text-right ds-mono">{`${new Intl.NumberFormat(fmt.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(q.total_amount)} ${t("common.currency")}`}</td>
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
                    {canConvert && WON.includes(q.status) && !q.production_order_id && !quotations.some((x) => x.status === "CONVERTED") ? (
                      <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" disabled={busy} onClick={() => void convert(q)}>
                        <Factory className="h-4 w-4" aria-hidden />
                        {t("crm.quote.convert")}
                      </button>
                    ) : null}
                    {q.production_order_id ? (
                      <Link href={`/production/${q.production_order_id}`} className="ds-btn ds-btn-sm">
                        {t("crm.quote.viewOrder")}
                      </Link>
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

  return (
    <>
      <FormView
        definition={data.definition}
        record={data.record}
        canWrite={canWrite}
        fmt={fmt}
        onSave={async (changes) => {
          try {
            await save.mutateAsync(changes);
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? formatRpcError(err.message, t) : undefined };
          }
        }}
        onStatusChange={(value) =>
          stage.mutate(value, { onError: (err) => toast(t("crm.engine.moveFailed"), formatRpcError(err.message, t), "error") })
        }
        actions={actions}
        extraTabs={[{ key: "quotations", label: t("crm.engine.quotations", { count: quotations.length }), content: quotationsTab }]}
        chatter={
          <section className="ds-card ds-card-pad flex flex-col gap-2" aria-labelledby="deal-info">
            <h2 id="deal-info" className="ds-label">{t("crm.engine.info")}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[length:var(--ds-text-xs)]">
              <dt className="ds-muted">{t("crm.engine.fields.createdAt")}</dt>
              <dd>{deal.created_at ? formatDate(deal.created_at) : "—"}</dd>
              <dt className="ds-muted">{t("crm.engine.fields.updatedAt")}</dt>
              <dd>{deal.updated_at ? formatDate(deal.updated_at) : "—"}</dd>
              <dt className="ds-muted">{t("crm.engine.fields.salesperson")}</dt>
              <dd>{(data.record.salesperson as string | null) || "—"}</dd>
            </dl>
            <p className="mt-2 ds-subtle text-[length:var(--ds-text-xs)]">{t("crm.engine.chatterSoon")}</p>
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
      {printData ? (
        <div className="print-area">
          <QuotationPrintTemplate data={printData} />
        </div>
      ) : null}
    </>
  );
}
