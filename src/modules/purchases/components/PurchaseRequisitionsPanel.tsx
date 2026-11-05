"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listProductionPurchaseRequisitionsAction } from "../actions/purchaseRequisitions";
import type { PurchaseRequisitionRow } from "../actions/purchaseRequisitions";
import { useI18n } from "@/i18n/I18nProvider";
import { Chip, useUiStandard } from "@/design-system/components";
import { StandardGrid } from "@/components/lists/StandardGrid";
import { TableRowActionsMenu } from "@/components/ui/table-row-actions-menu";
import { formatQuantity } from "@/lib/dates/localeDate";

interface Props {
  onOpenPurchase?: (purchaseId: string) => void;
}

export default function PurchaseRequisitionsPanel({ onOpenPurchase }: Props) {
  const { t, locale } = useI18n();
  // UI_STANDARD (UI-6): the requisitions on the grid ("open draft invoice" in the row menu); old table with the flag off.
  const standard = useUiStandard();
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

  if (standard && !error) {
    return (
      <StandardGrid<PurchaseRequisitionRow>
        id="purchases.requisitions"
        label={t("purchases.requisitionNo")}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        empty={t("purchases.requisitionsEmpty")}
        columns={[
          { key: "no", header: t("purchases.requisitionNo"), type: "code", cell: (row) => <span className="ds-mono font-semibold">{row.request_no}</span>, sortValue: (row) => row.request_no },
          {
            key: "order",
            header: t("production.workflow.orderNo"),
            cell: (row) =>
              row.production_order_id ? (
                <Link href={`/production/${row.production_order_id}`} className="hover:underline">
                  {row.production_order_no || row.production_order_id.slice(0, 8)}
                </Link>
              ) : (
                <span className="ds-text-danger font-semibold">{t("purchases.autoTriggeredSource")}</span>
              ),
            sortValue: (row) => row.production_order_no,
          },
          { key: "product", header: t("forms.selectProduct"), width: 220, className: "font-semibold", cell: (row) => row.product_name, sortValue: (row) => row.product_name },
          { key: "warehouse", header: t("production.warehouse"), cell: (row) => row.warehouse_name || "—", sortValue: (row) => row.warehouse_name },
          { key: "qty", header: t("forms.quantity"), type: "number", cell: (row) => `${formatQuantity(row.quantity, locale)} ${row.unit}`, sortValue: (row) => row.quantity },
          {
            key: "status",
            header: t("common.status"),
            type: "status",
            cell: (row) => (row.status === "auto_triggered" ? <Chip tone="danger">{t("purchases.statusAutoTriggered")}</Chip> : <Chip>{row.status}</Chip>),
            sortValue: (row) => row.status,
          },
        ]}
        rowActions={(row) =>
          row.purchase_id ? <TableRowActionsMenu items={[{ key: "open", label: t("purchases.openDraftInvoice"), onClick: () => onOpenPurchase?.(row.purchase_id!) }]} /> : null
        }
      />
    );
  }

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
                {row.production_order_id ? (
                  <Link href={`/production/${row.production_order_id}`} className="text-app-accent hover:underline">
                    {row.production_order_no || row.production_order_id.slice(0, 8)}
                  </Link>
                ) : (
                  <span className="text-rose-600 font-semibold">{t("purchases.autoTriggeredSource")}</span>
                )}
              </td>
              <td className="px-4 py-3 font-semibold">{row.product_name}</td>
              <td className="px-4 py-3">{row.warehouse_name || "—"}</td>
              <td className="px-4 py-3 text-right font-mono">
                {row.quantity} {row.unit}
              </td>
              <td className="px-4 py-3">
                {row.status === "auto_triggered" ? (
                  <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                    {t("purchases.statusAutoTriggered")}
                  </span>
                ) : (
                  row.status
                )}
              </td>
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
