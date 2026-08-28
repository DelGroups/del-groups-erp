"use client";

import React from "react";
import { X } from "lucide-react";
import type { WriteoffRecord } from "@/lib/inventory/writeoff";
import type { Warehouse } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

interface DamagedGoodsViewModalProps {
  writeoff: WriteoffRecord;
  warehouses: Warehouse[];
  onClose: () => void;
}

export default function DamagedGoodsViewModal({
  writeoff,
  warehouses,
  onClose,
}: DamagedGoodsViewModalProps) {
  const { t } = useI18n();
  const warehouseName =
    warehouses.find((w) => w.id === writeoff.warehouse_id)?.name || "-";
  const totalQty = writeoff.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="app-modal flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-app">{t("modals.damagedGoodsView.title")}</h3>
            <p className="font-mono text-xs text-app-accent">{writeoff.document_number}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover hover:text-app"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-app-card-hover p-4 md:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("common.date")}</p>
              <p className="font-semibold">{writeoff.writeoff_date || "-"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("common.warehouse")}</p>
              <p className="font-semibold">{warehouseName}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("modals.damagedGoodsView.checker")}</p>
              <p className="font-semibold">{writeoff.checker_name}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-app-muted">{t("modals.damagedGoodsView.totalQty")}</p>
              <p className="font-semibold">{totalQty}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-app">
            <table className="w-full text-left">
              <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
                <tr>
                  <th className="p-2.5">{t("print.rowNo")}</th>
                  <th className="p-2.5">{t("dashboard.product")}</th>
                  <th className="p-2.5">{t("forms.quantity")}</th>
                  <th className="p-2.5">{t("modals.damagedGoodsView.problem")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {writeoff.items.map((item, idx) => (
                  <tr key={item.id || idx}>
                    <td className="p-2.5 text-app-muted">{idx + 1}</td>
                    <td className="p-2.5">
                      <span className="font-medium">{item.product_name}</span>
                      <span className="ml-1 font-mono text-[10px] text-app-muted">
                        ({item.product_code})
                      </span>
                    </td>
                    <td className="p-2.5">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="p-2.5 text-app-muted">{item.issue_description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {writeoff.notes && (
            <div className="rounded-xl border border-app p-3">
              <p className="mb-1 text-[10px] font-bold uppercase text-app-muted">{t("common.notes")}</p>
              <p className="text-app">{writeoff.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
