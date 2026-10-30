"use client";

import QrCodeImage from "@/components/products/QrCodeImage";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { useI18n } from "@/i18n/I18nProvider";
import type { SheetPage } from "../lib/posting";

export interface ReceivingSheetData {
  pages: SheetPage[];
  shipmentNumber: string;
  /** The receipt number, or null for a sheet printed before posting. */
  receiptNumber: string | null;
  supplierName: string;
  invoiceNo: string | null;
  customsDeclarationNo: string | null;
  date: string;
  warehouseNames: Readonly<Record<string, string>>;
}

/**
 * Warehouse receiving sheet (IMP-2): one A4 page per destination warehouse, for the keeper to
 * count and sign. Quantities only, no prices or costs; empty "Received" and "Note" columns for
 * handwriting; the receipt number as a QR code.
 */
export default function ReceivingSheet({ data }: { data: ReceivingSheetData }) {
  const { t, formatDate } = useI18n();
  const company = useCompanyProfile().displayName;
  return (
    <>
      {data.pages.map((page, index) => (
        <section
          key={page.warehouseId}
          className="mx-auto flex min-h-[277mm] w-[210mm] flex-col bg-white p-8 font-sans text-[12px] text-black"
          style={index < data.pages.length - 1 ? { breakAfter: "page" } : undefined}
          aria-label={t("imports.sheet.title")}
        >
          <header className="mb-4 flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div>
              <h1 className="text-lg font-bold">{company}</h1>
              <p className="text-sm font-semibold">{t("imports.sheet.title")}</p>
              <p className="text-sm">{t("imports.sheet.warehouse")}: <strong>{data.warehouseNames[page.warehouseId] ?? "—"}</strong></p>
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-right">
              <dt>{t("imports.sheet.file")}:</dt>
              <dd className="font-semibold">{data.shipmentNumber}</dd>
              <dt>{t("imports.sheet.receipt")}:</dt>
              <dd className="font-semibold">{data.receiptNumber ?? t("imports.sheet.notPosted")}</dd>
              <dt>{t("imports.fields.supplier")}:</dt>
              <dd>{data.supplierName || "—"}</dd>
              <dt>{t("imports.fields.invoiceNo")}:</dt>
              <dd>{data.invoiceNo || "—"}</dd>
              <dt>{t("imports.fields.customsDeclarationNo")}:</dt>
              <dd>{data.customsDeclarationNo || "—"}</dd>
              <dt>{t("common.date")}:</dt>
              <dd>{formatDate(data.date)}</dd>
            </dl>
          </header>

          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="border p-1.5 text-left">#</th>
                <th className="border p-1.5 text-left">{t("imports.sheet.code")}</th>
                <th className="border p-1.5 text-left">{t("imports.sheet.name")}</th>
                <th className="border p-1.5 text-left">{t("imports.sheet.barcode")}</th>
                <th className="border p-1.5 text-right">{t("imports.sheet.expectedPurchase")}</th>
                <th className="border p-1.5 text-right">{t("imports.sheet.expectedStock")}</th>
                <th className="w-[22mm] border p-1.5 text-left">{t("imports.sheet.received")}</th>
                <th className="w-[35mm] border p-1.5 text-left">{t("imports.sheet.note")}</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={`${row.productId}-${row.no}`}>
                  <td className="border p-1.5">{row.no}</td>
                  <td className="border p-1.5 font-mono">{row.code}</td>
                  <td className="border p-1.5">{row.name}</td>
                  <td className="border p-1.5 font-mono">{row.barcode ?? ""}</td>
                  <td className="border p-1.5 text-right tabular-nums">{row.qtyPurchase !== null ? `${row.qtyPurchase} ${row.purchaseUnit ?? ""}` : "—"}</td>
                  <td className="border p-1.5 text-right tabular-nums">{row.qtyStock} {row.stockUnit === "m" ? t("imports.units.metre") : row.purchaseUnit ?? ""}</td>
                  <td className="h-8 border p-1.5" />
                  <td className="border p-1.5" />
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="mt-auto pt-6">
            <p className="mb-4">{t("imports.sheet.totalLines", { count: page.rows.length })}</p>
            <div className="flex items-end justify-between gap-6">
              {(["handedOver", "receivedBy"] as const).map((who) => (
                <div key={who} className="flex-1">
                  <p className="font-semibold">{t(`imports.sheet.${who}`)}</p>
                  <p className="mt-6 border-b border-black">{t("imports.sheet.name")}:</p>
                  <p className="mt-6 border-b border-black">{t("imports.sheet.signature")}:</p>
                  <p className="mt-6 border-b border-black">{t("common.date")}:</p>
                </div>
              ))}
              {data.receiptNumber ? (
                <div className="text-center">
                  <QrCodeImage value={data.receiptNumber} size={88} />
                  <p className="mt-1 font-mono text-[10px]">{data.receiptNumber}</p>
                </div>
              ) : null}
            </div>
          </footer>
        </section>
      ))}
    </>
  );
}
