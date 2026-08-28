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
import type { MonthlyTrendPoint } from "@/types/database.types";

interface MonthlyTrendChartProps {
  data: MonthlyTrendPoint[];
}

function readCssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export default function MonthlyTrendChart({ data }: MonthlyTrendChartProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [colors, setColors] = useState({
    grid: "#334155",
    muted: "#94a3b8",
    border: "rgba(255,255,255,0.1)",
    card: "#1e293b",
    text: "#f1f5f9",
    accent: "#6366f1",
    secondary: "#06b6d4",
  });

  useEffect(() => {
    setColors({
      grid: readCssColor("--app-border", "#334155"),
      muted: readCssColor("--app-text-muted", "#94a3b8"),
      border: readCssColor("--app-border", "rgba(255,255,255,0.1)"),
      card: readCssColor("--app-card", "#1e293b"),
      text: readCssColor("--app-text", "#f1f5f9"),
      accent: readCssColor("--app-accent", "#6366f1"),
      secondary: readCssColor("--app-accent-secondary", "#06b6d4"),
    });
  }, [theme]);

  const formatAzn = (value: number): string => {
    return `${value.toFixed(0)} ${t("common.currency")}`;
  };

  return (
    <div className="app-card app-card-elevated p-5">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-app">{t("dashboard.monthlyTrendTitle")}</h3>
        <p className="text-[11px] text-app-muted">{t("dashboard.monthlyTrendSubtitle")}</p>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="chartRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.accent} stopOpacity={0.95} />
                <stop offset="100%" stopColor={colors.secondary} stopOpacity={0.85} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: colors.muted }} />
            <YAxis tick={{ fontSize: 11, fill: colors.muted }} tickFormatter={(v) => `${v}`} />
            <Tooltip
              formatter={(value) => formatAzn(Number(value ?? 0))}
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
            <Bar dataKey="revenue" name={t("dashboard.chartRevenue")} fill="url(#chartRevenue)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expenses" name={t("dashboard.chartExpenses")} fill="#f43f5e" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
