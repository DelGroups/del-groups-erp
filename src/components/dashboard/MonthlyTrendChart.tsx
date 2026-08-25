"use client";

import React from "react";
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
import type { MonthlyTrendPoint } from "@/types/database.types";

interface MonthlyTrendChartProps {
  data: MonthlyTrendPoint[];
}

export default function MonthlyTrendChart({ data }: MonthlyTrendChartProps) {
  const { t } = useI18n();

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
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `${v}`} />
            <Tooltip
              formatter={(value) => formatAzn(Number(value ?? 0))}
              contentStyle={{
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Bar dataKey="revenue" name={t("dashboard.chartRevenue")} fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" name={t("dashboard.chartExpenses")} fill="#f43f5e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
