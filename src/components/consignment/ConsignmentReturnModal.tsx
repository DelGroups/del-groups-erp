"use client";

import React from "react";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/i18n/I18nProvider";
import type { ConsignmentLookups } from "@/lib/actions/consignment";
import type { ConsignmentInventoryRow } from "@/lib/consignment/types";

export interface ConsignmentReturnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookups: ConsignmentLookups | null;
  saving: boolean;

  partnerId: string;
  setPartnerId: (id: string) => void;
  partnerInventory: ConsignmentInventoryRow[];

  returnWarehouseId: string;
  setReturnWarehouseId: (value: string) => void;
  returnQtyByProduct: Record<string, string>;
  setReturnQtyByProduct: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onReturn: () => void;
}

export default function ConsignmentReturnModal(props: ConsignmentReturnModalProps) {
  const { t } = useI18n();
  const { lookups, partnerId, setPartnerId, partnerInventory, saving } = props;

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t("consignments.opTypeReturn")}
      footer={
        <>
          <button type="button" className="btn-secondary text-xs" onClick={() => props.onOpenChange(false)}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn-primary text-xs" disabled={saving} onClick={props.onReturn}>
            {saving ? t("common.saving") : t("consignments.confirmReturn")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">{t("consignments.partner")}</label>
          <select
            className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
          >
            <option value="">{t("consignments.partner")}</option>
            {(lookups?.partners || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.company_name || p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">{t("common.warehouse")}</label>
          <select
            className="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
            value={props.returnWarehouseId}
            onChange={(e) => props.setReturnWarehouseId(e.target.value)}
          >
            <option value="">{t("common.warehouse")}</option>
            {(lookups?.warehouses || []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {!partnerId ? (
          <p className="text-sm text-app-muted">{t("consignments.selectPartnerFirst")}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-app">
            <table className="min-w-full text-sm">
              <thead className="bg-app text-left text-xs uppercase text-app-muted">
                <tr>
                  <th className="px-3 py-2">{t("print.product")}</th>
                  <th className="px-3 py-2 text-right">{t("consignments.remaining")}</th>
                  <th className="px-3 py-2">{t("consignments.returnQty")}</th>
                </tr>
              </thead>
              <tbody>
                {partnerInventory
                  .filter((row) => row.remaining_qty > 0)
                  .map((row) => (
                    <tr key={row.id} className="border-t border-app">
                      <td className="px-3 py-2">{row.product_name}</td>
                      <td className="px-3 py-2 text-right font-bold">{row.remaining_qty}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          max={row.remaining_qty}
                          className="w-24 rounded-lg border border-app px-2 py-1"
                          value={props.returnQtyByProduct[row.product_id] || ""}
                          onChange={(e) =>
                            props.setReturnQtyByProduct((prev) => ({
                              ...prev,
                              [row.product_id]: e.target.value,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
