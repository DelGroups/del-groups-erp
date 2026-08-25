"use client";

import React from "react";
import type { Product } from "@/types/database.types";
import BarcodeDisplay from "@/components/products/BarcodeDisplay";

interface ProductBarcodePrintTemplateProps {
  products: Product[];
  companyName?: string;
}

export default function ProductBarcodePrintTemplate({
  products,
  companyName = "DEL GROUPS MMC",
}: ProductBarcodePrintTemplateProps) {
  const withBarcodes = products.filter((p) => (p.barcode || "").trim());

  return (
    <div className="bg-white p-6 font-sans text-black">
      <div className="mb-6 border-b-2 border-slate-800 pb-3">
        <h1 className="text-lg font-bold">{companyName}</h1>
        <p className="text-sm text-gray-500">Məhsul barkod etiketləri</p>
        <p className="text-xs text-gray-500">
          {new Date().toISOString().slice(0, 10)} · {withBarcodes.length} etiket
        </p>
      </div>

      {withBarcodes.length === 0 ? (
        <p className="text-sm text-gray-500">Barkodu olan məhsul tapılmadı.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {withBarcodes.map((product) => (
            <div
              key={product.id}
              className="flex flex-col items-center rounded-lg border border-slate-300 p-3 text-center break-inside-avoid"
            >
              <p className="mb-1 line-clamp-2 text-xs font-bold">{product.name}</p>
              <p className="mb-2 font-mono text-[10px] text-slate-500">{product.code}</p>
              <BarcodeDisplay value={product.barcode} width={1.2} height={32} fontSize={10} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
