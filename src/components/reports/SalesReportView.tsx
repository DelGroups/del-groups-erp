"use client";

import React from "react";
import type { SalesReportData } from "@/types/database.types";

interface SalesReportViewProps {
  data: SalesReportData;
  loading?: boolean;
}

export default function SalesReportView({ data, loading }: SalesReportViewProps) {
  const { topProducts, summary } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Faktura sayı", value: summary.invoiceCount.toString(), mono: false },
          { label: "Satış həcmi", value: summary.totalVolume.toFixed(0), mono: true },
          { label: "Gəlir", value: `${summary.totalRevenue.toFixed(2)} AZN`, mono: true },
          { label: "Maya dəyəri", value: `${summary.totalCost.toFixed(2)} AZN`, mono: true },
          { label: "Mənfəət", value: `${summary.totalProfit.toFixed(2)} AZN`, mono: true },
          { label: "Orta marja", value: `${summary.averageMargin.toFixed(1)}%`, mono: true },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl app-card p-3 shadow-sm"
          >
            <p className="text-[10px] font-bold uppercase text-app-muted">{card.label}</p>
            <p
              className={`mt-1 text-sm font-bold text-app ${card.mono ? "font-mono" : ""}`}
            >
              {loading ? "..." : card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="app-table-wrap">
        <div className="border-b border-app px-5 py-4">
          <h3 className="text-sm font-bold text-app">Ən çox satılan məhsullar</h3>
          <p className="text-[11px] text-app-muted">Gəlir, mənfəət və marja analitikası</p>
        </div>

        {topProducts.length === 0 ? (
          <div className="px-5 py-12 text-center text-xs text-app-muted">
            Seçilmiş filtrə uyğun satış tapılmadı.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-app-card-hover font-bold uppercase text-app-muted">
                <tr>
                  <th className="px-4 py-3">№</th>
                  <th className="px-4 py-3">Məhsul</th>
                  <th className="px-4 py-3">Kateqoriya</th>
                  <th className="px-4 py-3 text-right">Miqdar</th>
                  <th className="px-4 py-3 text-right">Gəlir</th>
                  <th className="px-4 py-3 text-right">Maya</th>
                  <th className="px-4 py-3 text-right">Mənfəət</th>
                  <th className="px-4 py-3 text-right">Marja %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-app">
                {topProducts.map((row, idx) => (
                  <tr key={`${row.product_id}-${idx}`} className="hover:bg-app-card-hover">
                    <td className="px-4 py-3 font-mono text-app-muted">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-app">{row.product_name}</p>
                      <p className="font-mono text-[10px] text-app-muted">{row.product_code}</p>
                    </td>
                    <td className="px-4 py-3">{row.category}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.quantity.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {row.revenue.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-app-muted">
                      {row.cost.toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-bold ${
                        row.profit >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {row.profit.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{row.marginPercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-app bg-app-card-hover font-bold text-app">
                <tr>
                  <td className="px-4 py-3" colSpan={3}>
                    CƏMİ
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{summary.totalVolume.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono">{summary.totalRevenue.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono">{summary.totalCost.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-700">
                    {summary.totalProfit.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {summary.averageMargin.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
