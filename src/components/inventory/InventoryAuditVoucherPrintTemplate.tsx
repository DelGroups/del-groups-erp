"use client";

import React from "react";

export interface InventoryAuditVoucherPrintItem {
  product_code: string;
  product_name: string;
  unit: string;
  system_qty: number;
  actual_qty: number;
  variance_qty: number;
  full_sheet_length_m?: number | null;
  system_full_sheet_count?: number | null;
  actual_full_sheet_count?: number | null;
  system_cut_pieces?: number[] | null;
  actual_cut_pieces?: number[] | null;
}

export interface InventoryAuditVoucherPrintData {
  voucher_number: string;
  audit_type: "standard" | "polywood";
  warehouse_name: string;
  audit_date: string;
  auditor_name: string;
  applied_at: string;
  items: InventoryAuditVoucherPrintItem[];
}

interface InventoryAuditVoucherPrintTemplateProps {
  data: InventoryAuditVoucherPrintData;
}

export default function InventoryAuditVoucherPrintTemplate({
  data,
}: InventoryAuditVoucherPrintTemplateProps) {
  const totalVariance = data.items.reduce((sum, item) => sum + Number(item.variance_qty || 0), 0);

  return (
    <div className="mx-auto w-[210mm] bg-white p-8 text-black">
      <header className="mb-5 border-b-2 border-slate-800 pb-3">
        <h1 className="text-xl font-bold">DEL GROUPS ERP</h1>
        <p className="text-sm text-slate-600">Inventory Adjustment Voucher / سند انبارگردانی</p>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-4 rounded-md border bg-slate-50 p-3 text-sm">
        <p>
          <strong>Sənəd №:</strong> {data.voucher_number}
        </p>
        <p>
          <strong>Audit tipi:</strong> {data.audit_type}
        </p>
        <p>
          <strong>Anbar:</strong> {data.warehouse_name}
        </p>
        <p>
          <strong>Audit tarixi:</strong> {data.audit_date}
        </p>
        <p>
          <strong>Yoxlayan:</strong> {data.auditor_name}
        </p>
        <p>
          <strong>Tətbiq vaxtı:</strong> {data.applied_at}
        </p>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100">
            <th className="border p-2 text-left">#</th>
            <th className="border p-2 text-left">Kod</th>
            <th className="border p-2 text-left">Məhsul</th>
            {data.audit_type === "polywood" ? (
              <th className="border p-2 text-left">Vərəq/Kəsim</th>
            ) : null}
            <th className="border p-2 text-right">Sistem</th>
            <th className="border p-2 text-right">Faktiki</th>
            <th className="border p-2 text-right">Fərq</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, idx) => (
            <tr key={`${item.product_code}-${idx}`}>
              <td className="border p-2">{idx + 1}</td>
              <td className="border p-2 font-mono text-xs">{item.product_code || "-"}</td>
              <td className="border p-2">{item.product_name}</td>
              {data.audit_type === "polywood" ? (
                <td className="border p-2 text-xs">
                  Sist: {item.system_full_sheet_count || 0}×{item.full_sheet_length_m || 4}m |{" "}
                  {(item.system_cut_pieces || []).join(", ") || "-"}
                  <br />
                  Fakt: {item.actual_full_sheet_count || 0}×{item.full_sheet_length_m || 4}m |{" "}
                  {(item.actual_cut_pieces || []).join(", ") || "-"}
                </td>
              ) : null}
              <td className="border p-2 text-right">
                {Number(item.system_qty).toFixed(2)} {item.unit}
              </td>
              <td className="border p-2 text-right">
                {Number(item.actual_qty).toFixed(2)} {item.unit}
              </td>
              <td className="border p-2 text-right font-semibold">
                {Number(item.variance_qty).toFixed(2)} {item.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 text-right text-sm font-bold">
        Cəmi fərq: {totalVariance.toFixed(2)}
      </div>

      <div className="mt-14 grid grid-cols-3 gap-8 text-sm">
        <div className="border-t pt-2 text-center">Anbar müdiri</div>
        <div className="border-t pt-2 text-center">Yoxlayan / müfəttiş</div>
        <div className="border-t pt-2 text-center">Təsdiq (Admin)</div>
      </div>
    </div>
  );
}
