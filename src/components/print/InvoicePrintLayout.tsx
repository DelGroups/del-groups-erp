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

const INK = "#0f172a";
const HEADER_TEXT = "#0f172a";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";
const CARD_BG = "#f8fafc";
const HEADER_BG = "#f8fafc";
const TH_BG = "#f1f5f9";
const TH_BORDER = "#cbd5e1";
const SUMMARY_BG = "#f1f5f9";
const SUMMARY_BORDER = "#cbd5e1";
const ACCENT_BORDER = "#cbd5e1";
const PAID_GREEN = "#16a34a";
const BALANCE_RED = "#dc2626";
const WHITE = "#ffffff";

const FONT =
  'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

const PRINT_STYLE = `
  @media print {
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { background-color: #ffffff !important; }
    .invoice-print-layout { background-color: #ffffff !important; }
    .invoice-print-th {
      background-color: ${TH_BG} !important;
      color: ${HEADER_TEXT} !important;
    }
    .invoice-print-row-even { background-color: ${WHITE} !important; }
    .invoice-print-row-odd { background-color: ${CARD_BG} !important; }
    .invoice-print-info-card {
      background-color: ${CARD_BG} !important;
      border: 1px solid ${BORDER} !important;
    }
    .invoice-print-summary {
      background-color: ${SUMMARY_BG} !important;
      border: 1px solid ${SUMMARY_BORDER} !important;
    }
    .invoice-print-header {
      background-color: ${HEADER_BG} !important;
      border: 2px solid ${ACCENT_BORDER} !important;
    }
    .invoice-print-badge {
      background-color: ${TH_BG} !important;
      color: ${INK} !important;
      border: 1px solid ${ACCENT_BORDER} !important;
    }
    .invoice-print-doc-pill {
      background-color: ${TH_BG} !important;
      color: ${INK} !important;
      border: 1px solid ${ACCENT_BORDER} !important;
    }
  }
`;

function formatMoney(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function formatPrice(value: number): string {
  return value.toFixed(2);
}

const thStyle: React.CSSProperties = {
  backgroundColor: TH_BG,
  color: HEADER_TEXT,
  padding: "10px 12px",
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  border: `1px solid ${TH_BORDER}`,
  verticalAlign: "middle",
};

function rowBackground(index: number): string {
  return index % 2 === 0 ? WHITE : CARD_BG;
}

function cellStyle(index: number, align: "left" | "center" | "right" = "left"): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderBottom: `1px solid ${BORDER}`,
    color: INK,
    fontSize: "13px",
    verticalAlign: "top",
    textAlign: align,
    backgroundColor: rowBackground(index),
    fontVariantNumeric: align === "right" ? "tabular-nums" : undefined,
  };
}

function MetaLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "11px", color: SLATE, lineHeight: 1.45, marginTop: "2px" }}>
      {children}
    </div>
  );
}

function renderSizeType(
  line: InvoicePrintLine,
  t: (key: string, vars?: Record<string, string | number>) => string
): React.ReactNode {
  if (line.kind === "dimensional") {
    if (line.saleTypeLabel === "Tam") {
      return t("print.cols.fullSheet");
    }
    if (line.saleTypeLabel) {
      return line.saleTypeLabel;
    }
    return "—";
  }

  if (line.kind === "service") {
    return line.description?.trim() || t("print.cols.serviceType");
  }

  const value = line.packaging || line.unit;
  return value?.trim() ? value : "—";
}

function renderQuantityUnit(
  line: InvoicePrintLine,
  t: (key: string, vars?: Record<string, string | number>) => string
): React.ReactNode {
  if (line.kind === "dimensional") {
    const details: React.ReactNode[] = [];

    if (line.totalMeterage != null && line.totalMeterage > 0) {
      details.push(
        <MetaLine key="meterage">
          {t("print.cols.totalMeterageShort")}: {line.totalMeterage.toFixed(2)} m
        </MetaLine>
      );
    }

    if (line.saleTypeLabel === "Tam" && line.pieceCount != null && line.pieceCount > 0) {
      details.push(
        <MetaLine key="full-sheet">
          {t("print.cols.fullSheet")}: {line.pieceCount}
        </MetaLine>
      );
    }

    if (line.saleTypeLabel === "Kəsim" && line.pieceCount != null && line.pieceCount > 0) {
      details.push(
        <MetaLine key="pieces">
          {t("print.cols.pieceCount")}: {line.pieceCount}
        </MetaLine>
      );
    }

    if (line.lengthM != null && line.lengthM > 0) {
      details.push(
        <MetaLine key="length">
          {t("print.cols.perPieceLength", { length: line.lengthM.toFixed(2) })}
        </MetaLine>
      );
    }

    if (details.length > 0) {
      return <div>{details}</div>;
    }

    const unit = line.unit?.trim() || t("common.units");
    return `${line.quantity} ${unit}`;
  }

  const unit = line.unit?.trim() || t("common.units");
  return `${line.quantity} ${unit}`;
}

function InvoiceItemRow({
  line,
  index,
  t,
}: {
  line: InvoicePrintLine;
  index: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const rowClass = index % 2 === 0 ? "invoice-print-row-even" : "invoice-print-row-odd";

  return (
    <tr className={rowClass} style={{ pageBreakInside: "avoid" }}>
      <td style={{ ...cellStyle(index, "center"), width: "40px", fontWeight: 700 }}>{index}</td>
      <td style={cellStyle(index, "left")}>
        <div style={{ fontWeight: 700, color: INK, lineHeight: 1.35 }}>{line.productName}</div>
        {line.productCode ? (
          <div style={{ fontSize: "11px", color: SLATE, marginTop: "3px", lineHeight: 1.35 }}>
            {line.productCode}
          </div>
        ) : null}
      </td>
      <td style={{ ...cellStyle(index, "center"), width: "110px" }}>{renderSizeType(line, t)}</td>
      <td style={{ ...cellStyle(index, "center"), width: "90px" }}>{renderQuantityUnit(line, t)}</td>
      <td style={{ ...cellStyle(index, "right"), width: "100px" }}>{formatPrice(line.unitPrice)}</td>
      <td style={{ ...cellStyle(index, "right"), width: "110px", fontWeight: 700 }}>
        {formatPrice(line.lineTotal)}
      </td>
    </tr>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="invoice-print-info-card"
      style={{
        flex: 1,
        backgroundColor: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: "8px",
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          fontSize: "9px",
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: SLATE,
        }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function InfoField({ label, value, valueColor = INK }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ marginBottom: "8px" }}>
      <p style={{ margin: 0, fontSize: "9px", fontWeight: 700, color: SLATE, textTransform: "uppercase" }}>{label}</p>
      <p style={{ margin: "2px 0 0", fontSize: "11px", fontWeight: 800, color: valueColor }}>{value}</p>
    </div>
  );
}

export default function InvoicePrintLayout({ data, mode, branding }: InvoicePrintLayoutProps) {
  const { t } = useI18n();
  const isOfficial = data.isOfficial === true || mode === "official";
  const companyName = branding.companyName || "DEL GROUPS MMC";
  const title = t("print.invoiceTitle");

  return (
    <>
      <style>{PRINT_STYLE}</style>
      <div
        className="invoice-print-layout"
        style={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          padding: "10mm 12mm",
          backgroundColor: WHITE,
          color: INK,
          fontFamily: FONT,
          fontSize: "11px",
          lineHeight: 1.45,
          boxSizing: "border-box",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <header
          className="invoice-print-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            marginBottom: "14px",
            padding: "14px 16px",
            backgroundColor: HEADER_BG,
            border: `2px solid ${ACCENT_BORDER}`,
            borderRadius: "8px",
          }}
        >
          {isOfficial ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt=""
                  style={{
                    width: "56px",
                    height: "56px",
                    objectFit: "contain",
                    borderRadius: "10px",
                    backgroundColor: WHITE,
                    border: `2px solid ${ACCENT_BORDER}`,
                    padding: "4px",
                  }}
                />
              ) : (
                <div
                  className="invoice-print-badge"
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "10px",
                    backgroundColor: TH_BG,
                    color: INK,
                    border: `1px solid ${ACCENT_BORDER}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                    fontSize: "14px",
                    letterSpacing: "0.04em",
                  }}
                >
                  DG
                </div>
              )}
              <div>
                <div
                  className="invoice-print-badge"
                  style={{
                    display: "inline-block",
                    backgroundColor: TH_BG,
                    color: INK,
                    border: `1px solid ${ACCENT_BORDER}`,
                    fontSize: "11px",
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    marginBottom: "6px",
                  }}
                >
                  {companyName}
                </div>
                {branding.voen ? (
                  <p style={{ margin: "0 0 2px", fontSize: "10px", color: SLATE }}>
                    <strong>{t("print.voen")}:</strong> {branding.voen}
                  </p>
                ) : null}
                {branding.address ? (
                  <p style={{ margin: 0, fontSize: "10px", color: SLATE }}>{branding.address}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div />
          )}

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <h1
              style={{
                margin: "0 0 8px",
                fontSize: "20px",
                fontWeight: 900,
                letterSpacing: "0.04em",
                color: INK,
                textTransform: "uppercase",
              }}
            >
              {title}
            </h1>
            <span
              className="invoice-print-doc-pill"
              style={{
                display: "inline-block",
                backgroundColor: TH_BG,
                color: INK,
                border: `1px solid ${ACCENT_BORDER}`,
                fontSize: "10px",
                fontWeight: 800,
                padding: "6px 12px",
                borderRadius: "999px",
                letterSpacing: "0.03em",
              }}
            >
              {t("print.docNo")}: {data.docNo}
            </span>
            <p style={{ margin: "8px 0 0", fontSize: "10px", color: SLATE }}>
              <strong style={{ color: INK }}>{t("common.date")}:</strong> {data.docDate}
            </p>
          </div>
        </header>

        <div style={{ display: "flex", gap: "12px", marginBottom: "14px" }}>
          <InfoCard title={t("sales.customer")}>
            <InfoField label={t("sales.customer")} value={data.customerName} />
            <InfoField label={t("print.salesManager")} value={data.sellerName} />
          </InfoCard>
          <InfoCard title={t("print.salesInvoice")}>
            <InfoField label={t("print.docNo")} value={data.docNo} />
            <InfoField label={t("common.date")} value={data.docDate} />
            <InfoField label={t("sales.warehouse")} value={data.warehouseName} />
          </InfoCard>
        </div>

        {data.lines.length > 0 ? (
          <section style={{ marginBottom: "14px" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                tableLayout: "fixed",
                border: `1px solid ${TH_BORDER}`,
              }}
            >
              <colgroup>
                <col style={{ width: "40px" }} />
                <col />
                <col style={{ width: "110px" }} />
                <col style={{ width: "90px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "110px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="invoice-print-th" style={{ ...thStyle, textAlign: "center" }}>
                    {t("print.rowNo")}
                  </th>
                  <th className="invoice-print-th" style={{ ...thStyle, textAlign: "left" }}>
                    {t("print.cols.productNameCode")}
                  </th>
                  <th className="invoice-print-th" style={{ ...thStyle, textAlign: "center" }}>
                    {t("print.cols.sizeType")}
                  </th>
                  <th className="invoice-print-th" style={{ ...thStyle, textAlign: "center" }}>
                    {t("print.cols.quantityUnit")}
                  </th>
                  <th className="invoice-print-th" style={{ ...thStyle, textAlign: "right" }}>
                    {t("print.cols.unitPriceAzn")}
                  </th>
                  <th className="invoice-print-th" style={{ ...thStyle, textAlign: "right" }}>
                    {t("print.cols.lineTotalAzn")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line, lineIndex) => (
                  <InvoiceItemRow
                    key={`${line.productCode}-${line.productName}-${lineIndex}`}
                    line={line}
                    index={lineIndex + 1}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", margin: "14px 0 16px" }}>
          <div
            className="invoice-print-summary"
            style={{
              width: "100%",
              maxWidth: "300px",
              backgroundColor: SUMMARY_BG,
              border: `1px solid ${SUMMARY_BORDER}`,
              borderRadius: "8px",
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${BORDER}`, fontSize: "10px" }}>
              <span style={{ color: SLATE }}>{t("print.totals.subtotal")}</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: INK }}>
                {formatMoney(data.subtotal, data.currency)}
              </span>
            </div>
            {isOfficial ? (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${BORDER}`, fontSize: "10px" }}>
                <span style={{ color: SLATE }}>{t("print.totals.vat")}</span>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: INK }}>
                  {formatMoney(data.vatTotal, data.currency)}
                </span>
              </div>
            ) : null}
            {data.discountTotal > 0 ? (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${BORDER}`, fontSize: "10px" }}>
                <span style={{ color: SLATE }}>{t("print.totals.discount")}</span>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#b45309" }}>
                  -{formatMoney(data.discountTotal, data.currency)}
                </span>
              </div>
            ) : null}
            {data.additionalExpenses > 0 ? (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${BORDER}`, fontSize: "10px" }}>
                <span style={{ color: SLATE }}>{t("print.totals.additionalExpenses")}</span>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: INK }}>
                  {formatMoney(data.additionalExpenses, data.currency)}
                </span>
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 5px", fontSize: "12px", fontWeight: 900 }}>
              <span style={{ color: INK }}>{t("print.totals.grandTotal")}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: INK }}>
                {formatMoney(data.grandTotal, data.currency)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderTop: `1px solid ${BORDER}`, fontSize: "10px" }}>
              <span style={{ color: SLATE }}>{t("print.paidAmount")}</span>
              <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: PAID_GREEN }}>
                {formatMoney(data.paidAmount, data.currency)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 0", fontSize: "10px" }}>
              <span style={{ color: SLATE }}>{t("print.remainingDebt")}</span>
              <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: BALANCE_RED }}>
                {formatMoney(data.remainingBalance, data.currency)}
              </span>
            </div>
          </div>
        </div>

        {data.notes ? (
          <p style={{ margin: "0 0 12px", fontSize: "10px", color: SLATE }}>
            <strong style={{ color: INK }}>{t("common.notes")}:</strong> {data.notes}
          </p>
        ) : null}

        <footer style={{ marginTop: "18px", paddingTop: "10px", borderTop: `1px solid ${BORDER}` }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "24px",
              alignItems: "end",
            }}
          >
            <div>
              <p style={{ margin: "0 0 24px", fontSize: "10px", fontWeight: 800, color: INK }}>
                {t("print.signatures.seller")} ({companyName})
              </p>
              <div style={{ borderBottom: "1.5px dashed #94a3b8", marginBottom: "4px" }} />
              <p style={{ margin: 0, fontSize: "9px", color: SLATE }}>{t("print.signatures.signatureAndStamp")}</p>
            </div>

            <div>
              <p style={{ margin: "0 0 24px", fontSize: "10px", fontWeight: 800, color: INK }}>
                {t("print.signatures.buyer")} ({data.customerName})
              </p>
              <div style={{ borderBottom: "1.5px dashed #94a3b8", marginBottom: "4px" }} />
              <p style={{ margin: 0, fontSize: "9px", color: SLATE }}>{t("print.signatures.signatureAndStamp")}</p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
