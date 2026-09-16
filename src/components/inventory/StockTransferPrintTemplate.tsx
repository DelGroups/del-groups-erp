"use client";

import React from "react";
import type { StockTransferPrintData } from "@/lib/inventory/stockTransfer";

interface StockTransferPrintTemplateProps {
  transfer: StockTransferPrintData;
  companyName?: string;
}

export default function StockTransferPrintTemplate({
  transfer,
  companyName = "DEL GROUPS MMC",
}: StockTransferPrintTemplateProps) {
  return (
    <div className="mx-auto w-[210mm] bg-white p-8 font-sans text-black print:p-6">
      <div className="mb-6 flex items-start justify-between border-b-2 border-[color:var(--erp-border-default)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-wide">{companyName}</h1>
          <p className="mt-1 text-sm text-[color:var(--erp-text-muted)]">
            Daxili Yerdəyişmə Sənədi
          </p>
        </div>
        <div className="text-right text-sm">
          <p>
            <strong>Sənəd №:</strong> {transfer.reference_number}
          </p>
          <p>
            <strong>Tarix:</strong> {transfer.transfer_date}
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm">
        <div>
          <p className="text-xs uppercase text-[color:var(--erp-text-muted)]">Çıxış anbarı</p>
          <p className="font-bold">{transfer.from_warehouse_name}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-[color:var(--erp-text-muted)]">Giriş anbarı</p>
          <p className="font-bold">{transfer.to_warehouse_name}</p>
        </div>
      </div>

      {transfer.notes ? (
        <p className="mb-4 text-sm">
          <strong>Qeyd:</strong> {transfer.notes}
        </p>
      ) : null}

      <table className="mb-8 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[color:var(--erp-bg-table-header)]">
            <th className="border p-2 text-left">№</th>
            <th className="border p-2 text-left">Kod</th>
            <th className="border p-2 text-left">Məhsul / Hissə</th>
            <th className="border p-2 text-left">Barkod</th>
            <th className="border p-2 text-right">Miqdar</th>
            <th className="border p-2 text-left">Vahid</th>
          </tr>
        </thead>
        <tbody>
          {transfer.items.map((item, index) => (
            <tr key={`${item.product_code}-${index}`}>
              <td className="border p-2">{index + 1}</td>
              <td className="border p-2 font-mono text-xs">{item.product_code}</td>
              <td className="border p-2">{item.product_name}</td>
              <td className="border p-2 font-mono text-xs">{item.barcode || "—"}</td>
              <td className="border p-2 text-right font-mono tabular-nums">{item.quantity}</td>
              <td className="border p-2">{item.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-12 grid grid-cols-2 gap-12 text-sm">
        <div>
          <p className="mb-10 border-b border-dashed pb-1">Təhvil verdi</p>
          <p className="text-xs text-[color:var(--erp-text-muted)]">İmza / tarix</p>
        </div>
        <div>
          <p className="mb-10 border-b border-dashed pb-1">Təhvil aldı</p>
          <p className="text-xs text-[color:var(--erp-text-muted)]">İmza / tarix</p>
        </div>
      </div>
    </div>
  );
}
