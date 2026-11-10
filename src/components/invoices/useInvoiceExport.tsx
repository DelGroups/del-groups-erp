"use client";

import { useState } from "react";
import { toast } from "sonner";
import PrintInvoiceModal from "@/components/print/PrintInvoiceModal";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useI18n } from "@/i18n/I18nProvider";
import type { InvoiceExportDoc, InvoiceExportFormat } from "@/lib/export/invoiceExport";
import { fetchPartyVoen, resolveBranding } from "@/lib/tax/eQaimeDocuments";
import type { PrintMode } from "@/lib/print/types";
import type { SaleRecord } from "@/modules/sales/lib/fetchSales";
import type { PurchaseRecord } from "@/types/database.types";
import { useInvoiceTools } from "./InvoiceToolsFlag";

type Source<T> = T | (() => Promise<T | null>);

async function resolve<T>(source: Source<T>): Promise<T> {
  const record = typeof source === "function" ? await (source as () => Promise<T | null>)() : source;
  if (!record) throw new Error("invoice not found");
  return record;
}

/**
 * INV-2: "Download Excel" and "Download PDF" for one invoice: the one code path behind the list
 * row menus, the classic lists and the opened invoice. `enabled` is INVOICE_TOOLS; the callers
 * show the entries only then. A regular (not official) sales invoice asks for the PDF layout in the
 * print's own modal (render `dialog`); official invoices and purchases skip the question.
 */
export function useInvoiceExport() {
  const enabled = useInvoiceTools();
  const branding = useCompanyBranding();
  const { t, intlTag } = useI18n();
  const [askLayout, setAskLayout] = useState<InvoiceExportDoc | null>(null);

  // The mapping, the Excel library, pdfmake and the font load only on click (one async chunk).
  const exporter = () => import("@/lib/export/invoiceExportDownload");

  const run = (doc: InvoiceExportDoc, format: InvoiceExportFormat, mode: PrintMode) => {
    const work = exporter().then(async (m) => {
      await m.downloadInvoiceFile(doc, m.invoiceExportLabels(t), format, { mode, locale: intlTag });
      return m.invoiceExportFileName(doc, format);
    });
    toast.promise(work, { loading: t("invoiceTools.export.working"), success: (fileName) => fileName, error: t("invoiceTools.export.error") });
    return work.catch(() => undefined);
  };

  const start = async (load: () => Promise<InvoiceExportDoc>, format: InvoiceExportFormat) => {
    // "Preparing the file…" from the click on, also while the invoice and the VÖEN load.
    const waiting = toast.loading(t("invoiceTools.export.working"));
    let doc: InvoiceExportDoc;
    try {
      doc = await load();
    } catch {
      toast.error(t("invoiceTools.export.error"), { id: waiting });
      return;
    }
    toast.dismiss(waiting);
    if (format === "pdf" && doc.kind === "sale" && !doc.isOfficial) {
      setAskLayout(doc);
      return;
    }
    await run(doc, format, "official");
  };

  // The record, or a loader for it (the classic lists fetch the full invoice on click); a load
  // that fails or finds nothing ends in the same error toast as a failed file.
  const exportSale = (source: Source<SaleRecord>, format: InvoiceExportFormat) =>
    start(async () => {
      const sale = await resolve(source);
      const [m, voen, full] = await Promise.all([exporter(), fetchPartyVoen("customers", sale.customer_id), resolveBranding(branding)]);
      return m.saleToExportDoc(sale, { branding: full, partyVoen: voen });
    }, format);

  const exportPurchase = (source: Source<PurchaseRecord>, format: InvoiceExportFormat) =>
    start(async () => {
      const purchase = await resolve(source);
      const [m, voen, full] = await Promise.all([exporter(), fetchPartyVoen("suppliers", purchase.supplier_id), resolveBranding(branding)]);
      return m.purchaseToExportDoc(purchase, { branding: full, partyVoen: voen });
    }, format);

  const dialog = (
    <PrintInvoiceModal
      open={askLayout !== null}
      docNo={askLayout?.docNo}
      title={t("invoiceTools.export.pdfModalTitle")}
      onClose={() => setAskLayout(null)}
      onSelect={(mode) => {
        const doc = askLayout;
        setAskLayout(null);
        if (doc) void run(doc, "pdf", mode);
      }}
    />
  );

  return { enabled, exportSale, exportPurchase, dialog };
}
