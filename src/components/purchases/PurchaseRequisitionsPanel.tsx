"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listProductionPurchaseRequisitionsAction } from "@/lib/actions/purchaseRequisitions";
import type { PurchaseRequisitionRow } from "@/lib/actions/purchaseRequisitions";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  onOpenPurchase?: (purchaseId: string) => void;
}

export default function PurchaseRequisitionsPanel({ onOpenPurchase }: Props) {
  const { t } = useI18n();
  const [rows, setRows] = useState<PurchaseRequisitionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listProductionPurchaseRequisitionsAction();
    setLoading(false);
    if (!result.success) {
      setError(result.error || t("common.error"));
      setRows([]);
      return;
    }
    setRows(result.data || []);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="p-12 text-center text-xs text-app-muted">{t("purchases.requisitionsLoading")}</div>;
  }

  if (error) {
    return <div className="p-6 text-center text-sm text-rose-400">{error}</div>;
  }

  if (rows.length === 0) {
    return <div className="p-12 text-center text-xs text-app-muted">{t("purchases.requisitionsEmpty")}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-app bg-app-card-hover font-bold uppercase text-app">
          <tr>
            <th className="px-4 py-3">{t("purchases.requisitionNo")}</th>
            <th className="px-4 py-3">{t("production.workflow.orderNo")}</th>
            <th className="px-4 py-3">{t("forms.selectProduct")}</th>
            <th className="px-4 py-3">{t("production.warehouse")}</th>
            <th className="px-4 py-3 text-right">{t("forms.quantity")}</th>
            <th className="px-4 py-3">{t("common.status")}</th>
            <th className="px-4 py-3 text-center">{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-app">
          {rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-app-card-hover">
              <td className="px-4 py-3 font-mono font-bold text-amber-500">{row.request_no}</td>
              <td className="px-4 py-3">
                <Link href={`/production/${row.production_order_id}`} className="text-app-accent hover:underline">
                  {row.production_order_no || row.production_order_id.slice(0, 8)}
                </Link>
              </td>
              <td className="px-4 py-3 font-semibold">{row.product_name}</td>
              <td className="px-4 py-3">{row.warehouse_name || "—"}</td>
              <td className="px-4 py-3 text-right font-mono">
                {row.quantity} {row.unit}
              </td>
              <td className="px-4 py-3">{row.status}</td>
              <td className="px-4 py-3 text-center">
                {row.purchase_id ? (
                  <button
                    type="button"
                    className="text-app-accent underline"
                    onClick={() => onOpenPurchase?.(row.purchase_id!)}
                  >
                    {t("purchases.openDraftInvoice")}
                  </button>
                ) : (
                  <span className="text-app-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
