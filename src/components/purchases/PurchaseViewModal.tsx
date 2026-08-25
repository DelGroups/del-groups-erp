"use client";

import React from "react";
import { X } from "lucide-react";
import type { PurchaseRecord } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

interface PurchaseViewModalProps {
  purchase: PurchaseRecord;
  onClose: () => void;
}

export default function PurchaseViewModal({ purchase, onClose }: PurchaseViewModalProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
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
          <div className="flex justify-end gap-6 text-sm font-bold">
            <span>{t("print.total")}: {purchase.total_amount.toFixed(2)} {t("common.currency")}</span>
            <span className="text-emerald-600">{t("print.paid")}: {purchase.paid_amount.toFixed(2)}</span>
            <span className="text-rose-600">{t("modals.purchaseView.debt")}: {purchase.debt_amount.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
