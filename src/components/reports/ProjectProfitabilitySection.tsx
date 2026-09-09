"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { Factory } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import type { ProjectProfitabilityRow } from "@/types/database.types";

interface ProjectProfitabilitySectionProps {
  rows: ProjectProfitabilityRow[];
}

function readCssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

export default function ProjectProfitabilitySection({ rows }: ProjectProfitabilitySectionProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const currency = t("common.currency");
  const [colors, setColors] = useState({
    grid: "#334155",
    muted: "#94a3b8",
    border: "rgba(255,255,255,0.1)",
    card: "#1e293b",
    text: "#f1f5f9",
    estimated: "#6366f1",
    actual: "#10b981",
  });

  useEffect(() => {
    setColors({
      grid: readCssColor("--app-border", "#334155"),
      muted: readCssColor("--app-text-muted", "#94a3b8"),
      border: readCssColor("--app-border", "rgba(255,255,255,0.1)"),
      card: readCssColor("--app-card", "#1e293b"),
      text: readCssColor("--app-text", "#f1f5f9"),
      estimated: readCssColor("--app-accent", "#6366f1"),
      actual: readCssColor("--app-success-text", "#10b981"),
    });
  }, [theme]);

  const chartData = useMemo(
    () =>
      rows.slice(0, 12).map((row) => ({
        name: row.orderNo.length > 10 ? row.orderNo.slice(-8) : row.orderNo,
        estimated: Math.round(row.estimatedProfit),
        actual: Math.round(row.actualProfit),
      })),
    [rows]
  );

  return (
    <div className="app-card app-card-elevated p-5">
      <div className="mb-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-app">
          <Factory className="h-4 w-4 text-app-accent" />
          {t("reports.executive.profitabilityTitle")}
        </h3>
        <p className="text-[11px] text-app-muted">{t("reports.executive.profitabilitySubtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-app-muted">{t("reports.executive.noProjects")}</p>
      ) : (
        <div className="space-y-5">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: colors.muted }} interval={0} />
                <YAxis tick={{ fontSize: 10, fill: colors.muted }} />
                <Tooltip
                  formatter={(value) => money(Number(value ?? 0), currency)}
                  contentStyle={{
                    borderRadius: "12px",
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.card,
                    color: colors.text,
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", color: colors.muted }} />
                <Bar
                  dataKey="estimated"
                  name={t("reports.executive.estimatedProfit")}
                  fill={colors.estimated}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="actual"
                  name={t("reports.executive.actualProfit")}
                  fill={colors.actual}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="app-table-wrap">
            <table className="app-table text-xs">
              <thead className="border-b border-app bg-app-card-hover text-[10px] uppercase text-app-muted">
                <tr>
                  <th className="px-3 py-2 font-bold">{t("reports.executive.orderNo")}</th>
                  <th className="px-3 py-2 font-bold">{t("reports.executive.customer")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("reports.executive.netRevenue")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("reports.executive.rawMaterial")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("reports.executive.labor")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("reports.executive.generalExpenses")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("reports.executive.estimatedProfit")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("reports.executive.netProfit")}</th>
                  <th className="px-3 py-2 text-right font-bold">{t("reports.executive.actualMargin")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {rows.map((row) => (
                  <tr key={row.orderId} className="hover:bg-app-card-hover">
                    <td className="px-3 py-2">
                      <Link
                        href={`/production/${row.orderId}`}
                        className="font-mono font-bold text-app-accent hover:underline"
                      >
                        {row.orderNo}
                      </Link>
                      <p className="text-[10px] text-app-muted">{row.status}</p>
                    </td>
                    <td className="px-3 py-2 font-semibold text-app">{row.customerName}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.netRevenue.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-500">
                      −{row.rawMaterialCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-rose-500">
                      −{row.laborCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-rose-500">
                      −{row.generalExpenses.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{row.estimatedProfit.toFixed(2)}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-bold ${
                        row.netProfit < 0 ? "text-rose-600" : "text-emerald-600"
                      }`}
                    >
                      {row.netProfit.toFixed(2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-bold ${
                        row.actualMarginPercent < 0 ? "text-rose-600" : "text-emerald-600"
                      }`}
                    >
                      {row.actualMarginPercent.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
