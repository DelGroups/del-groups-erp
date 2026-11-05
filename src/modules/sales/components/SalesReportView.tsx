"use client";

import React from "react";
import type { SalesReportData } from "@/types/database.types";
import { Section, useUiStandard } from "@/design-system/components";
import { StandardGrid } from "@/components/lists/StandardGrid";
import { codeName } from "@/components/lists/standardGridLogic";
import { useI18n } from "@/i18n/I18nProvider";
import { formatFigure } from "@/lib/dates/localeDate";

type TopProduct = SalesReportData["topProducts"][number];

interface SalesReportViewProps {
  data: SalesReportData;
  loading?: boolean;
}

export default function SalesReportView({ data, loading }: SalesReportViewProps) {
  const { topProducts, summary } = data;
  const { t, locale } = useI18n();
  // UI_STANDARD (UI-6): the top products on the grid (texts through i18n, totals row); old table with the flag off.
  const standard = useUiStandard();
  const k = (key: string) => t(`tablesStd.salesReport.${key}`);
  const fig = (n: number, d = 2) => formatFigure(n, d, locale);

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

      {standard ? (
        <Section title={k("title")} description={k("hint")}>
          <StandardGrid<TopProduct>
            id="reports.sales.top-products"
            label={k("title")}
            rows={topProducts}
            rowKey={(row) => `${row.product_id}-${topProducts.indexOf(row)}`}
            loading={loading}
            empty={k("empty")}
            columns={[
              { key: "no", header: "№", type: "number", width: 56, className: "ds-muted", cell: (row) => topProducts.indexOf(row) + 1 },
              { key: "product", header: k("product"), width: 260, className: "font-semibold", cell: (row) => codeName(row.product_code, row.product_name), sortValue: (row) => row.product_name },
              { key: "category", header: k("category"), cell: (row) => row.category, sortValue: (row) => row.category },
              { key: "quantity", header: k("quantity"), type: "number", cell: (row) => fig(row.quantity), sortValue: (row) => row.quantity },
              { key: "revenue", header: k("revenue"), type: "money", className: "font-semibold", cell: (row) => fig(row.revenue), sortValue: (row) => row.revenue },
              { key: "cost", header: k("cost"), type: "money", className: "ds-muted", cell: (row) => fig(row.cost), sortValue: (row) => row.cost },
              { key: "profit", header: k("profit"), type: "money", cell: (row) => <span className={row.profit >= 0 ? "ds-text-success font-semibold" : "ds-text-danger font-semibold"}>{fig(row.profit)}</span>, sortValue: (row) => row.profit },
              { key: "margin", header: k("margin"), type: "number", cell: (row) => `${fig(row.marginPercent, 1)}%`, sortValue: (row) => row.marginPercent },
            ]}
            totals={{
              no: k("total"),
              quantity: fig(summary.totalVolume),
              revenue: fig(summary.totalRevenue),
              cost: fig(summary.totalCost),
              profit: <span className="ds-text-success">{fig(summary.totalProfit)}</span>,
              margin: `${fig(summary.averageMargin, 1)}%`,
            }}
          />
        </Section>
      ) : (
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
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{row.quantity.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                      {row.revenue.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-app-muted">
                      {row.cost.toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono tabular-nums font-bold ${
                        row.profit >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {row.profit.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{row.marginPercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-app bg-app-card-hover font-bold text-app">
                <tr>
                  <td className="px-4 py-3" colSpan={3}>
                    CƏMİ
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{summary.totalVolume.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{summary.totalRevenue.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{summary.totalCost.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700">
                    {summary.totalProfit.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {summary.averageMargin.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
