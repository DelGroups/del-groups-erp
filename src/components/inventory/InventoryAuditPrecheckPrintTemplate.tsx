"use client";

import React from "react";

type AuditType = "standard" | "polywood";

interface StandardRow {
  product_code: string;
  product_name: string;
  system_qty: number;
  unit: string;
}

interface PolywoodRow {
  product_code: string;
  product_name: string;
  total_meters: number;
  full_sheet_count: number;
  full_sheet_length_m: number;
  cut_breakdown: string;
}

export interface InventoryAuditPrecheckPrintData {
  audit_type: AuditType;
  warehouse_name: string;
  audit_date: string;
  auditor_name: string;
  standard_rows?: StandardRow[];
  polywood_rows?: PolywoodRow[];
}

interface InventoryAuditPrecheckPrintTemplateProps {
  data: InventoryAuditPrecheckPrintData;
}

export default function InventoryAuditPrecheckPrintTemplate({
  data,
}: InventoryAuditPrecheckPrintTemplateProps) {
  return (
    <div className="mx-auto w-[210mm] bg-white p-8 text-black">
      <header className="mb-5 border-b-2 border-slate-800 pb-3">
        <h1 className="text-xl font-bold">DEL GROUPS ERP</h1>
        <p className="text-sm text-slate-600">
          {data.audit_type === "polywood"
            ? "Polywood ilkin sayım vərəqi"
            : "Məhsul ilkin sayım vərəqi"}
        </p>
      </header>

      <div className="mb-5 grid grid-cols-3 gap-4 rounded-md border bg-slate-50 p-3 text-sm">
        <p>
          <strong>Anbar:</strong> {data.warehouse_name || "-"}
        </p>
        <p>
          <strong>Tarix:</strong> {data.audit_date || "-"}
        </p>
        <p>
          <strong>Yoxlayan:</strong> {data.auditor_name || "-"}
        </p>
      </div>

      {data.audit_type === "polywood" ? (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100">
              <th className="border p-2 text-left">#</th>
              <th className="border p-2 text-left">Kod</th>
              <th className="border p-2 text-left">Məhsul</th>
              <th className="border p-2 text-right">Sistem Metr</th>
              <th className="border p-2 text-right">Sistem 4m</th>
              <th className="border p-2 text-left">Sistem kəsim</th>
              <th className="border p-2 text-right">Faktiki 4m</th>
              <th className="border p-2 text-left">Faktiki kəsim (m)</th>
            </tr>
          </thead>
          <tbody>
            {(data.polywood_rows || []).map((row, idx) => (
              <tr key={`${row.product_code}-${idx}`}>
                <td className="border p-2">{idx + 1}</td>
                <td className="border p-2 font-mono text-xs">{row.product_code || "-"}</td>
                <td className="border p-2">{row.product_name}</td>
                <td className="border p-2 text-right">{row.total_meters.toFixed(2)}</td>
                <td className="border p-2 text-right">
                  {row.full_sheet_count} × {row.full_sheet_length_m}m
                </td>
                <td className="border p-2 text-xs">{row.cut_breakdown || "-"}</td>
                <td className="border p-2" />
                <td className="border p-2" />
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100">
              <th className="border p-2 text-left">#</th>
              <th className="border p-2 text-left">Kod</th>
              <th className="border p-2 text-left">Məhsul</th>
              <th className="border p-2 text-right">Sistem miqdar</th>
              <th className="border p-2 text-right">Faktiki miqdar</th>
            </tr>
          </thead>
          <tbody>
            {(data.standard_rows || []).map((row, idx) => (
              <tr key={`${row.product_code}-${idx}`}>
                <td className="border p-2">{idx + 1}</td>
                <td className="border p-2 font-mono text-xs">{row.product_code || "-"}</td>
                <td className="border p-2">{row.product_name}</td>
                <td className="border p-2 text-right">
                  {Number(row.system_qty).toFixed(2)} {row.unit}
                </td>
                <td className="border p-2" />
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-14 grid grid-cols-2 gap-10 text-sm">
        <div className="border-t pt-2 text-center">Anbar müdiri imzası</div>
        <div className="border-t pt-2 text-center">Yoxlayan / müfəttiş imzası</div>
      </div>
    </div>
  );
}
