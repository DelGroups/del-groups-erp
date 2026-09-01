"use client";

import React from "react";
import { calcProductionCosting, type ProductionOrder } from "@/lib/production/types";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  companyName: string;
  order: ProductionOrder;
}

function money(value: number) {
  return `${Number(value || 0).toFixed(2)} AZN`;
}

export default function ProductionJobCardPrintTemplate({ companyName, order }: Props) {
  const { formatDate } = useI18n();
  const costing = calcProductionCosting(order);

  return (
    <div className="mx-auto w-[210mm] bg-white p-8 font-sans text-black">
      <header className="mb-5 flex items-start justify-between border-b-2 border-slate-900 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{companyName}</p>
          <h1 className="text-2xl font-bold">İstehsalat iş kartı</h1>
          <p className="text-sm text-slate-600">{order.project_name}</p>
        </div>
        <div className="text-right text-sm">
          <p><strong>Sənəd:</strong> {order.order_no}</p>
          <p><strong>Tarix:</strong> {formatDate(order.created_at)}</p>
          <p><strong>Status:</strong> {order.status}</p>
        </div>
      </header>

      <section className="mb-5 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded border p-3"><span className="block text-xs text-slate-500">Müştəri</span><strong>{order.customer_name || "—"}</strong></div>
        <div className="rounded border p-3"><span className="block text-xs text-slate-500">İstehsal növü</span><strong>{order.type}</strong></div>
        <div className="rounded border p-3"><span className="block text-xs text-slate-500">Təhvil tarixi</span><strong>{formatDate(order.expected_delivery_date)}</strong></div>
        <div className="rounded border p-3"><span className="block text-xs text-slate-500">Hazır məhsul</span><strong>{order.finished_product_name || "Fərdi spesifikasiya"}</strong></div>
        <div className="rounded border p-3"><span className="block text-xs text-slate-500">Miqdar</span><strong>{order.quantity}</strong></div>
        <div className="rounded border p-3"><span className="block text-xs text-slate-500">Əsas anbar</span><strong>{order.warehouse_name || "—"}</strong></div>
      </section>

      {order.project_scope && (
        <section className="mb-5 text-sm">
          <h2 className="mb-2 border-b pb-1 font-bold">Texniki spesifikasiya</h2>
          <p className="whitespace-pre-wrap">{order.project_scope}</p>
        </section>
      )}

      <section className="mb-5">
        <h2 className="mb-2 border-b pb-1 text-sm font-bold">Material tələbi / rezervasiya</h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100">
              <th className="border p-2 text-left">Kod / material</th>
              <th className="border p-2 text-left">Anbar</th>
              <th className="border p-2 text-right">Miqdar</th>
              <th className="border p-2 text-right">Vahid maya</th>
              <th className="border p-2 text-right">Cəm</th>
              <th className="border p-2 text-center">Verilib</th>
            </tr>
          </thead>
          <tbody>
            {order.materials.map((item) => (
              <tr key={item.id}>
                <td className="border p-2">{item.product_code || "—"} · {item.product_name}</td>
                <td className="border p-2">{item.warehouse_name || "—"}</td>
                <td className="border p-2 text-right">{item.quantity} {item.unit}</td>
                <td className="border p-2 text-right">{money(item.unit_cost)}</td>
                <td className="border p-2 text-right">{money(item.line_cost)}</td>
                <td className="border p-2 text-center">{item.issued ? "Bəli" : "Rezerv"}</td>
              </tr>
            ))}
            {!order.materials.length && <tr><td colSpan={6} className="border p-4 text-center">Material yoxdur</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="mb-5 grid grid-cols-2 gap-4 text-xs">
        <div>
          <h2 className="mb-2 border-b pb-1 text-sm font-bold">Xarici xidmətlər</h2>
          {order.outsourcing.map((item) => (
            <div key={item.id} className="flex justify-between border-b py-1">
              <span>{item.material_description}</span><strong>{money(item.total_cost)}</strong>
            </div>
          ))}
          {!order.outsourcing.length && <p>—</p>}
        </div>
        <div>
          <h2 className="mb-2 border-b pb-1 text-sm font-bold">Yan xərclər</h2>
          {order.expenses.map((item) => (
            <div key={item.id} className="flex justify-between border-b py-1">
              <span>{item.description}</span><strong>{money(item.amount)}</strong>
            </div>
          ))}
          {!order.expenses.length && <p>—</p>}
        </div>
      </section>

      <section className="ml-auto w-80 rounded border p-3 text-sm">
        <div className="flex justify-between"><span>Gəlir</span><strong>{money(costing.revenue)}</strong></div>
        <div className="flex justify-between"><span>Ümumi maya</span><strong>{money(costing.totalCost)}</strong></div>
        <div className="mt-2 flex justify-between border-t pt-2 text-base"><span>Mənfəət</span><strong>{money(costing.profit)} ({costing.marginPercent.toFixed(1)}%)</strong></div>
      </section>

      <footer className="mt-12 grid grid-cols-3 gap-10 text-center text-xs">
        {["İstehsalat rəhbəri", "Anbar məsulu", "Keyfiyyət yoxlaması"].map((label) => (
          <div key={label}><div className="mb-2 h-12 border-b" /><strong>{label}</strong></div>
        ))}
      </footer>
    </div>
  );
}
