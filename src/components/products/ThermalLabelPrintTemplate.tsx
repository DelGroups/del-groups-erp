"use client";

import React from "react";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import QrCodeImage from "@/components/products/QrCodeImage";
import type { CompanyBranding } from "@/lib/print/types";
import type { Product } from "@/types/database.types";

export type ThermalLabelSize = "58mm" | "80mm" | "sticker";

export interface ThermalLabelItem {
  id: string;
  name: string;
  code?: string | null;
  barcode: string;
  qrCode?: string | null;
  dimensions?: string | null;
  warehouseName?: string | null;
}

interface ThermalLabelPrintTemplateProps {
  items: ThermalLabelItem[];
  size?: ThermalLabelSize;
  branding: CompanyBranding;
}

const SIZE_CLASS: Record<ThermalLabelSize, string> = {
  "58mm": "thermal-label thermal-label-58",
  "80mm": "thermal-label thermal-label-80",
  sticker: "thermal-label thermal-label-sticker",
};

export function formatProductDimensions(
  product: Pick<Product, "base_length" | "base_width">,
  extra?: string | null
): string | null {
  const parts = [
    product.base_length ? `${Number(product.base_length).toFixed(2)} m` : null,
    product.base_width ? `${Number(product.base_width).toFixed(2)} m` : null,
    extra?.trim() || null,
  ].filter(Boolean);
  return parts.length ? parts.join(" × ") : null;
}

export function productToThermalLabel(
  product: Pick<Product, "id" | "name" | "code" | "barcode" | "qr_code" | "base_length" | "base_width">,
  extras?: { warehouseName?: string | null; dimensions?: string | null }
): ThermalLabelItem {
  return {
    id: product.id,
    name: product.name,
    code: product.code,
    barcode: (product.barcode || product.qr_code || product.code || "").trim(),
    qrCode: product.qr_code || product.barcode || product.code,
    dimensions: extras?.dimensions || formatProductDimensions(product),
    warehouseName: extras?.warehouseName || null,
  };
}

export default function ThermalLabelPrintTemplate({
  items,
  size = "80mm",
  branding,
}: ThermalLabelPrintTemplateProps) {
  const printable = items.filter((item) => (item.barcode || "").trim());

  return (
    <div className={`thermal-print-root thermal-print-${size.replace("mm", "")}`} data-label-size={size}>
      {printable.map((item) => (
        <article key={item.id} className={SIZE_CLASS[size]}>
          <header className="thermal-label-header">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt="" className="thermal-label-logo" />
            ) : null}
            <p className="thermal-label-company">{branding.companyName}</p>
          </header>
          <h2 className="thermal-label-name">{item.name}</h2>
          {item.code ? <p className="thermal-label-code">{item.code}</p> : null}
          {item.dimensions ? <p className="thermal-label-meta">{item.dimensions}</p> : null}
          {item.warehouseName ? <p className="thermal-label-meta">{item.warehouseName}</p> : null}
          <div className="thermal-label-codes">
            <BarcodeDisplay value={item.barcode} width={1.1} height={36} fontSize={9} />
            <QrCodeImage value={item.qrCode || item.barcode} size={size === "sticker" ? 56 : 72} />
          </div>
        </article>
      ))}
    </div>
  );
}
