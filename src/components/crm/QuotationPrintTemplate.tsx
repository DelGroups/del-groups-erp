"use client";

import React from "react";
import type { CompanyBranding } from "@/lib/print/types";
import type { CrmConfig } from "@/lib/crm/config";
import type { CrmDeal, CrmQuotation } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

export interface QuotationPrintData {
  quotation: CrmQuotation;
  deal: CrmDeal;
  branding: CompanyBranding;
  crmConfig?: CrmConfig;
}

function money(value: number, currency: string) {
  return `${Number(value || 0).toFixed(2)} ${currency}`;
}

export default function QuotationPrintTemplate({ data }: { data: QuotationPrintData }) {
  const { t, formatDate } = useI18n();
  const { quotation, deal, branding, crmConfig } = data;
  const customerName =
    deal.customers?.full_name || deal.customers?.company_name || t("crm.unnamedClient");
  const subtotal = quotation.items_json.reduce((sum, item) => sum + item.line_total, 0);
  const terms = crmConfig?.terms_and_conditions?.trim() || "";
  const showBank = Boolean(crmConfig?.show_bank_details_on_quote);
  const sealUrl = crmConfig?.company_seal_signature_url || null;

  return (
    <div className="mx-auto w-[210mm] bg-white p-10 font-sans text-black">
      <header className="mb-6 border-b-2 border-slate-900 pb-4 text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
          {t("crm.print.title")}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{branding.companyName}</h1>
        {branding.voen && (
          <p className="mt-1 text-sm">
            <strong>{t("official.voenLabel")}:</strong> {branding.voen}
          </p>
        )}
        {branding.address && <p className="text-sm text-slate-600">{branding.address}</p>}
        <p className="mt-3 text-sm">
          <strong>{t("crm.print.quoteNo")}:</strong> {quotation.quote_number}
          {" · "}
          <strong>{t("crm.print.validUntil")}:</strong>{" "}
          {quotation.valid_until ? formatDate(quotation.valid_until) : "—"}
        </p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">{t("crm.print.from")}</p>
          <p className="font-bold">{branding.companyName}</p>
          {branding.phone && <p className="text-xs text-slate-600">{branding.phone}</p>}
        </div>
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">{t("crm.print.to")}</p>
          <p className="font-bold">{customerName}</p>
          <p className="mt-1 text-xs text-slate-600">{deal.title}</p>
        </div>
      </section>

      <table className="mb-5 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100 text-left text-xs uppercase">
            <th className="border border-slate-300 px-2 py-2">{t("crm.print.item")}</th>
            <th className="border border-slate-300 px-2 py-2 text-right">{t("crm.print.qty")}</th>
            <th className="border border-slate-300 px-2 py-2 text-right">{t("crm.print.unitPrice")}</th>
            <th className="border border-slate-300 px-2 py-2 text-right">{t("crm.print.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {quotation.items_json.map((item, idx) => (
            <tr key={`${item.product_name}-${idx}`}>
              <td className="border border-slate-300 px-2 py-2">
                <p className="font-semibold">{item.product_name}</p>
                {item.product_code && (
                  <p className="text-[11px] text-slate-500">{item.product_code}</p>
                )}
              </td>
              <td className="border border-slate-300 px-2 py-2 text-right font-mono">
                {item.quantity} {item.unit}
              </td>
              <td className="border border-slate-300 px-2 py-2 text-right font-mono">
                {money(item.unit_price, t("common.currency"))}
              </td>
              <td className="border border-slate-300 px-2 py-2 text-right font-mono font-bold">
                {money(item.line_total, t("common.currency"))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto w-64 space-y-1 text-sm">
        <Row label={t("crm.print.subtotal")} value={money(subtotal, t("common.currency"))} />
        <Row label={t("crm.print.discount")} value={money(quotation.discount, t("common.currency"))} />
        <Row label={t("crm.print.tax")} value={money(quotation.tax, t("common.currency"))} />
        <Row
          label={t("crm.print.total")}
          value={money(quotation.total_amount, t("common.currency"))}
          bold
        />
      </div>

      {quotation.notes && (
        <p className="mt-6 whitespace-pre-wrap text-sm text-slate-600">
          <strong>{t("common.notes")}:</strong> {quotation.notes}
        </p>
      )}

      {terms ? (
        <section className="mt-6 rounded border border-slate-300 p-3 text-sm text-slate-700">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
            {t("crm.print.terms")}
          </p>
          <p className="whitespace-pre-wrap">{terms}</p>
        </section>
      ) : null}

      {showBank && (branding.bankName || branding.iban) ? (
        <section className="mt-4 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase text-slate-500">
            {t("crm.print.bankDetails")}
          </p>
          {branding.bankName ? <p>{branding.bankName}</p> : null}
          {branding.iban ? <p className="font-mono">{branding.iban}</p> : null}
        </section>
      ) : null}

      <div className="mt-10 flex items-end justify-between gap-6">
        <p className="text-center text-xs text-slate-500">{t("crm.print.footer")}</p>
        {sealUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sealUrl} alt="" className="h-24 w-24 object-contain" />
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t border-slate-400 pt-1 font-bold" : ""}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
