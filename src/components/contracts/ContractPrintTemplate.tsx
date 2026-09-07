"use client";

import React from "react";
import {
  getContractStatusLabel,
  getContractTypeLabel,
  type Contract,
} from "@/lib/contracts/api";
import type { CompanyBranding } from "@/lib/print/types";
import { useI18n } from "@/i18n/I18nProvider";

export interface ContractPrintData {
  contract: Contract;
  branding: CompanyBranding;
}

interface Props {
  data: ContractPrintData;
}

function displayText(value: string | null | undefined, fallback = "—") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function money(value: number | null | undefined, currency: string) {
  if (value == null) return "—";
  return `${Number(value).toFixed(2)} ${currency}`;
}

export default function ContractPrintTemplate({ data }: Props) {
  const { t, formatDate } = useI18n();
  const { contract, branding } = data;
  const advanceAmount =
    contract.total_amount != null && contract.advance_percentage != null
      ? contract.total_amount * (contract.advance_percentage / 100)
      : null;

  return (
    <div className="mx-auto w-[210mm] bg-white p-10 font-sans text-black">
      <header className="mb-6 border-b-2 border-slate-900 pb-4 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
          {t("official.contractPrintTitle")}
        </p>
        <h1 className="mt-1 text-2xl font-bold">{displayText(branding.companyName)}</h1>
        {branding.voen && (
          <p className="mt-1 text-sm">
            <strong>{t("official.voenLabel")}:</strong> {branding.voen}
          </p>
        )}
        {branding.address && <p className="text-sm text-slate-600">{branding.address}</p>}
        <p className="mt-3 text-sm">
          <strong>{t("official.contractNumber")}:</strong> {contract.contract_number}
          {" · "}
          <strong>{t("official.contractDate")}:</strong>{" "}
          {contract.contract_date ? formatDate(contract.contract_date) : "—"}
        </p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            {t("official.companyParty")}
          </p>
          <p className="font-bold">{displayText(branding.companyName)}</p>
        </div>
        <div className="rounded border border-slate-300 p-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            {t("official.party")}
          </p>
          <p className="font-bold">{displayText(contract.party_name)}</p>
          {contract.voen && (
            <p className="mt-1 text-xs text-slate-600">
              {t("official.voenLabel")}: {contract.voen}
            </p>
          )}
        </div>
      </section>

      <section className="mb-5 text-sm">
        <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-bold uppercase">
          {t("official.contractDetails")}
        </h2>
        <p>
          <strong>{t("official.contractTitle")}:</strong> {displayText(contract.title)}
        </p>
        <p>
          <strong>{t("official.contractType")}:</strong>{" "}
          {getContractTypeLabel(contract.type, t)}
        </p>
        <p>
          <strong>{t("official.expiryDate")}:</strong>{" "}
          {contract.expiry_date ? formatDate(contract.expiry_date) : "—"}
        </p>
        <p>
          <strong>{t("common.status")}:</strong>{" "}
          {getContractStatusLabel(contract.status, t)}
        </p>
      </section>

      <section className="mb-5 text-sm">
        <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-bold uppercase">
          {t("official.paymentTerms")}
        </h2>
        <table className="w-full border-collapse">
          <tbody>
            <tr>
              <td className="border p-2">{t("official.contractAmount")}</td>
              <td className="border p-2 text-right font-semibold">
                {money(contract.total_amount, t("common.currency"))}
              </td>
            </tr>
            <tr>
              <td className="border p-2">{t("official.advancePercentage")}</td>
              <td className="border p-2 text-right">
                {contract.advance_percentage != null
                  ? `${contract.advance_percentage}%`
                  : "—"}
              </td>
            </tr>
            <tr>
              <td className="border p-2">{t("official.advanceAmount")}</td>
              <td className="border p-2 text-right font-semibold">
                {money(advanceAmount, t("common.currency"))}
              </td>
            </tr>
            <tr>
              <td className="border p-2">{t("official.paymentStages")}</td>
              <td className="border p-2 text-right">
                {contract.payment_stages ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
        {contract.payment_terms_notes && (
          <p className="mt-3 whitespace-pre-wrap leading-6">
            <strong>{t("official.paymentTermsNotes")}:</strong>
            {"\n"}
            {contract.payment_terms_notes}
          </p>
        )}
      </section>

      <section className="mt-12 grid grid-cols-2 gap-10 text-sm">
        <div className="text-center">
          <div className="mb-10 h-16 border-b border-slate-400" />
          <p className="font-bold">{t("official.partySignature")}</p>
          <p className="text-xs text-slate-500">{displayText(contract.party_name)}</p>
        </div>
        <div className="text-center">
          <div className="mb-10 h-16 border-b border-slate-400" />
          <p className="font-bold">{t("official.companySignature")}</p>
          <p className="text-xs text-slate-500">{t("official.stampPlaceholder")}</p>
        </div>
      </section>
    </div>
  );
}
