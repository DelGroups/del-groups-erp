"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { ConsignmentMonthlyReport } from "@/lib/consignment/types";

interface Props {
  data: ConsignmentMonthlyReport;
  companyName?: string;
}

export default function ConsignmentSettlementPrintTemplate({
  data,
  companyName = "DEL GROUPS MMC",
}: Props) {
  const { t, formatDate } = useI18n();

  return (
    <div className="mx-auto w-[210mm] bg-white p-10 font-sans text-black">
      <header className="mb-6 border-b-2 border-slate-900 pb-4 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
          {t("consignments.print.settlementTitle")}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{companyName}</h1>
        <p className="mt-2 text-sm">
          <strong>{t("consignments.reportNo")}:</strong> {data.report_no}
          {" · "}
          <strong>{t("consignments.period")}:</strong> {data.report_period}
        </p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs uppercase text-slate-500">{t("consignments.partner")}</p>
          <p className="font-bold">{data.partner_name || "-"}</p>
        </div>
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs uppercase text-slate-500">{t("consignments.invoiceNo")}</p>
          <p className="font-bold">{data.invoice_id || "-"}</p>
          <p className="text-xs text-slate-500">{formatDate(data.created_at)}</p>
        </div>
      </section>

      <table className="mb-5 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100">
            <th className="border p-2 text-left">#</th>
            <th className="border p-2 text-left">{t("print.product")}</th>
            <th className="border p-2 text-right">{t("consignments.sold")}</th>
            <th className="border p-2 text-right">{t("print.price")}</th>
            <th className="border p-2 text-right">{t("print.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {data.sold_items.map((item, idx) => (
            <tr key={`${item.product_id}-${idx}`}>
              <td className="border p-2">{idx + 1}</td>
              <td className="border p-2">{item.product_name}</td>
              <td className="border p-2 text-right">{item.quantity_sold}</td>
              <td className="border p-2 text-right">{item.unit_price.toFixed(2)}</td>
              <td className="border p-2 text-right">{item.total_price.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-right text-base font-bold">
        {t("common.total")}: {data.total_amount.toFixed(2)} {t("common.currency")}
      </p>
      {data.notes && <p className="mt-4 text-sm">{data.notes}</p>}

      <section className="mt-12 grid grid-cols-2 gap-10 text-sm">
        <div className="text-center">
          <div className="mb-10 h-16 border-b border-slate-400" />
          <p className="font-bold">{t("consignments.print.company")}</p>
        </div>
        <div className="text-center">
          <div className="mb-10 h-16 border-b border-slate-400" />
          <p className="font-bold">{t("consignments.print.partnerSign")}</p>
        </div>
      </section>
    </div>
  );
}
