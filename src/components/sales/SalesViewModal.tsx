"use client";

import React from "react";
import { Banknote, X } from "lucide-react";
import type { SaleRecord } from "@/lib/sales/fetchSales";
import { useI18n } from "@/i18n/I18nProvider";

interface SalesViewModalProps {
  sale: SaleRecord;
  onClose: () => void;
  onPayment?: () => void;
}

export default function SalesViewModal({ sale, onClose, onPayment }: SalesViewModalProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="app-modal flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-app">{t("modals.salesView.title")}</h3>
            <p className="font-mono text-xs text-app-accent">{sale.doc_no}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-app-card-hover p-4 md:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("common.date")}</p>
              <p className="font-semibold">{sale.doc_date || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("sales.customer")}</p>
              <p className="font-semibold">{sale.customer_name || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("sales.warehouse")}</p>
              <p className="font-semibold">{sale.warehouse_name || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("modals.salesView.seller")}</p>
              <p className="font-semibold">{sale.seller_name || "-"}</p>
            </div>
          </div>
          <table className="w-full overflow-hidden rounded-xl border border-app">
            <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
              <tr>
                <th className="p-2.5">{t("dashboard.product")}</th>
                <th className="p-2.5">{t("modals.salesView.quantity")}</th>
                <th className="p-2.5">{t("modals.salesView.price")}</th>
                <th className="p-2.5 text-right">{t("modals.salesView.lineTotal")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sale.items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-app-muted">
                    {t("modals.salesView.noLineItems")}
                  </td>
                </tr>
              ) : (
                sale.items.map((item, idx) => (
                  <tr key={item.id || idx}>
                    <td className="p-2.5">{item.product_name}</td>
                    <td className="p-2.5">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="p-2.5 font-mono">{item.unit_price.toFixed(2)}</td>
                    <td className="p-2.5 text-right font-mono font-bold">
                      {item.total.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-4 border-t border-app pt-4">
            <div className="flex gap-6 text-sm font-bold">
              <span>{t("modals.salesView.total")}: {sale.total_amount.toFixed(2)} {t("common.currency")}</span>
              <span className="text-emerald-600">{t("modals.salesView.paid")}: {sale.paid_amount.toFixed(2)}</span>
              <span className="text-rose-600">{t("modals.salesView.remaining")}: {sale.remaining_balance.toFixed(2)}</span>
            </div>
            {onPayment && (
              <button
                type="button"
                onClick={onPayment}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Banknote className="h-4 w-4" />
                {t("common.payment")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
