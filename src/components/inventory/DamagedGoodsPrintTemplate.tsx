"use client";

import React from "react";
import type { DamagedGoodsItem } from "@/types/database.types";

export interface DamagedGoodsPrintData {
  document_number: string;
  writeoff_date: string;
  warehouse_name: string;
  checker_name: string;
  items: DamagedGoodsItem[];
  notes?: string | null;
}

interface DamagedGoodsPrintTemplateProps {
  writeoff: DamagedGoodsPrintData;
  companyName?: string;
}

export default function DamagedGoodsPrintTemplate({
  writeoff,
  companyName = "DEL GROUPS MMC",
}: DamagedGoodsPrintTemplateProps) {
  const totalQty = writeoff.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="mx-auto w-[210mm] bg-white p-8 font-sans text-black">
      <div className="mb-6 flex items-start justify-between border-b-2 border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-wide">{companyName}</h1>
          <p className="mt-1 text-sm text-gray-500">Anbar zədələnməsi / tullantı sənədi</p>
        </div>
        <div className="text-right text-sm">
          <p>
            <strong>Sənəd №:</strong> {writeoff.document_number}
          </p>
          <p>
            <strong>Tarix:</strong> {writeoff.writeoff_date}
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg border bg-slate-50 p-4 text-sm">
        <div>
          <p className="text-xs uppercase text-slate-500">Anbar</p>
          <p className="font-bold">{writeoff.warehouse_name || "-"}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Yoxlayan şəxs</p>
          <p className="font-bold">{writeoff.checker_name}</p>
        </div>
      </div>

      <table className="mb-6 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100">
            <th className="border p-2 text-left">№</th>
            <th className="border p-2 text-left">Kod</th>
            <th className="border p-2 text-left">Məhsul</th>
            <th className="border p-2 text-right">Miqdar</th>
            <th className="border p-2 text-left">Problem / səbəb</th>
          </tr>
        </thead>
        <tbody>
          {writeoff.items.map((item, idx) => (
            <tr key={item.id || idx}>
              <td className="border p-2">{idx + 1}</td>
              <td className="border p-2 font-mono text-xs">{item.product_code}</td>
              <td className="border p-2">{item.product_name}</td>
              <td className="border p-2 text-right">
                {item.quantity} {item.unit}
              </td>
              <td className="border p-2">{item.issue_description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-6 text-right text-sm font-bold">
        Cəmi çıxılan miqdar: {totalQty}
      </div>

      {writeoff.notes && (
        <div className="mb-8 rounded border p-3 text-sm">
          <p className="text-xs uppercase text-slate-500">Qeyd</p>
          <p>{writeoff.notes}</p>
        </div>
      )}

      <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
        <div className="border-t pt-2 text-center">Tərtib edən</div>
        <div className="border-t pt-2 text-center">Təsdiq edən</div>
      </div>
    </div>
  );
}
