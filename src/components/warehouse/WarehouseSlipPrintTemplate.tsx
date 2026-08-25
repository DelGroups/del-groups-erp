"use client";

import React from "react";
import type { WarehouseSlip, WarehouseSlipType } from "@/types/database.types";
import {
  getWarehouseSlipTypeLabel,
} from "@/lib/warehouse/warehouseSlips";

export interface WarehouseSlipPrintData {
  slip_number: string;
  type: WarehouseSlipType;
  source_document_no: string | null;
  warehouse_name: string | null;
  created_at: string | null;
  approved_at: string | null;
  delivery_due_at: string | null;
  items: WarehouseSlip["items"];
  notes?: string | null;
}

interface WarehouseSlipPrintTemplateProps {
  slip: WarehouseSlipPrintData;
  companyName?: string;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("az-AZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function warehouseSlipToPrintData(slip: WarehouseSlip): WarehouseSlipPrintData {
  return {
    slip_number: slip.slip_number,
    type: slip.type,
    source_document_no: slip.source_document_no,
    warehouse_name: slip.warehouse_name,
    created_at: slip.created_at,
    approved_at: slip.approved_at,
    delivery_due_at: slip.delivery_due_at,
    items: slip.items,
    notes: slip.notes,
  };
}

export default function WarehouseSlipPrintTemplate({
  slip,
  companyName = "DEL GROUPS MMC",
}: WarehouseSlipPrintTemplateProps) {
  const totalQty = slip.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="warehouse-slip-print mx-auto w-[80mm] max-w-[210mm] bg-white p-4 font-sans text-[11px] text-black sm:w-[148mm] sm:p-6 sm:text-sm">
      <div className="mb-4 border-b-2 border-slate-800 pb-3">
        <h1 className="text-base font-bold tracking-wide sm:text-lg">{companyName}</h1>
        <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">
          Anbar qaiməsi — {getWarehouseSlipTypeLabel(slip.type)}
        </p>
      </div>

      <div className="mb-4 space-y-1.5 text-[10px] sm:text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Qaimə №:</span>
          <span className="font-mono font-bold">{slip.slip_number}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Faktura №:</span>
          <span className="font-mono font-semibold">{slip.source_document_no || "-"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Anbar:</span>
          <span className="font-semibold">{slip.warehouse_name || "-"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Faktura tarixi:</span>
          <span>{formatDateTime(slip.created_at)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Təsdiq / təhvil:</span>
          <span className="font-semibold">{formatDateTime(slip.approved_at)}</span>
        </div>
        <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50 px-2 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-indigo-800 sm:text-[10px]">
            Gözlənilən təhvil tarixi və saatı (Delivery Due Date)
          </p>
          <p className="mt-0.5 text-xs font-bold text-indigo-900 sm:text-sm">
            {formatDateTime(slip.delivery_due_at)}
          </p>
        </div>
      </div>

      <table className="mb-4 w-full border-collapse text-[10px] sm:text-xs">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-300 p-1 text-left">№</th>
            <th className="border border-slate-300 p-1 text-left">Məhsul</th>
            <th className="border border-slate-300 p-1 text-right">Miqdar</th>
          </tr>
        </thead>
        <tbody>
          {slip.items.map((item, idx) => (
            <tr key={`${item.product_id}-${idx}`}>
              <td className="border border-slate-300 p-1">{idx + 1}</td>
              <td className="border border-slate-300 p-1">
                <div className="font-mono text-[9px] text-slate-500">{item.product_code}</div>
                <div>{item.product_name}</div>
              </td>
              <td className="border border-slate-300 p-1 text-right whitespace-nowrap">
                {item.quantity} {item.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-4 text-right text-[10px] font-bold sm:text-xs">
        Cəmi miqdar: {totalQty}
      </div>

      {slip.notes && (
        <div className="mb-4 rounded border border-slate-200 p-2 text-[10px] sm:text-xs">
          <p className="text-slate-500">Qeyd</p>
          <p>{slip.notes}</p>
        </div>
      )}

      <div className="mt-8 grid grid-cols-2 gap-6 text-[10px] sm:text-xs">
        <div>
          <div className="mb-8 border-b border-slate-400" />
          <p className="text-center">Tərtib edən</p>
        </div>
        <div>
          <div className="mb-8 border-b border-slate-400" />
          <p className="text-center font-semibold">Anbardar (imza)</p>
        </div>
      </div>
    </div>
  );
}
