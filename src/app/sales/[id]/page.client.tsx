"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { InvoicePrintSystem, useInvoicePrintSystem } from "@/components/print/InvoicePrintSystem";
import { fetchSaleById, getSaleRemaining, type SaleRecord } from "@/lib/sales/fetchSales";
import { mapSaleToInvoicePrint } from "@/lib/print/mapSaleToInvoicePrint";
import { useI18n } from "@/i18n/I18nProvider";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import EQaimeExportButton from "@/components/tax/EQaimeExportButton";
import { exportSaleEQaime } from "@/lib/tax/eQaimeDocuments";

interface SaleDetailPageClientProps {
  saleId: string;
}

export default function SaleDetailPageClient({ saleId }: SaleDetailPageClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const invoicePrint = useInvoicePrintSystem();
  const branding = useCompanyBranding();
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();
  const [sale, setSale] = useState<SaleRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchSaleById(saleId).then((row) => {
      setSale(row);
      setLoading(false);
      if (!row) router.replace("/sales");
    });
  }, [saleId, router]);

  const handlePrint = () => {
    if (!sale) return;
    invoicePrint.requestPrint(mapSaleToInvoicePrint(sale));
  };

  return (
    <PageLayout>
      <header className="border-b border-app app-glass px-6 py-4">
        <Link
          href="/sales"
          className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-app-accent hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("common.back")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-app">{t("modals.salesView.title")}</h2>
            <p className="font-mono text-sm text-app-accent">{sale?.doc_no || "-"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EQaimeExportButton
              disabled={!sale}
              onExport={async (format) => {
                if (!sale) return;
                try {
                  await exportSaleEQaime(sale, branding, format);
                  showSuccess(t("tax.exportSuccess"));
                } catch (err) {
                  showError(err instanceof Error ? err.message : t("common.error"));
                }
              }}
            />
            <button
              type="button"
              disabled={!sale}
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-xl bg-[image:var(--app-gradient)] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              {t("common.print")}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {loading || !sale ? (
          <div className="app-card p-12 text-center text-sm text-app-muted">{t("common.loading")}</div>
        ) : (
          <div className="app-card space-y-4 p-6 text-sm">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs uppercase text-app-muted">{t("common.date")}</p>
                <p className="font-semibold">{sale.doc_date || "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-app-muted">{t("sales.customer")}</p>
                <p className="font-semibold">{sale.customer_name || "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-app-muted">{t("sales.warehouse")}</p>
                <p className="font-semibold">{sale.warehouse_name || "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-app-muted">{t("invoice.issuedBy")}</p>
                <p className="font-semibold">{sale.issued_by_name || sale.seller_name || "-"}</p>
              </div>
            </div>
            {(sale.created_by_name || sale.issued_by_name) &&
            sale.created_by &&
            sale.issued_by &&
            sale.created_by !== sale.issued_by ? (
              <p className="rounded-lg border border-app bg-app-card-hover px-3 py-2 text-xs text-app-muted">
                {t("invoice.auditTrail", {
                  issuedBy: sale.issued_by_name || sale.seller_name || "-",
                  createdBy: sale.created_by_name || "-",
                })}
              </p>
            ) : null}

            <table className="w-full border-collapse text-xs">
              <thead className="border-b bg-app-card-hover font-bold uppercase">
                <tr>
                  <th className="p-2 text-left">{t("dashboard.product")}</th>
                  <th className="p-2 text-left">{t("modals.salesView.quantity")}</th>
                  <th className="p-2 text-right">{t("modals.salesView.price")}</th>
                  <th className="p-2 text-right">{t("modals.salesView.lineTotal")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {(sale.items ?? []).map((item, idx) => (
                  <tr key={item.id || idx}>
                    <td className="p-2">{item.product_name}</td>
                    <td className="p-2">{item.quantity} {item.unit}</td>
                    <td className="p-2 text-right font-mono">{item.unit_price.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono font-bold">{item.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap gap-4 border-t border-app pt-4 font-bold">
              <span>{t("modals.salesView.total")}: {sale.total_amount.toFixed(2)} {t("common.currency")}</span>
              <span className="text-emerald-600">{t("modals.salesView.paid")}: {sale.paid_amount.toFixed(2)}</span>
              <span className="text-rose-600">
                {t("modals.salesView.remaining")}: {getSaleRemaining(sale).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </main>

      <InvoicePrintSystem
        branding={invoicePrint.branding}
        modalOpen={invoicePrint.modalOpen}
        pendingData={invoicePrint.pendingData}
        printPayload={invoicePrint.printPayload}
        closeModal={invoicePrint.closeModal}
        confirmPrint={invoicePrint.confirmPrint}
      />
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
