"use client";

import React from "react";
import type { ProductionOrder } from "@/lib/production/types";
import { useI18n } from "@/i18n/I18nProvider";

export interface ProductionContractPrintData {
  companyName: string;
  order: ProductionOrder;
}

interface Props {
  data: ProductionContractPrintData;
}

function money(value: number, currency: string) {
  return `${Number(value || 0).toFixed(2)} ${currency}`;
}

export default function ProductionContractPrintTemplate({ data }: Props) {
  const { t, formatDate } = useI18n();
  const { order, companyName } = data;
  const contract = order.contract;

  return (
    <div className="mx-auto w-[210mm] bg-white p-10 font-sans text-black">
      <header className="mb-6 border-b-2 border-slate-900 pb-4 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{t("production.contract.formalTitle")}</p>
        <h1 className="mt-1 text-2xl font-bold">{companyName}</h1>
        <p className="mt-1 text-sm">{t("production.contract.documentTitle")}</p>
        <p className="mt-2 text-sm">
          <strong>{t("production.contract.contractNo")}:</strong> {contract?.contract_no || order.order_no}
          {" · "}
          <strong>{t("common.date")}:</strong> {formatDate(contract?.contract_date || order.created_at)}
        </p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">{t("production.contract.companyParty")}</p>
          <p className="font-bold">{companyName}</p>
        </div>
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">{t("production.contract.customerParty")}</p>
          <p className="font-bold">{order.customer_name || t("common.anonymousCustomer")}</p>
        </div>
      </section>

      <section className="mb-5 text-sm">
        <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-bold uppercase">
          {t("production.contract.projectSummary")}
        </h2>
        <p>
          <strong>{t("production.projectName")}:</strong> {order.project_name}
        </p>
        <p>
          <strong>{t("production.expectedDelivery")}:</strong> {formatDate(order.expected_delivery_date) || "-"}
        </p>
        <p className="mt-2 whitespace-pre-wrap">
          <strong>{t("production.projectScope")}:</strong>
          {"\n"}
          {order.project_scope || "-"}
        </p>
      </section>

      <section className="mb-5 text-sm">
        <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-bold uppercase">
          {t("production.contract.financials")}
        </h2>
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <td className="border p-2">{t("production.totalProjectPrice")}</td>
              <td className="border p-2 text-right font-semibold">
                {money(order.total_project_price, t("common.currency"))}
              </td>
            </tr>
            <tr>
              <td className="border p-2">{t("production.installationFee")}</td>
              <td className="border p-2 text-right">
                {money(order.installation_fee, t("common.currency"))}
              </td>
            </tr>
            <tr>
              <td className="border p-2">{t("production.advancePayment")}</td>
              <td className="border p-2 text-right">
                {money(order.advance_payment, t("common.currency"))}
              </td>
            </tr>
            <tr className="bg-slate-100">
              <td className="border p-2 font-bold">{t("production.remainingBalance")}</td>
              <td className="border p-2 text-right font-bold">
                {money(order.remaining_balance, t("common.currency"))}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-8 text-sm">
        <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-bold uppercase">
          {t("production.contract.terms")}
        </h2>
        <p className="whitespace-pre-wrap leading-6">{order.terms || "-"}</p>
      </section>

      <section className="mt-12 grid grid-cols-2 gap-10 text-sm">
        <div className="text-center">
          <div className="mb-10 h-16 border-b border-slate-400" />
          <p className="font-bold">{t("production.contract.customerSignature")}</p>
          <p className="text-xs text-slate-500">{t("production.contract.customerAcceptance")}</p>
        </div>
        <div className="text-center">
          <div className="mb-10 h-16 border-b border-slate-400" />
          <p className="font-bold">{t("production.contract.companySignature")}</p>
          <p className="text-xs text-slate-500">{t("production.contract.companyManagement")}</p>
        </div>
      </section>
    </div>
  );
}
