"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { DEFAULT_CONSIGNMENT_TERMS_AZ, type ConsignmentDispatch } from "@/lib/consignment/types";

interface Props {
  data: ConsignmentDispatch;
  companyName?: string;
}

export default function ConsignmentDeliveryPrintTemplate({
  data,
  companyName = "DEL GROUPS MMC",
}: Props) {
  const { t, formatDate } = useI18n();
  const totalQty = data.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalValue = data.items.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
    0
  );

  return (
    <div className="mx-auto w-[210mm] bg-white p-10 font-sans text-black">
      <header className="mb-6 border-b-2 border-slate-900 pb-4 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
          {t("consignments.print.deliveryTitle")}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{companyName}</h1>
        <p className="mt-2 text-sm">
          <strong>{t("common.docNo")}:</strong> {data.dispatch_no}
          {" · "}
          <strong>{t("common.date")}:</strong> {formatDate(data.dispatch_date)}
        </p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs uppercase text-slate-500">{t("consignments.partner")}</p>
          <p className="font-bold">{data.partner_name || "-"}</p>
        </div>
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs uppercase text-slate-500">{t("common.warehouse")}</p>
          <p className="font-bold">{data.warehouse_name || "-"}</p>
        </div>
      </section>

      <table className="mb-5 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100">
            <th className="border p-2 text-left">#</th>
            <th className="border p-2 text-left">{t("print.product")}</th>
            <th className="border p-2 text-right">{t("print.quantity")}</th>
            <th className="border p-2 text-right">{t("print.price")}</th>
            <th className="border p-2 text-right">{t("print.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, idx) => (
            <tr key={`${item.product_id}-${idx}`}>
              <td className="border p-2">{idx + 1}</td>
              <td className="border p-2">
                {item.product_name}
                {item.product_code ? ` (${item.product_code})` : ""}
              </td>
              <td className="border p-2 text-right">
                {item.quantity} {item.unit}
              </td>
              <td className="border p-2 text-right">{item.unit_price.toFixed(2)}</td>
              <td className="border p-2 text-right">
                {(item.quantity * item.unit_price).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mb-5 text-right text-sm font-bold">
        {t("consignments.totalDispatched")}: {totalQty} · {totalValue.toFixed(2)} {t("common.currency")}
      </p>

      <section className="mb-10 text-sm">
        <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-bold uppercase">
          {t("consignments.print.terms")}
        </h2>
        <p className="whitespace-pre-wrap leading-6">{data.notes || DEFAULT_CONSIGNMENT_TERMS_AZ}</p>
      </section>

      <section className="grid grid-cols-2 gap-10 text-sm">
        <div className="text-center">
          <div className="mb-10 h-16 border-b border-slate-400" />
          <p className="font-bold">{t("consignments.print.sender")}</p>
        </div>
        <div className="text-center">
          <div className="mb-10 h-16 border-b border-slate-400" />
          <p className="font-bold">{t("consignments.print.recipient")}</p>
        </div>
      </section>
    </div>
  );
}
