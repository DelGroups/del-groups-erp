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

const NAVY = "#1e3a8a";
const INK = "#0f172a";
const SLATE = "#64748b";
const BORDER = "#e2e8f0";
const CARD_BG = "#f8fafc";
const SUMMARY_BG = "#f1f5f9";
const SUMMARY_BORDER = "#cbd5e1";
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
      background-color: ${NAVY} !important;
      color: ${WHITE} !important;
    }
    .invoice-print-row-even { background-color: ${CARD_BG} !important; }
    .invoice-print-row-odd { background-color: ${WHITE} !important; }
    .invoice-print-info-card {
      background-color: ${CARD_BG} !important;
      border: 1px solid ${BORDER} !important;
    }
    .invoice-print-summary {
      background-color: ${SUMMARY_BG} !important;
      border: 1px solid ${SUMMARY_BORDER} !important;
    }
    .invoice-print-badge {
      background-color: ${NAVY} !important;
      color: ${WHITE} !important;
    }
    .invoice-print-doc-pill {
      background-color: ${NAVY} !important;
      color: ${WHITE} !important;
    }
  }
`;

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

const cellBase: React.CSSProperties = {
  padding: "7px 8px",
  borderBottom: `1px solid ${BORDER}`,
  color: INK,
  fontSize: "10px",
  verticalAlign: "top",
};

const thStyle: React.CSSProperties = {
  backgroundColor: NAVY,
  color: WHITE,
  padding: "9px 8px",
  fontSize: "9px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  textAlign: "left",
  borderBottom: `1px solid ${NAVY}`,
};

function rowBg(index: number): React.CSSProperties {
  return { backgroundColor: index % 2 === 0 ? CARD_BG : WHITE };
}

function DimensionalRow({ line, index }: { line: InvoicePrintLine; index: number }) {
  return (
    <tr className={index % 2 === 0 ? "invoice-print-row-even" : "invoice-print-row-odd"} style={{ pageBreakInside: "avoid" }}>
      <td style={{ ...cellBase, ...rowBg(index), width: "28px", textAlign: "center", fontWeight: 700 }}>{index}</td>
      <td style={{ ...cellBase, ...rowBg(index) }}>
        <div style={{ fontWeight: 700, color: INK }}>{line.productName}</div>
        {line.productCode ? <div style={{ fontSize: "9px", color: SLATE, marginTop: "2px" }}>{line.productCode}</div> : null}
      </td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "center" }}>{line.saleTypeLabel || "—"}</td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {line.lengthM != null ? line.lengthM.toFixed(2) : "—"}
      </td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {line.pieceCount ?? line.quantity}
      </td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {line.totalMeterage != null ? line.totalMeterage.toFixed(2) : "—"}
      </td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {line.unitPrice.toFixed(2)}
      </td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {line.lineTotal.toFixed(2)}
      </td>
    </tr>
  );
}

function AccessoryRow({ line, index }: { line: InvoicePrintLine; index: number }) {
  return (
    <tr className={index % 2 === 0 ? "invoice-print-row-even" : "invoice-print-row-odd"} style={{ pageBreakInside: "avoid" }}>
      <td style={{ ...cellBase, ...rowBg(index), width: "28px", textAlign: "center", fontWeight: 700 }}>{index}</td>
      <td style={{ ...cellBase, ...rowBg(index) }}>
        <div style={{ fontWeight: 700, color: INK }}>{line.productName}</div>
        {line.productCode ? <div style={{ fontSize: "9px", color: SLATE, marginTop: "2px" }}>{line.productCode}</div> : null}
      </td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "center" }}>{line.packaging || line.unit}</td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {line.unitPrice.toFixed(2)}
      </td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {line.lineTotal.toFixed(2)}
      </td>
    </tr>
  );
}

function ServiceRow({ line, index }: { line: InvoicePrintLine; index: number }) {
  return (
    <tr className={index % 2 === 0 ? "invoice-print-row-even" : "invoice-print-row-odd"} style={{ pageBreakInside: "avoid" }}>
      <td style={{ ...cellBase, ...rowBg(index), width: "28px", textAlign: "center", fontWeight: 700 }}>{index}</td>
      <td style={{ ...cellBase, ...rowBg(index), fontWeight: 700 }}>{line.productName}</td>
      <td style={{ ...cellBase, ...rowBg(index) }}>{line.description || "—"}</td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{line.quantity}</td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {line.unitPrice.toFixed(2)}
      </td>
      <td style={{ ...cellBase, ...rowBg(index), textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {line.lineTotal.toFixed(2)}
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
  const isOfficial = mode === "official";
  const companyName = branding.companyName || "DEL GROUPS MMC";
  const title = isOfficial ? t("print.officialInvoiceTitle") : t("print.unofficialTitle");

  const dimensionalLines = data.lines.filter((line) => line.kind === "dimensional");
  const accessoryLines = data.lines.filter(
    (line) => line.kind === "accessory" || line.kind === "standard"
  );
  const serviceLines = data.lines.filter((line) => line.kind === "service");

  let rowCounter = 0;

  const renderTable = (
    sectionTitle: string,
    headers: React.ReactNode,
    rows: React.ReactNode
  ) => (
    <section style={{ marginBottom: "12px" }}>
      <h2
        style={{
          margin: "0 0 6px",
          fontSize: "10px",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#334155",
        }}
      >
        {sectionTitle}
      </h2>
      <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${BORDER}` }}>
        <thead>
          <tr>{headers}</tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </section>
  );

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
        <div style={{ height: "3px", backgroundColor: NAVY, marginBottom: "14px", borderRadius: "2px" }} />

        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
            marginBottom: "14px",
            paddingBottom: "12px",
            borderBottom: `1px solid ${BORDER}`,
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
                    border: `2px solid ${NAVY}`,
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
                    backgroundColor: NAVY,
                    color: WHITE,
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
                    backgroundColor: NAVY,
                    color: WHITE,
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
                backgroundColor: NAVY,
                color: WHITE,
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
            <p style={{ margin: "4px 0 0", fontSize: "10px", color: SLATE }}>
              <strong style={{ color: INK }}>{t("print.paymentStatus.label")}:</strong>{" "}
              {paymentStatusLabel(data.paymentStatus, t)}
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
            <InfoField
              label={t("print.paymentStatus.label")}
              value={paymentStatusLabel(data.paymentStatus, t)}
            />
          </InfoCard>
        </div>

        {dimensionalLines.length > 0
          ? renderTable(
              t("print.sections.dimensional"),
              <>
                <th className="invoice-print-th" style={thStyle}>{t("print.rowNo")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.productName")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.type")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.lengthM")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.count")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.totalMeterage")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.price")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.lineTotal")}</th>
              </>,
              dimensionalLines.map((line) => {
                rowCounter += 1;
                return <DimensionalRow key={`d-${rowCounter}`} line={line} index={rowCounter} />;
              })
            )
          : null}

        {accessoryLines.length > 0
          ? renderTable(
              t("print.sections.accessory"),
              <>
                <th className="invoice-print-th" style={thStyle}>{t("print.rowNo")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.productName")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.packaging")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.price")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.lineTotal")}</th>
              </>,
              accessoryLines.map((line) => {
                rowCounter += 1;
                return <AccessoryRow key={`a-${rowCounter}`} line={line} index={rowCounter} />;
              })
            )
          : null}

        {serviceLines.length > 0
          ? renderTable(
              t("print.sections.service"),
              <>
                <th className="invoice-print-th" style={thStyle}>{t("print.rowNo")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.serviceName")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.cols.description")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.quantity")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.price")}</th>
                <th className="invoice-print-th" style={thStyle}>{t("print.lineTotal")}</th>
              </>,
              serviceLines.map((line) => {
                rowCounter += 1;
                return <ServiceRow key={`s-${rowCounter}`} line={line} index={rowCounter} />;
              })
            )
          : null}

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
            {isOfficial && data.vatTotal > 0 ? (
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
              <span style={{ color: NAVY }}>{t("print.totals.grandTotal")}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: NAVY }}>
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
              gridTemplateColumns: "1fr auto 1fr",
              gap: "16px",
              alignItems: "end",
            }}
          >
            <div>
              <p style={{ margin: "0 0 24px", fontSize: "10px", fontWeight: 800, color: INK }}>
                {t("print.signatures.handedOver")}
              </p>
              <div style={{ borderBottom: "1.5px dashed #94a3b8", marginBottom: "4px" }} />
              <p style={{ margin: 0, fontSize: "9px", color: SLATE }}>{t("print.signatures.signature")}</p>
            </div>

            <div style={{ display: "flex", justifyContent: "center", paddingBottom: "4px" }}>
              <div
                style={{
                  width: "96px",
                  height: "96px",
                  borderRadius: "999px",
                  border: "2px dashed #94a3b8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: SLATE,
                  textAlign: "center",
                  padding: "8px",
                }}
              >
                {t("print.stampArea")}
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <p style={{ margin: "0 0 24px", fontSize: "10px", fontWeight: 800, color: INK }}>
                {t("print.signatures.receivedBy")}
              </p>
              <div style={{ borderBottom: "1.5px dashed #94a3b8", marginBottom: "4px" }} />
              <p style={{ margin: 0, fontSize: "9px", color: SLATE }}>{t("print.signatures.signature")}</p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
