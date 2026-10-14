"use client";

import React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, Printer } from "lucide-react";
import { formatFigure } from "@/design-system/logic";
import { useAuth } from "@/components/auth/AuthProvider";
import { InvoicePrintSystem, useInvoicePrintSystem } from "@/components/print/InvoicePrintSystem";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { EngineScreen, FormView, useFormatter, type FormAction } from "@/views";
import { listConsignmentDispatchesAction, listConsignmentInventoryAction, listConsignmentReportsAction, listConsignmentReturnsAction } from "../actions/consignment";
import { mapConsignmentReportToInvoicePrint } from "../lib/mapConsignmentReportToInvoicePrint";
import type { ConsignmentDispatch, ConsignmentMonthlyReport, ConsignmentReturn } from "../lib/types";
import { consignmentDocuments, consignmentKpis, documentsDefinition, DOCS_VIEW_KEY, partnerStockDefinition, repPerformance, STOCK_VIEW_KEY, type ConsignmentDocRecord } from "../views/consignment";
import ConsignmentDeliveryPrintTemplate from "./ConsignmentDeliveryPrintTemplate";
import ConsignmentRepPerformanceChart from "./ConsignmentRepPerformanceChart";

type Row = Record<string, unknown>;
const unwrap = async <T,>(p: Promise<{ success: true; data?: T } | { success: false; error: string }>): Promise<T> => {
  const r = await p;
  if (!r.success) throw new Error(r.error);
  return (r.data ?? []) as T;
};
/** The three document lists, read once and shared by the documents tab, its panel and the dashboard. */
const fetchSources = async () => {
  const [dispatches, returns, reports] = await Promise.all([
    unwrap<ConsignmentDispatch[]>(listConsignmentDispatchesAction()),
    unwrap<ConsignmentReturn[]>(listConsignmentReturnsAction()),
    unwrap<ConsignmentMonthlyReport[]>(listConsignmentReportsAction()),
  ]);
  return { dispatches, returns, reports };
};
const SOURCES_KEY = ["views", DOCS_VIEW_KEY, "sources"] as const;
const STOCK = partnerStockDefinition({ fetchAll: async () => (await unwrap(listConsignmentInventoryAction())) as unknown as Row[] });
const DOCS = documentsDefinition({
  fetchAll: async () => {
    const s = await fetchSources();
    return consignmentDocuments(s.dispatches as unknown as Row[], s.returns as unknown as Row[], s.reports as unknown as Row[]) as unknown as Row[];
  },
});

/** Consignment on the view engine (new UI): stock held at partners, and the document history. */
export default function ConsignmentsScreen() {
  const params = useSearchParams();
  return params.get("tab") === "documents" ? <DocumentsTab /> : <StockTab />;
}

function Tabs({ active }: { active: "stock" | "documents" }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("consignments.pageTitle")} className="flex gap-4 border-b" style={{ borderColor: "var(--ds-border)" }}>
      <Link href="/consignments" className="ds-tab" aria-current={active === "stock" ? "page" : undefined}>
        {t("consignments.tabStock")}
      </Link>
      <Link href="/consignments?tab=documents" className="ds-tab" aria-current={active === "documents" ? "page" : undefined}>
        {t("consignments.tabHistory")}
      </Link>
    </nav>
  );
}

function CreateLinks() {
  const { t } = useI18n();
  const { can } = useAuth();
  if (!can("can_manage_consignments")) return null;
  return (
    <>
      <Link href="/consignments/initial-balance/new" className="ds-btn ds-btn-sm">
        <Plus className="h-4 w-4" aria-hidden />
        {t("consignments.opTypeInitialBalance")}
      </Link>
      <Link href="/consignments/dispatch/new" className="ds-btn ds-btn-sm">
        <Plus className="h-4 w-4" aria-hidden />
        {t("consignments.opTypeDispatch")}
      </Link>
      <Link href="/consignments/settlement/new" className="ds-btn ds-btn-sm ds-btn-primary">
        <Plus className="h-4 w-4" aria-hidden />
        {t("consignments.opTypeActualSale")}
      </Link>
    </>
  );
}

function useDocs(): ConsignmentDocRecord[] {
  const sources = useQuery({ queryKey: SOURCES_KEY, queryFn: fetchSources });
  return React.useMemo(
    () => (sources.data ? consignmentDocuments(sources.data.dispatches as unknown as Row[], sources.data.returns as unknown as Row[], sources.data.reports as unknown as Row[]) : []),
    [sources.data],
  );
}

function StockTab() {
  const { t } = useI18n();
  const docs = useDocs();
  return (
    <EngineScreen
      definition={STOCK}
      title={t("consignments.tabStock")}
      header={<Tabs active="stock" />}
      actions={<CreateLinks />}
      kpis={(records, fmt, ctx) => consignmentKpis(records, docs, fmt, ctx.now)}
      recordTitle={(r) => `${r.partner_name ?? ""} · ${r.product_name}`}
      renderRecord={(r) => <StockRecordView id={r.id} />}
    />
  );
}

function StockRecordView({ id }: { id: string }) {
  const fmt = useFormatter();
  const rows = useQuery({ queryKey: ["views", STOCK_VIEW_KEY, "rows"], queryFn: STOCK.model.fetchAll! });
  const raw = rows.data?.find((r) => String(r.id) === id);
  if (!raw) return null;
  return <FormView definition={STOCK} record={STOCK.model.toRecord(raw)} canWrite={false} fmt={fmt} />;
}

function DocumentsTab() {
  const { t } = useI18n();
  // The invoice print dialog lives on the page, not in the side panel (its print area is
  // positioned on the page); the panel closes and hands the report over.
  const invoicePrint = useInvoicePrintSystem();
  return (
    <>
      <EngineScreen
        definition={DOCS}
        title={t("consignments.tabHistory")}
        header={<Tabs active="documents" />}
        actions={<CreateLinks />}
        dashboard={(records) => (
          <section className="ds-card ds-card-pad" aria-label={t("consignments.salesRep")}>
            <ConsignmentRepPerformanceChart data={repPerformance(records, t("consignments.unassignedRep"))} />
          </section>
        )}
        recordTitle={(r) => r.doc_no}
        renderRecord={(r, { close }) => (
          <DocumentRecordView
            record={r}
            printReport={(report) => {
              close();
              invoicePrint.requestPrint(mapConsignmentReportToInvoicePrint(report));
            }}
          />
        )}
      />
      <InvoicePrintSystem
        branding={invoicePrint.branding}
        modalOpen={invoicePrint.modalOpen}
        pendingData={invoicePrint.pendingData}
        printPayload={invoicePrint.printPayload}
        closeModal={invoicePrint.closeModal}
        confirmPrint={invoicePrint.confirmPrint}
      />
    </>
  );
}

function DocumentRecordView({ record, printReport }: { record: ConsignmentDocRecord; printReport: (report: ConsignmentMonthlyReport) => void }) {
  const { t, locale } = useI18n();
  const fmt = useFormatter();
  const companyName = useCompanyProfile().displayName;
  const { printData, setPrintData } = useDocumentPrint<ConsignmentDispatch>();
  const sources = useQuery({ queryKey: SOURCES_KEY, queryFn: fetchSources });
  const dispatch = record.document_type === "DISPATCH" || record.document_type === "INITIAL_BALANCE" ? sources.data?.dispatches.find((d) => d.id === record.source_id) : undefined;
  const ret = record.document_type === "RETURN" ? sources.data?.returns.find((r) => r.id === record.source_id) : undefined;
  const report = record.document_type === "ACTUAL_SALE" ? sources.data?.reports.find((r) => r.id === record.source_id) : undefined;
  const lines = (dispatch?.items ?? ret?.items ?? []).map((i) => ({ name: i.product_name, code: i.product_code, qty: i.quantity, unit: i.unit, price: i.unit_price }));
  const soldLines = (report?.sold_items ?? []).map((i) => ({ name: i.product_name, code: i.product_code, qty: i.quantity_sold, unit: null, price: i.unit_price }));
  const all = lines.length ? lines : soldLines;
  const actions: FormAction[] = [
    ...(record.document_type === "DISPATCH" && dispatch
      ? [{ key: "print", label: t("common.print"), primary: true, icon: <Printer className="h-4 w-4" aria-hidden />, onClick: () => setPrintData(dispatch) }]
      : []),
    ...(report ? [{ key: "print", label: t("common.print"), primary: true, icon: <Printer className="h-4 w-4" aria-hidden />, onClick: () => printReport(report) }] : []),
  ];
  const table = (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th scope="col" className="px-2 py-1.5 ds-label">
            {t("dashboard.product")}
          </th>
          <th scope="col" className="px-2 py-1.5 text-right ds-label">
            {t("modals.salesView.quantity")}
          </th>
          <th scope="col" className="px-2 py-1.5 text-right ds-label">
            {t("modals.salesView.price")}
          </th>
          <th scope="col" className="px-2 py-1.5 text-right ds-label">
            {t("modals.salesView.lineTotal")}
          </th>
        </tr>
      </thead>
      <tbody>
        {all.map((l, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--ds-border)" }}>
            <td className="px-2 py-1.5">
              {l.name}
              {l.code ? <span className="ml-2 ds-mono ds-subtle text-[length:var(--ds-text-xs)]">{l.code}</span> : null}
            </td>
            <td className="px-2 py-1.5 text-right ds-mono">{`${formatFigure(l.qty, 2, locale)}${l.unit ? ` ${l.unit}` : ""}`}</td>
            <td className="px-2 py-1.5 text-right ds-mono">{formatFigure(l.price, 2, locale)}</td>
            <td className="px-2 py-1.5 text-right ds-mono font-semibold">{formatFigure(l.qty * l.price, 2, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <FormView
        definition={DOCS}
        record={record}
        canWrite={false}
        fmt={fmt}
        actions={actions}
        extraTabs={[{ key: "lines", label: t("sales.engine.tabs.lines", { count: all.length }), content: table }]}
      />
      {printData
        ? createPortal(
            <div className="print-area">
              <ConsignmentDeliveryPrintTemplate data={printData} companyName={companyName} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
