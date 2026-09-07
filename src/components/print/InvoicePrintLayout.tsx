"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type {
  CompanyBranding,
  InvoicePrintData,
  InvoicePrintLine,
  PrintMode,
} from "@/lib/print/types";

interface InvoicePrintLayoutProps {
  data: InvoicePrintData;
  mode: PrintMode;
  branding: CompanyBranding;
}

function formatMoney(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function paymentStatusLabel(
  status: InvoicePrintData["paymentStatus"],
  t: (key: string) => string
): string {
  if (status === "paid") return t("print.paymentStatus.paid");
  if (status === "partial") return t("print.paymentStatus.partial");
  return t("print.paymentStatus.debt");
}

function DimensionalRow({
  line,
  index,
  t,
}: {
  line: InvoicePrintLine;
  index: number;
  t: (key: string) => string;
}) {
  return (
    <tr className="invoice-print-row">
      <td className="invoice-print-cell">{index}</td>
      <td className="invoice-print-cell">
        <div className="font-semibold">{line.productName}</div>
        {line.productCode ? <div className="text-[10px] text-gray-600">{line.productCode}</div> : null}
      </td>
      <td className="invoice-print-cell text-center">{line.saleTypeLabel || "-"}</td>
      <td className="invoice-print-cell text-right">
        {line.lengthM != null ? line.lengthM.toFixed(2) : "—"}
      </td>
      <td className="invoice-print-cell text-right">{line.pieceCount ?? line.quantity}</td>
      <td className="invoice-print-cell text-right">
        {line.totalMeterage != null ? line.totalMeterage.toFixed(2) : "—"}
      </td>
      <td className="invoice-print-cell text-right">{line.unitPrice.toFixed(2)}</td>
      <td className="invoice-print-cell text-right font-semibold">{line.lineTotal.toFixed(2)}</td>
    </tr>
  );
}

function AccessoryRow({
  line,
  index,
  t,
}: {
  line: InvoicePrintLine;
  index: number;
  t: (key: string) => string;
}) {
  return (
    <tr className="invoice-print-row">
      <td className="invoice-print-cell">{index}</td>
      <td className="invoice-print-cell">
        <div className="font-semibold">{line.productName}</div>
        {line.productCode ? <div className="text-[10px] text-gray-600">{line.productCode}</div> : null}
      </td>
      <td className="invoice-print-cell text-center">{line.packaging || line.unit}</td>
      <td className="invoice-print-cell text-right">{line.unitPrice.toFixed(2)}</td>
      <td className="invoice-print-cell text-right font-semibold">{line.lineTotal.toFixed(2)}</td>
    </tr>
  );
}

function ServiceRow({
  line,
  index,
}: {
  line: InvoicePrintLine;
  index: number;
}) {
  return (
    <tr className="invoice-print-row">
      <td className="invoice-print-cell">{index}</td>
      <td className="invoice-print-cell font-semibold">{line.productName}</td>
      <td className="invoice-print-cell">{line.description || "—"}</td>
      <td className="invoice-print-cell text-right">{line.quantity}</td>
      <td className="invoice-print-cell text-right">{line.unitPrice.toFixed(2)}</td>
      <td className="invoice-print-cell text-right font-semibold">{line.lineTotal.toFixed(2)}</td>
    </tr>
  );
}

export default function InvoicePrintLayout({ data, mode, branding }: InvoicePrintLayoutProps) {
  const { t } = useI18n();
  const isOfficial = mode === "official";

  const dimensionalLines = data.lines.filter((line) => line.kind === "dimensional");
  const accessoryLines = data.lines.filter(
    (line) => line.kind === "accessory" || line.kind === "standard"
  );
  const serviceLines = data.lines.filter((line) => line.kind === "service");

  let rowCounter = 0;

  return (
    <div className="invoice-print-layout mx-auto w-[210mm] bg-white p-[12mm] font-sans text-[11px] leading-snug text-black">
      {isOfficial ? (
        <header className="mb-6 border-b-2 border-black pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt=""
                  className="h-16 w-16 object-contain"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center border border-black text-[10px] font-bold">
                  LOGO
                </div>
              )}
              <div>
                <h1 className="text-lg font-bold uppercase tracking-wide">{branding.companyName}</h1>
                {branding.voen ? (
                  <p>
                    <strong>{t("print.voen")}:</strong> {branding.voen}
                  </p>
                ) : null}
                {branding.address ? <p>{branding.address}</p> : null}
                {branding.phone ? (
                  <p>
                    <strong>{t("common.phone")}:</strong> {branding.phone}
                  </p>
                ) : null}
                {branding.email ? <p>{branding.email}</p> : null}
              </div>
            </div>
            <div className="text-right text-xs">
              <p className="text-sm font-bold uppercase">{t("print.salesInvoice")}</p>
              <p>
                <strong>{t("print.docNo")}:</strong> {data.docNo}
              </p>
              <p>
                <strong>{t("common.date")}:</strong> {data.docDate}
              </p>
            </div>
          </div>
          {(branding.bankName || branding.iban) && (
            <p className="mt-3 text-[10px]">
              {branding.bankName ? `${branding.bankName}` : ""}
              {branding.iban ? ` · IBAN: ${branding.iban}` : ""}
            </p>
          )}
        </header>
      ) : (
        <header className="mb-6 border-b border-black pb-3">
          <div className="flex items-end justify-between">
            <h1 className="text-xl font-bold tracking-wide">{t("print.unofficialTitle")}</h1>
            <div className="text-right text-xs">
              <p>
                <strong>{t("print.docNo")}:</strong> {data.docNo}
              </p>
              <p>
                <strong>{t("common.date")}:</strong> {data.docDate}
              </p>
            </div>
          </div>
        </header>
      )}

      <section className="mb-5 grid grid-cols-2 gap-3 rounded border border-black p-3 text-xs">
        <div>
          <p className="text-[10px] uppercase text-gray-600">{t("sales.customer")}</p>
          <p className="font-bold">{data.customerName}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-gray-600">{t("modals.salesView.seller")}</p>
          <p className="font-bold">{data.sellerName}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-gray-600">{t("sales.warehouse")}</p>
          <p className="font-bold">{data.warehouseName}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-gray-600">{t("print.paymentStatus.label")}</p>
          <p className="font-bold">{paymentStatusLabel(data.paymentStatus, t)}</p>
        </div>
      </section>

      {dimensionalLines.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 text-xs font-bold uppercase">{t("print.sections.dimensional")}</h2>
          <table className="invoice-print-table w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="invoice-print-th">{t("print.rowNo")}</th>
                <th className="invoice-print-th">{t("print.cols.productCodeName")}</th>
                <th className="invoice-print-th">{t("print.cols.type")}</th>
                <th className="invoice-print-th">{t("print.cols.lengthM")}</th>
                <th className="invoice-print-th">{t("print.cols.count")}</th>
                <th className="invoice-print-th">{t("print.cols.totalMeterage")}</th>
                <th className="invoice-print-th">{t("print.price")}</th>
                <th className="invoice-print-th">{t("print.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {dimensionalLines.map((line) => {
                rowCounter += 1;
                return <DimensionalRow key={`d-${rowCounter}`} line={line} index={rowCounter} t={t} />;
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {accessoryLines.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 text-xs font-bold uppercase">{t("print.sections.accessory")}</h2>
          <table className="invoice-print-table w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="invoice-print-th">{t("print.rowNo")}</th>
                <th className="invoice-print-th">{t("print.cols.productCodeName")}</th>
                <th className="invoice-print-th">{t("print.cols.packaging")}</th>
                <th className="invoice-print-th">{t("print.price")}</th>
                <th className="invoice-print-th">{t("print.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {accessoryLines.map((line) => {
                rowCounter += 1;
                return <AccessoryRow key={`a-${rowCounter}`} line={line} index={rowCounter} t={t} />;
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {serviceLines.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 text-xs font-bold uppercase">{t("print.sections.service")}</h2>
          <table className="invoice-print-table w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="invoice-print-th">{t("print.rowNo")}</th>
                <th className="invoice-print-th">{t("print.cols.serviceName")}</th>
                <th className="invoice-print-th">{t("print.cols.description")}</th>
                <th className="invoice-print-th">{t("print.quantity")}</th>
                <th className="invoice-print-th">{t("print.price")}</th>
                <th className="invoice-print-th">{t("print.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {serviceLines.map((line) => {
                rowCounter += 1;
                return <ServiceRow key={`s-${rowCounter}`} line={line} index={rowCounter} />;
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="mb-8 ml-auto w-full max-w-sm space-y-1 text-xs">
        <div className="flex justify-between border-b border-gray-300 py-1">
          <span>{t("print.totals.subtotal")}</span>
          <span className="font-mono font-semibold">{formatMoney(data.subtotal, data.currency)}</span>
        </div>
        {data.additionalExpenses > 0 ? (
          <div className="flex justify-between border-b border-gray-300 py-1">
            <span>{t("print.totals.additionalExpenses")}</span>
            <span className="font-mono font-semibold">
              {formatMoney(data.additionalExpenses, data.currency)}
            </span>
          </div>
        ) : null}
        {data.discountTotal > 0 ? (
          <div className="flex justify-between border-b border-gray-300 py-1">
            <span>{t("print.totals.discount")}</span>
            <span className="font-mono font-semibold">
              -{formatMoney(data.discountTotal, data.currency)}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between border-b-2 border-black py-2 text-sm font-bold">
          <span>{t("print.totals.grandTotal")}</span>
          <span className="font-mono">{formatMoney(data.grandTotal, data.currency)}</span>
        </div>
        <div className="flex justify-between py-1">
          <span>{t("print.paid")}</span>
          <span className="font-mono font-semibold">{formatMoney(data.paidAmount, data.currency)}</span>
        </div>
        <div className="flex justify-between py-1 font-bold text-rose-800">
          <span>{t("print.remainingDebt")}</span>
          <span className="font-mono">{formatMoney(data.remainingBalance, data.currency)}</span>
        </div>
      </section>

      {data.notes ? (
        <p className="mb-6 text-[10px]">
          <strong>{t("common.notes")}:</strong> {data.notes}
        </p>
      ) : null}

      <footer className="mt-10 grid grid-cols-2 gap-8 text-xs">
        <div>
          <p className="mb-8 font-bold">{t("print.signatures.handedOver")}</p>
          <div className="border-t border-black pt-1">{t("print.signatures.signature")}</div>
        </div>
        <div>
          <p className="mb-8 font-bold">{t("print.signatures.receivedBy")}</p>
          <div className="border-t border-black pt-1">{t("print.signatures.signature")}</div>
        </div>
        {isOfficial ? (
          <div className="col-span-2 mt-4 rounded border border-dashed border-black p-6 text-center text-[10px] uppercase tracking-widest text-gray-500">
            {t("print.stampArea")}
          </div>
        ) : null}
      </footer>
    </div>
  );
}
