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

function paymentStatusTone(status: InvoicePrintData["paymentStatus"]): string {
  if (status === "paid") return "invoice-print-status-paid";
  if (status === "partial") return "invoice-print-status-partial";
  return "invoice-print-status-debt";
}

function AccessoryRow({ line, index }: { line: InvoicePrintLine; index: number }) {
  const rowClass = index % 2 === 0 ? "invoice-print-row-even" : "invoice-print-row-odd";
  return (
    <tr className={`invoice-print-row ${rowClass}`}>
      <td className="invoice-print-cell invoice-print-cell-no">{index}</td>
      <td className="invoice-print-cell">
        <div className="invoice-print-product-name">{line.productName}</div>
        {line.productCode ? (
          <div className="invoice-print-product-code">{line.productCode}</div>
        ) : null}
      </td>
      <td className="invoice-print-cell invoice-print-cell-center">
        {line.packaging || line.unit}
      </td>
      <td className="invoice-print-cell invoice-print-cell-num">
        {line.unitPrice.toFixed(2)}
      </td>
      <td className="invoice-print-cell invoice-print-cell-num invoice-print-cell-strong">
        {line.lineTotal.toFixed(2)}
      </td>
    </tr>
  );
}

function ServiceRow({ line, index }: { line: InvoicePrintLine; index: number }) {
  const rowClass = index % 2 === 0 ? "invoice-print-row-even" : "invoice-print-row-odd";
  return (
    <tr className={`invoice-print-row ${rowClass}`}>
      <td className="invoice-print-cell invoice-print-cell-no">{index}</td>
      <td className="invoice-print-cell invoice-print-product-name">{line.productName}</td>
      <td className="invoice-print-cell">{line.description || "—"}</td>
      <td className="invoice-print-cell invoice-print-cell-num">{line.quantity}</td>
      <td className="invoice-print-cell invoice-print-cell-num">
        {line.unitPrice.toFixed(2)}
      </td>
      <td className="invoice-print-cell invoice-print-cell-num invoice-print-cell-strong">
        {line.lineTotal.toFixed(2)}
      </td>
    </tr>
  );
}

function DimensionalRow({ line, index }: { line: InvoicePrintLine; index: number }) {
  const rowClass = index % 2 === 0 ? "invoice-print-row-even" : "invoice-print-row-odd";
  return (
    <tr className={`invoice-print-row ${rowClass}`}>
      <td className="invoice-print-cell invoice-print-cell-no">{index}</td>
      <td className="invoice-print-cell">
        <div className="invoice-print-product-name">{line.productName}</div>
        {line.productCode ? (
          <div className="invoice-print-product-code">{line.productCode}</div>
        ) : null}
      </td>
      <td className="invoice-print-cell invoice-print-cell-center">
        {line.saleTypeLabel || "—"}
      </td>
      <td className="invoice-print-cell invoice-print-cell-num">
        {line.lengthM != null ? line.lengthM.toFixed(2) : "—"}
      </td>
      <td className="invoice-print-cell invoice-print-cell-num">
        {line.pieceCount ?? line.quantity}
      </td>
      <td className="invoice-print-cell invoice-print-cell-num">
        {line.totalMeterage != null ? line.totalMeterage.toFixed(2) : "—"}
      </td>
      <td className="invoice-print-cell invoice-print-cell-num">
        {line.unitPrice.toFixed(2)}
      </td>
      <td className="invoice-print-cell invoice-print-cell-num invoice-print-cell-strong">
        {line.lineTotal.toFixed(2)}
      </td>
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

  const renderDimensionalSection = (lines: InvoicePrintLine[]) => {
    if (lines.length === 0) return null;
    return (
      <section className="invoice-print-section">
        <h2 className="invoice-print-section-title">{t("print.sections.dimensional")}</h2>
        <table className="invoice-print-table">
          <thead>
            <tr>
              <th className="invoice-print-th">{t("print.rowNo")}</th>
              <th className="invoice-print-th">{t("print.cols.productName")}</th>
              <th className="invoice-print-th">{t("print.cols.type")}</th>
              <th className="invoice-print-th">{t("print.cols.lengthM")}</th>
              <th className="invoice-print-th">{t("print.cols.count")}</th>
              <th className="invoice-print-th">{t("print.cols.totalMeterage")}</th>
              <th className="invoice-print-th">{t("print.price")}</th>
              <th className="invoice-print-th">{t("print.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              rowCounter += 1;
              return <DimensionalRow key={`d-${rowCounter}`} line={line} index={rowCounter} />;
            })}
          </tbody>
        </table>
      </section>
    );
  };

  const renderAccessorySection = (lines: InvoicePrintLine[]) => {
    if (lines.length === 0) return null;
    return (
      <section className="invoice-print-section">
        <h2 className="invoice-print-section-title">{t("print.sections.accessory")}</h2>
        <table className="invoice-print-table">
          <thead>
            <tr>
              <th className="invoice-print-th">{t("print.rowNo")}</th>
              <th className="invoice-print-th">{t("print.cols.productName")}</th>
              <th className="invoice-print-th">{t("print.cols.packaging")}</th>
              <th className="invoice-print-th">{t("print.price")}</th>
              <th className="invoice-print-th">{t("print.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              rowCounter += 1;
              return <AccessoryRow key={`a-${rowCounter}`} line={line} index={rowCounter} />;
            })}
          </tbody>
        </table>
      </section>
    );
  };

  const renderServiceSection = (lines: InvoicePrintLine[]) => {
    if (lines.length === 0) return null;
    return (
      <section className="invoice-print-section">
        <h2 className="invoice-print-section-title">{t("print.sections.service")}</h2>
        <table className="invoice-print-table">
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
            {lines.map((line) => {
              rowCounter += 1;
              return <ServiceRow key={`s-${rowCounter}`} line={line} index={rowCounter} />;
            })}
          </tbody>
        </table>
      </section>
    );
  };

  return (
    <div className="invoice-print-layout">
      {isOfficial ? (
        <header className="invoice-print-header-official">
          <div className="invoice-print-header-grid">
            <div className="invoice-print-brand-block">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt=""
                  className="invoice-print-logo"
                />
              ) : (
                <div className="invoice-print-logo-fallback">DG</div>
              )}
              <div>
                <h1 className="invoice-print-company-name">{branding.companyName}</h1>
                {branding.voen ? (
                  <p className="invoice-print-brand-meta">
                    <span>{t("print.voen")}:</span> {branding.voen}
                  </p>
                ) : null}
                {branding.address ? (
                  <p className="invoice-print-brand-meta">{branding.address}</p>
                ) : null}
                {branding.phone || branding.email ? (
                  <p className="invoice-print-brand-meta">
                    {[branding.phone, branding.email].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="invoice-print-doc-block">
              <div className="invoice-print-official-badge">{t("print.officialInvoiceTitle")}</div>
              <p className="invoice-print-doc-line">
                <span>{t("print.docNo")}</span>
                <strong>{data.docNo}</strong>
              </p>
              <p className="invoice-print-doc-line">
                <span>{t("common.date")}</span>
                <strong>{data.docDate}</strong>
              </p>
              <p className="invoice-print-doc-line">
                <span>{t("print.paymentStatus.label")}</span>
                <strong className={paymentStatusTone(data.paymentStatus)}>
                  {paymentStatusLabel(data.paymentStatus, t)}
                </strong>
              </p>
            </div>
          </div>
          {(branding.bankName || branding.iban) && (
            <p className="invoice-print-bank-line">
              {branding.bankName ? branding.bankName : ""}
              {branding.iban ? ` · IBAN: ${branding.iban}` : ""}
            </p>
          )}
        </header>
      ) : (
        <header className="invoice-print-header-unofficial">
          <div className="invoice-print-unofficial-grid">
            <h1 className="invoice-print-unofficial-title">{t("print.unofficialTitle")}</h1>
            <div className="invoice-print-unofficial-meta">
              <p>
                <span>{t("print.docNo")}</span> <strong>{data.docNo}</strong>
              </p>
              <p>
                <span>{t("common.date")}</span> <strong>{data.docDate}</strong>
              </p>
              <p>
                <span>{t("print.paymentStatus.label")}</span>{" "}
                <strong className={paymentStatusTone(data.paymentStatus)}>
                  {paymentStatusLabel(data.paymentStatus, t)}
                </strong>
              </p>
            </div>
          </div>
        </header>
      )}

      <section className="invoice-print-meta-card">
        <div className="invoice-print-meta-grid">
          <div className="invoice-print-meta-item">
            <p className="invoice-print-meta-label">{t("sales.customer")}</p>
            <p className="invoice-print-meta-value">{data.customerName}</p>
          </div>
          <div className="invoice-print-meta-item">
            <p className="invoice-print-meta-label">{t("print.salesManager")}</p>
            <p className="invoice-print-meta-value">{data.sellerName}</p>
          </div>
          <div className="invoice-print-meta-item">
            <p className="invoice-print-meta-label">{t("sales.warehouse")}</p>
            <p className="invoice-print-meta-value">{data.warehouseName}</p>
          </div>
          <div className="invoice-print-meta-item">
            <p className="invoice-print-meta-label">{t("print.paymentStatus.label")}</p>
            <p className={`invoice-print-meta-value ${paymentStatusTone(data.paymentStatus)}`}>
              {paymentStatusLabel(data.paymentStatus, t)}
            </p>
          </div>
        </div>
      </section>

      {renderDimensionalSection(dimensionalLines)}
      {renderAccessorySection(accessoryLines)}
      {renderServiceSection(serviceLines)}

      <section className="invoice-print-totals-wrap">
        <div className="invoice-print-totals-box">
          <div className="invoice-print-total-row">
            <span>{t("print.totals.subtotal")}</span>
            <span className="invoice-print-total-value">
              {formatMoney(data.subtotal, data.currency)}
            </span>
          </div>
          {isOfficial && data.vatTotal > 0 ? (
            <div className="invoice-print-total-row">
              <span>{t("print.totals.vat")}</span>
              <span className="invoice-print-total-value">
                {formatMoney(data.vatTotal, data.currency)}
              </span>
            </div>
          ) : null}
          {data.discountTotal > 0 ? (
            <div className="invoice-print-total-row">
              <span>{t("print.totals.discount")}</span>
              <span className="invoice-print-total-value invoice-print-total-discount">
                -{formatMoney(data.discountTotal, data.currency)}
              </span>
            </div>
          ) : null}
          {data.additionalExpenses > 0 ? (
            <div className="invoice-print-total-row">
              <span>{t("print.totals.additionalExpenses")}</span>
              <span className="invoice-print-total-value">
                {formatMoney(data.additionalExpenses, data.currency)}
              </span>
            </div>
          ) : null}
          <div className="invoice-print-total-row invoice-print-grand-total">
            <span>{t("print.totals.grandTotal")}</span>
            <span className="invoice-print-total-value">
              {formatMoney(data.grandTotal, data.currency)}
            </span>
          </div>
          <div className="invoice-print-total-row">
            <span>{t("print.paidAmount")}</span>
            <span className="invoice-print-total-value">
              {formatMoney(data.paidAmount, data.currency)}
            </span>
          </div>
          <div className="invoice-print-total-row invoice-print-balance-due">
            <span>{t("print.remainingDebt")}</span>
            <span className="invoice-print-total-value">
              {formatMoney(data.remainingBalance, data.currency)}
            </span>
          </div>
        </div>
      </section>

      {data.notes ? (
        <p className="invoice-print-notes">
          <strong>{t("common.notes")}:</strong> {data.notes}
        </p>
      ) : null}

      <footer className="invoice-print-footer">
        <div className="invoice-print-signature-grid">
          <div className="invoice-print-signature-block">
            <p className="invoice-print-signature-title">{t("print.signatures.handedOver")}</p>
            <div className="invoice-print-signature-line" />
            <p className="invoice-print-signature-caption">{t("print.signatures.signature")}</p>
          </div>
          <div className="invoice-print-signature-block">
            <p className="invoice-print-signature-title">{t("print.signatures.receivedBy")}</p>
            <div className="invoice-print-signature-line" />
            <p className="invoice-print-signature-caption">{t("print.signatures.signature")}</p>
          </div>
        </div>
        {isOfficial ? (
          <div className="invoice-print-stamp-area">
            <div className="invoice-print-stamp-circle">{t("print.stampArea")}</div>
          </div>
        ) : null}
      </footer>
    </div>
  );
}
