"use client";

import React from "react";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";
import {
  DEFAULT_BARCODE_LABEL_CONFIG,
  isEan13Payload,
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

function resolveLinearFormat(barcode: string): "CODE128" | "EAN13" {
  return isEan13Payload(barcode) ? "EAN13" : "CODE128";
}

function barcodeBarWidth(widthMm: number): number {
  if (widthMm <= 42) return 0.75;
  if (widthMm <= 50) return 0.85;
  if (widthMm <= 60) return 1;
  return 1.1;
}

function barcodeBarHeight(heightMm: number): number {
  if (heightMm <= 25) return 22;
  if (heightMm <= 30) return 26;
  if (heightMm <= 40) return 30;
  return 36;
}

function buildPrintPageCss(widthMm: number, heightMm: number, isA4: boolean): string {
  if (isA4) {
    return `@media print {
      @page {
        size: A4 portrait;
        margin: 8mm;
      }
    }`;
  }

  return `@media print {
    @page {
      size: ${widthMm}mm ${heightMm}mm landscape;
      margin: 0 !important;
    }
  }`;
}

export default function ThermalLabelPrintTemplate({
  items,
  size,
  branding: _branding,
  config,
  preview = false,
}: ThermalLabelPrintTemplateProps) {
  const base = config ?? DEFAULT_BARCODE_LABEL_CONFIG;
  const resolved: BarcodeLabelConfig = {
    ...base,
    paper_size: config ? base.paper_size : size ? LEGACY_SIZE_TO_PAPER[size] : base.paper_size,
  };
  const { widthMm, heightMm } = resolveLabelDimensions(resolved);
  const isA4 = resolved.paper_size === "A4_STICKERS";
  const printable = items.filter((item) => (item.barcode || "").trim());

  const rootClass = preview
    ? "barcode-label-preview-root"
    : isA4
      ? "barcode-label-print-root barcode-label-print-a4"
      : "barcode-label-print-root";

  return (
    <>
      {!preview ? (
        <style>{buildPrintPageCss(widthMm, heightMm, isA4)}</style>
      ) : null}
      <div
        className={rootClass}
        data-label-width-mm={widthMm}
        data-label-height-mm={heightMm}
        data-label-size={resolved.paper_size}
      >
        {printable.map((item) => {
          const format = resolveLinearFormat(item.barcode);
          return (
            <article
              key={item.id}
              className="barcode-label-sheet"
              style={
                preview
                  ? {
                      width: `${widthMm}mm`,
                      minHeight: `${heightMm}mm`,
                    }
                  : undefined
              }
            >
              <p className="barcode-label-name">{item.name}</p>
              <div className="barcode-label-barcode">
                <BarcodeDisplay
                  value={item.barcode}
                  format={format}
                  width={barcodeBarWidth(widthMm)}
                  height={barcodeBarHeight(heightMm)}
                  fontSize={heightMm <= 30 ? 8 : 9}
                  showValue
                />
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
