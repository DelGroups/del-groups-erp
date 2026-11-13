"use client";

import React from "react";
import { X } from "lucide-react";
import type { PurchaseRecord } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";
import { useUiStandard } from "@/design-system/components";
import { DocumentLinesGrid } from "@/components/lists/DocumentLinesGrid";
import { useCompanyBranding } from "@/hooks/useCompanyBranding";
import EQaimeExportButton from "@/components/tax/EQaimeExportButton";
import { exportPurchaseEQaime } from "@/lib/tax/eQaimeDocuments";
import { useInvoiceExport } from "@/components/invoices/useInvoiceExport";
import { InvoiceExportButtons } from "@/components/invoices/invoiceExportActions";
import { DateChangeButton, useDocumentDateChange } from "@/components/documents/DocumentDateChange";
import { normalizePurchaseDocumentStatus } from "@/lib/invoices/invoiceStatus";
import { purchaseDocumentDate } from "../lib/purchaseDates";

interface PurchaseViewModalProps {
  purchase: PurchaseRecord;
  onClose: () => void;
  /** After a date change (DATE-1): the list reloads. */
  onChanged?: () => void;
}

export default function PurchaseViewModal({ purchase, onClose, onChanged }: PurchaseViewModalProps) {
  const { t } = useI18n();
  // UI_STANDARD (UI-6): the purchase lines on the grid; old table with the flag off.
  const standard = useUiStandard();
  const branding = useCompanyBranding();
  // INVOICE_TOOLS (INV-2): "Download Excel" / "Download PDF" next to the e-qaimə export.
  const invoiceExport = useInvoiceExport();
  // DOC_DATE_CHANGE (DATE-1): "Tarixi dəyiş" for admins on a posted invoice; the list reloads.
  const dateChange = useDocumentDateChange(() => {
    onChanged?.();
    onClose();
  });
  const datePosted = normalizePurchaseDocumentStatus(purchase.status) === "posted";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="app-modal flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-app">{t("modals.purchaseView.title")}</h3>
            <p className="font-mono text-xs text-emerald-600">{purchase.invoice_number}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-app-card-hover p-4 md:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("common.date")}</p>
              <p className="font-semibold">{purchase.doc_date || purchase.created_at?.slice(0, 10) || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("purchases.supplier")}</p>
              <p className="font-semibold">{purchase.supplier_name || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("purchases.warehouse")}</p>
              <p className="font-semibold">{purchase.warehouse_name || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("common.status")}</p>
              <p className="font-semibold">{purchase.status || "-"}</p>
            </div>
          </div>
          {standard ? (
            <DocumentLinesGrid
              id="purchases-view-lines"
              label={t("dashboard.product")}
              lines={purchase.items.map((item, idx) => ({ key: item.id || String(idx), name: item.product_name, quantity: item.quantity, unit: item.unit, price: item.unit_price, total: item.total }))}
              headers={{ product: t("dashboard.product"), quantity: t("forms.quantity"), price: t("forms.price"), total: t("forms.lineTotal") }}
            />
          ) : (
          <table className="w-full overflow-hidden rounded-xl border border-app">
            <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
              <tr>
                <th className="p-2.5">{t("dashboard.product")}</th>
                <th className="p-2.5">{t("forms.quantity")}</th>
                <th className="p-2.5">{t("forms.price")}</th>
                <th className="p-2.5 text-right">{t("forms.lineTotal")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchase.items.map((item, idx) => (
                <tr key={item.id || idx}>
                  <td className="p-2.5">{item.product_name}</td>
                  <td className="p-2.5">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="p-2.5 font-mono">{item.unit_price.toFixed(2)}</td>
                  <td className="p-2.5 text-right font-mono font-bold">{item.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="flex justify-end gap-6 text-sm font-bold">
              <span>{t("print.total")}: {purchase.total_amount.toFixed(2)} {t("common.currency")}</span>
              <span className="text-emerald-600">{t("print.paid")}: {purchase.paid_amount.toFixed(2)}</span>
              <span className="text-rose-600">{t("modals.purchaseView.debt")}: {purchase.debt_amount.toFixed(2)}</span>
            </div>
            {dateChange.allowed && datePosted ? (
              <DateChangeButton onClick={() => dateChange.open({ type: "purchase", id: purchase.id, label: purchase.invoice_number || purchase.id, date: purchaseDocumentDate(purchase) })} />
            ) : null}
            {invoiceExport.enabled ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <InvoiceExportButtons t={t} onExport={(format) => void invoiceExport.exportPurchase(purchase, format)} />
                <EQaimeExportButton onExport={(format) => exportPurchaseEQaime(purchase, branding, format)} />
              </div>
            ) : (
              <EQaimeExportButton
                onExport={(format) => exportPurchaseEQaime(purchase, branding, format)}
              />
            )}
          </div>
        </div>
      </div>
      {dateChange.dialog}
    </div>
  );
}
