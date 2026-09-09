"use client";

import React, { useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/ThemeProvider";
import type { CashFlowDayPoint } from "@/types/database.types";

interface CashFlowForecastChartProps {
  data: CashFlowDayPoint[];
  summary: {
    totalInflows: number;
    totalOutflows: number;
    netPosition: number;
  };
}

function readCssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export default function CashFlowForecastChart({ data, summary }: CashFlowForecastChartProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [colors, setColors] = useState({
    grid: "#334155",
    muted: "#94a3b8",
    border: "rgba(255,255,255,0.1)",
    card: "#1e293b",
    text: "#f1f5f9",
    inflow: "#10b981",
    outflow: "#f43f5e",
    net: "#6366f1",
  });

  useEffect(() => {
    setColors({
      grid: readCssColor("--app-border", "#334155"),
      muted: readCssColor("--app-text-muted", "#94a3b8"),
      border: readCssColor("--app-border", "rgba(255,255,255,0.1)"),
      card: readCssColor("--app-card", "#1e293b"),
      text: readCssColor("--app-text", "#f1f5f9"),
      inflow: readCssColor("--app-success-text", "#10b981"),
      outflow: "#f43f5e",
      net: readCssColor("--app-accent", "#6366f1"),
    });
  }, [theme]);

  const formatAzn = (value: number) => `${value.toFixed(0)} ${t("common.currency")}`;

  const chartData = data.filter((_, idx) => idx % 3 === 0 || idx === data.length - 1);

  return (
    <div className="app-card app-card-elevated p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-app">{t("reports.executive.cashFlowTitle")}</h3>
          <p className="text-[11px] text-app-muted">{t("reports.executive.cashFlowSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <SummaryPill label={t("reports.executive.inflows")} value={formatAzn(summary.totalInflows)} tone="success" />
          <SummaryPill label={t("reports.executive.outflows")} value={formatAzn(summary.totalOutflows)} tone="danger" />
          <SummaryPill label={t("reports.executive.netPosition")} value={formatAzn(summary.netPosition)} tone="accent" />
        </div>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: colors.muted }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: colors.muted }} tickFormatter={(v) => `${v}`} />
            <Tooltip
              formatter={(value) => formatAzn(Number(value ?? 0))}
              contentStyle={{
                borderRadius: "12px",
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.card,
                color: colors.text,
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px", color: colors.muted }} />
            <Bar dataKey="inflows" name={t("reports.executive.inflows")} fill={colors.inflow} radius={[4, 4, 0, 0]} />
            <Bar dataKey="outflows" name={t("reports.executive.outflows")} fill={colors.outflow} radius={[4, 4, 0, 0]} />
            <Line
              type="monotone"
              dataKey="net"
              name={t("reports.executive.dailyNet")}
              stroke={colors.net}
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "accent";
}) {
  const cls =
    tone === "success"
      ? "bg-emerald-500/10 text-emerald-600"
      : tone === "danger"
        ? "bg-rose-500/10 text-rose-600"
        : "bg-[color:var(--app-accent-soft)] text-app-accent";
  return (
    <div className={`rounded-lg px-3 py-2 ${cls}`}>
      <p className="text-[10px] font-bold uppercase opacity-80">{label}</p>
      <p className="font-mono text-sm font-bold">{value}</p>
    </div>
  );
}
