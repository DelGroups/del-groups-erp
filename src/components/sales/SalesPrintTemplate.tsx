"use client";

import React from "react";
import type { SaleRecord } from "@/lib/sales/fetchSales";
import { useI18n } from "@/i18n/I18nProvider";

interface SalesPrintTemplateProps {
  sale: SaleRecord;
  companyName?: string;
}

export default function SalesPrintTemplate({
  sale,
  companyName = "DEL GROUPS MMC",
}: SalesPrintTemplateProps) {
  const { t } = useI18n();

  return (
    <div className="mx-auto w-[210mm] bg-white p-8 font-sans text-black">
      <div className="mb-6 flex items-start justify-between border-b-2 border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold">{companyName}</h1>
          <p className="text-sm text-gray-500">{t("print.salesInvoice")}</p>
        </div>
        <div className="text-right text-sm">
          <p>
            <strong>{t("print.docNo")}:</strong> {sale.doc_no}
          </p>
          <p>
            <strong>{t("common.date")}:</strong> {sale.doc_date || "-"}
          </p>
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg border bg-slate-50 p-4 text-sm">
        <div>
          <p className="text-xs uppercase text-slate-500">{t("sales.customer")}</p>
          <p className="font-bold">{sale.customer_name || "-"}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">{t("sales.warehouse")}</p>
          <p className="font-bold">{sale.warehouse_name || "-"}</p>
        </div>
      </div>
      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100">
            <th className="border p-2 text-left">{t("print.rowNo")}</th>
            <th className="border p-2 text-left">{t("print.product")}</th>
            <th className="border p-2 text-right">{t("print.quantity")}</th>
            <th className="border p-2 text-right">{t("print.price")}</th>
            <th className="border p-2 text-right">{t("print.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item, idx) => (
            <tr key={item.id || idx}>
              <td className="border p-2">{idx + 1}</td>
              <td className="border p-2">{item.product_name}</td>
              <td className="border p-2 text-right">
                {item.quantity} {item.unit}
              </td>
              <td className="border p-2 text-right">{item.unit_price.toFixed(2)}</td>
              <td className="border p-2 text-right">{item.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1 text-right text-sm font-bold">
        <p>{t("print.total")}: {sale.total_amount.toFixed(2)} {t("common.currency")}</p>
        <p>{t("print.paid")}: {sale.paid_amount.toFixed(2)} {t("common.currency")}</p>
        <p>{t("print.remainingDebt")}: {sale.remaining_balance.toFixed(2)} {t("common.currency")}</p>
      </div>
    </div>
  );
}
