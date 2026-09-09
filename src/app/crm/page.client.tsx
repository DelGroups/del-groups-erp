"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import DealFormModal from "@/components/crm/DealFormModal";
import QuotationBuilderModal from "@/components/crm/QuotationBuilderModal";
import QuotationPrintTemplate, {
  type QuotationPrintData,
} from "@/components/crm/QuotationPrintTemplate";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import {
  convertQuotationToProductionAction,
  createDealAction,
  saveQuotationAction,
  updateDealStageAction,
} from "@/lib/actions/crm";
import { fetchCrmCustomers, fetchCrmDeals, fetchCrmProducts } from "@/lib/crm/api";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import {
  DEAL_STAGES,
  type CrmDeal,
  type CrmQuotation,
  type DealStage,
  type QuotationItem,
} from "@/types/database.types";
import { Factory, FileText, KanbanSquare, Printer } from "lucide-react";

const STAGE_TONE: Record<DealStage, string> = {
  LEAD: "border-sky-300",
  QUALIFIED: "border-indigo-300",
  PROPOSAL: "border-amber-300",
  WON: "border-emerald-300",
  LOST: "border-rose-300",
};

export default function CrmPipelinePage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_crm");
  const canConvert = canManage && can("can_manage_production");
  const branding = useCompanyBranding();
  const { printData, setPrintData } = useDocumentPrint<QuotationPrintData>();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [customers, setCustomers] = useState<
    { id: string; full_name: string; company_name: string | null }[]
  >([]);
  const [products, setProducts] = useState<
    { id: string; code: string; name: string; unit: string; buy_price: number; sell_price: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dealModalOpen, setDealModalOpen] = useState(false);
  const [quoteDeal, setQuoteDeal] = useState<CrmDeal | null>(null);
  const [activeQuote, setActiveQuote] = useState<CrmQuotation | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [dealRows, customerRows, productRows] = await Promise.all([
      fetchCrmDeals(),
      fetchCrmCustomers(),
      fetchCrmProducts(),
    ]);
    setDeals(dealRows);
    setCustomers(customerRows);
    setProducts(productRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<DealStage, CrmDeal[]>();
    for (const stage of DEAL_STAGES) map.set(stage, []);
    for (const deal of deals) {
      const list = map.get(deal.stage) || map.get("LEAD")!;
      list.push(deal);
    }
    return map;
  }, [deals]);

  const handleCreateDeal = async (payload: {
    title: string;
    clientId: string;
    expectedValue: number;
    notes: string;
  }) => {
    setSaving(true);
    const result = await createDealAction(payload);
    setSaving(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("crm.deal.created"));
    setDealModalOpen(false);
    void load();
  };

  const moveDeal = async (dealId: string, stage: DealStage) => {
    const current = deals.find((d) => d.id === dealId);
    if (!current || current.stage === stage) return;
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage } : d)));
    const result = await updateDealStageAction(dealId, stage);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      void load();
    }
  };

  const handleSaveQuote = async (payload: {
    items: QuotationItem[];
    discount: number;
    taxRate: number;
    validUntil: string;
    notes: string;
    status: "DRAFT" | "SENT" | "WON";
  }) => {
    if (!quoteDeal) return;
    setSaving(true);
    const result = await saveQuotationAction({
      dealId: quoteDeal.id,
      quotationId: activeQuote?.id || null,
      items: payload.items,
      discount: payload.discount,
      taxRate: payload.taxRate,
      validUntil: payload.validUntil,
      notes: payload.notes,
      status: payload.status,
    });
    setSaving(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("crm.quote.saved", { number: result.data?.quoteNumber || "" }));
    setQuoteDeal(null);
    setActiveQuote(null);
    void load();
  };

  const handleConvert = async (quotation: CrmQuotation) => {
    setSaving(true);
    const result = await convertQuotationToProductionAction(quotation.id);
    setSaving(false);
    if (!result.success) {
      showError(formatRpcError(result.error, t));
      return;
    }
    showSuccess(t("crm.quote.converted", { order: result.data?.orderNo || "" }));
    void load();
  };

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<KanbanSquare className="h-6 w-6 text-indigo-600" />}
        title={t("crm.pageTitle")}
        description={t("crm.pageDescription")}
        createLabel={canManage ? t("crm.deal.newTitle") : undefined}
        onCreate={() => setDealModalOpen(true)}
      />

      <main className="flex-1 overflow-x-auto p-4 md:p-6">
        {loading ? (
          <div className="p-12 text-center text-sm text-app-muted">{t("common.loading")}</div>
        ) : (
          <div className="flex min-w-max gap-4">
            {DEAL_STAGES.map((stage) => (
              <section
                key={stage}
                className={`w-72 shrink-0 rounded-2xl border-t-4 bg-app-card p-3 ${STAGE_TONE[stage]}`}
                onDragOver={(e) => {
                  if (!canManage) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!canManage) return;
                  e.preventDefault();
                  const dealId = e.dataTransfer.getData("text/deal-id") || draggingId;
                  if (dealId) void moveDeal(dealId, stage);
                  setDraggingId(null);
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase text-app">{t(`crm.stages.${stage}`)}</h3>
                  <span className="rounded-full bg-app-card-hover px-2 py-0.5 text-[10px] font-bold">
                    {(grouped.get(stage) || []).length}
                  </span>
                </div>
                <div className="space-y-3">
                  {(grouped.get(stage) || []).map((deal) => {
                    const latestQuote = [...(deal.quotations || [])].sort((a, b) =>
                      String(b.created_at).localeCompare(String(a.created_at))
                    )[0];
                    const wonQuote = (deal.quotations || []).find((q) =>
                      ["WON", "ACCEPTED"].includes(q.status)
                    );
                    const convertedQuote = (deal.quotations || []).find((q) => q.status === "CONVERTED");
                    return (
                      <article
                        key={deal.id}
                        draggable={canManage}
                        onDragStart={(e) => {
                          setDraggingId(deal.id);
                          e.dataTransfer.setData("text/deal-id", deal.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        className="rounded-xl border border-app bg-app p-3 shadow-sm"
                      >
                        <p className="text-sm font-bold text-app">{deal.title}</p>
                        <p className="text-[11px] text-app-muted">
                          {deal.customers?.full_name || t("crm.unnamedClient")}
                        </p>
                        <p className="mt-2 font-mono text-xs font-bold">
                          {deal.expected_value.toFixed(2)} {t("common.currency")}
                        </p>
                        {latestQuote && (
                          <p className="mt-1 font-mono text-[10px] text-app-accent">
                            {latestQuote.quote_number} · {t(`crm.quoteStatus.${latestQuote.status}`)}
                          </p>
                        )}
                        {canManage && (
                          <div className="mt-3 flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setQuoteDeal(deal);
                                setActiveQuote(latestQuote || null);
                              }}
                              className="rounded bg-[color:var(--app-accent-soft)] px-2 py-1 text-[10px] font-bold text-app-accent"
                            >
                              <FileText className="mr-1 inline h-3 w-3" />
                              {t("crm.quote.open")}
                            </button>
                            {latestQuote && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPrintData({ quotation: latestQuote, deal, branding })
                                }
                                className="rounded border px-2 py-1 text-[10px] font-bold"
                              >
                                <Printer className="mr-1 inline h-3 w-3" />
                                {t("common.print")}
                              </button>
                            )}
                            {wonQuote && !convertedQuote && canConvert && (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void handleConvert(wonQuote)}
                                className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white"
                              >
                                <Factory className="mr-1 inline h-3 w-3" />
                                {t("crm.quote.convert")}
                              </button>
                            )}
                            {convertedQuote?.production_order_id && (
                              <Link
                                href={`/production/${convertedQuote.production_order_id}`}
                                className="rounded border px-2 py-1 text-[10px] font-bold text-app-accent"
                              >
                                {t("crm.quote.viewOrder")}
                              </Link>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <DealFormModal
        isOpen={dealModalOpen}
        customers={customers}
        saving={saving}
        onClose={() => setDealModalOpen(false)}
        onSubmit={handleCreateDeal}
      />

      <QuotationBuilderModal
        isOpen={!!quoteDeal}
        deal={quoteDeal}
        quotation={activeQuote}
        products={products}
        saving={saving}
        onClose={() => {
          setQuoteDeal(null);
          setActiveQuote(null);
        }}
        onSubmit={handleSaveQuote}
      />

      {printData && (
        <div className="print-area">
          <QuotationPrintTemplate data={printData} />
        </div>
      )}

      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
