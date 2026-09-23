"use client";

import React, { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Users } from "lucide-react";

export interface ConsignmentRepPerformanceRow {
  repName: string;
  dispatched: number;
  sold: number;
}

interface ConsignmentRepPerformanceChartProps {
  data: ConsignmentRepPerformanceRow[];
}

function readCssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export default function ConsignmentRepPerformanceChart({ data }: ConsignmentRepPerformanceChartProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [colors, setColors] = useState({
    grid: "#334155",
    muted: "#94a3b8",
    border: "rgba(255,255,255,0.1)",
    card: "#1e293b",
    text: "#f1f5f9",
    dispatched: "#60a5fa",
    sold: "#6ee7b7",
  });

  useEffect(() => {
    setColors({
      grid: readCssColor("--app-border", "#334155"),
      muted: readCssColor("--app-text-muted", "#94a3b8"),
      border: readCssColor("--app-border", "rgba(255,255,255,0.1)"),
      card: readCssColor("--app-card", "#1e293b"),
      text: readCssColor("--app-text", "#f1f5f9"),
      dispatched: readCssColor("--app-accent", "#60a5fa"),
      sold: readCssColor("--app-success-text", "#6ee7b7"),
    });
  }, [theme]);

  const currency = t("common.currency");
  const formatValue = (value: number): string => `${value.toFixed(0)} ${currency}`;

  return (
    <div className="rounded-xl border border-app bg-app-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-app-accent" />
        <div>
          <h3 className="text-sm font-bold text-app">{t("consignments.repPerformanceTitle")}</h3>
          <p className="text-[11px] text-app-muted">{t("consignments.repPerformanceSubtitle")}</p>
        </div>
      </div>

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-app-muted">{t("consignments.repPerformanceEmpty")}</p>
      ) : (
        <>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                <XAxis dataKey="repName" tick={{ fontSize: 11, fill: colors.muted }} />
                <YAxis tick={{ fontSize: 11, fill: colors.muted }} tickFormatter={(v) => `${v}`} />
                <Tooltip
                  formatter={(value) => formatValue(Number(value ?? 0))}
                  contentStyle={{
                    borderRadius: "12px",
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.card,
                    color: colors.text,
                    fontSize: "12px",
                    boxShadow: "0 12px 32px -12px rgb(15 23 42 / 0.35)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", color: colors.muted }} />
                <Bar
                  dataKey="dispatched"
                  name={t("consignments.repPerformanceDispatched")}
                  fill={colors.dispatched}
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  dataKey="sold"
                  name={t("consignments.repPerformanceSold")}
                  fill={colors.sold}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-app">
            <table className="min-w-full text-sm">
              <thead className="bg-app text-left text-xs uppercase text-app-muted">
                <tr>
                  <th className="px-3 py-2">{t("consignments.salesRep")}</th>
                  <th className="px-3 py-2 text-right">{t("consignments.repPerformanceDispatched")}</th>
                  <th className="px-3 py-2 text-right">{t("consignments.repPerformanceSold")}</th>
                  <th className="px-3 py-2 text-right">{t("consignments.repPerformanceConversion")}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => {
                  const conversion = row.dispatched > 0 ? (row.sold / row.dispatched) * 100 : 0;
                  return (
                    <tr key={row.repName} className="border-t border-app">
                      <td className="px-3 py-2 font-semibold">{row.repName}</td>
                      <td className="px-3 py-2 text-right">{formatValue(row.dispatched)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{formatValue(row.sold)}</td>
                      <td className="px-3 py-2 text-right font-bold">{conversion.toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
