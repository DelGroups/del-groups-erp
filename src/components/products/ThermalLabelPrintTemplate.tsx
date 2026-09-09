"use client";

import React from "react";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import QrCodeImage from "@/components/products/QrCodeImage";
import {
  DEFAULT_BARCODE_LABEL_CONFIG,
  resolveLabelDimensions,
  type BarcodeLabelConfig,
} from "@/lib/barcode/labelConfig";
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
  price?: number | null;
}

interface ThermalLabelPrintTemplateProps {
  items: ThermalLabelItem[];
  size?: ThermalLabelSize;
  branding: CompanyBranding;
  config?: BarcodeLabelConfig;
  preview?: boolean;
}

const LEGACY_SIZE_TO_PAPER: Record<ThermalLabelSize, BarcodeLabelConfig["paper_size"]> = {
  "58mm": "58x40mm",
  "80mm": "80x50mm",
  sticker: "A4_STICKERS",
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
  product: Pick<
    Product,
    | "id"
    | "name"
    | "code"
    | "barcode"
    | "qr_code"
    | "base_length"
    | "base_width"
    | "sell_price"
  >,
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
    price: product.sell_price ?? null,
  };
}

function formatPrice(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toFixed(2)} AZN`;
}

function barcodeBarWidth(widthMm: number): number {
  if (widthMm <= 50) return 0.9;
  if (widthMm <= 60) return 1.05;
  return 1.2;
}

function barcodeBarHeight(heightMm: number): number {
  if (heightMm <= 30) return 28;
  if (heightMm <= 40) return 34;
  return 40;
}

export default function ThermalLabelPrintTemplate({
  items,
  size,
  branding,
  config,
  preview = false,
}: ThermalLabelPrintTemplateProps) {
  const base = config ?? DEFAULT_BARCODE_LABEL_CONFIG;
  const resolved: BarcodeLabelConfig = {
    ...base,
    paper_size: config ? base.paper_size : size ? LEGACY_SIZE_TO_PAPER[size] : base.paper_size,
  };
  const { widthMm, heightMm } = resolveLabelDimensions(resolved);
  const padding = resolved.margin_padding_mm;
  const isA4 = resolved.paper_size === "A4_STICKERS";
  const printable = items.filter((item) => (item.barcode || "").trim());
  const headerTitle = resolved.header_title.trim() || branding.companyName;
  const symbol = resolved.barcode_type;
  const qrSize = Math.max(40, Math.min(88, Math.round(Math.min(widthMm, heightMm) * 1.4)));

  const pageCss = isA4
    ? `@page barcode-label { size: A4; margin: 8mm; }`
    : `@page barcode-label { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;

  const rootClass = preview
    ? "thermal-label-live"
    : isA4
      ? "thermal-print-root thermal-print-a4"
      : "thermal-print-root thermal-print-configured";

  return (
    <>
      {!preview ? <style>{`${pageCss} .thermal-print-configured, .thermal-print-a4 { page: barcode-label; }`}</style> : null}
      <div className={rootClass} data-label-size={resolved.paper_size}>
        {printable.map((item) => (
          <article
            key={item.id}
            className="thermal-label"
            style={{
              width: `${widthMm}mm`,
              minHeight: `${heightMm}mm`,
              padding: `${padding}mm`,
            }}
          >
            <header className="thermal-label-header">
              {resolved.show_company_logo && branding.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branding.logoUrl} alt="" className="thermal-label-logo" />
              ) : null}
              <p className="thermal-label-company">{headerTitle}</p>
            </header>
            <h2 className="thermal-label-name">{item.name}</h2>
            {resolved.show_item_code && item.code ? (
              <p className="thermal-label-code">{item.code}</p>
            ) : null}
            {resolved.show_price && formatPrice(item.price) ? (
              <p className="thermal-label-price">{formatPrice(item.price)}</p>
            ) : null}
            {resolved.show_dimensions && item.dimensions ? (
              <p className="thermal-label-meta">{item.dimensions}</p>
            ) : null}
            {resolved.show_warehouse_location && item.warehouseName ? (
              <p className="thermal-label-meta">{item.warehouseName}</p>
            ) : null}
            <div className="thermal-label-codes">
              {symbol === "QR_CODE" ? (
                <QrCodeImage value={item.qrCode || item.barcode} size={qrSize} />
              ) : (
                <BarcodeDisplay
                  value={item.barcode}
                  format={symbol}
                  width={barcodeBarWidth(widthMm)}
                  height={barcodeBarHeight(heightMm)}
                  fontSize={9}
                />
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
