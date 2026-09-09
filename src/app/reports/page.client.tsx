"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import CashFlowForecastChart from "@/components/reports/CashFlowForecastChart";
import InventoryInsightsSection from "@/components/reports/InventoryInsightsSection";
import ProjectProfitabilitySection from "@/components/reports/ProjectProfitabilitySection";
import { fetchExecutiveDashboard } from "@/lib/reports/fetchExecutiveDashboard";
import type { ExecutiveDashboardData } from "@/types/database.types";
import {
  ArrowRight,
  BarChart3,
  FileSpreadsheet,
  PieChart,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

const emptyDashboard: ExecutiveDashboardData = {
  projectProfitability: [],
  cashFlowForecast: [],
  cashFlowSummary: {
    totalInflows: 0,
    totalOutflows: 0,
    netPosition: 0,
    openingCash: 0,
    closingCash: 0,
  },
  topMaterials: [],
  deficitAlerts: [],
  deadstock: [],
};

export default function ReportsHubPage() {
  const { t } = useI18n();
  const [data, setData] = useState<ExecutiveDashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchExecutiveDashboard();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reportModules = [
    {
      title: t("reports.sales"),
      description: t("reports.salesDescription"),
      href: "/reports/sales",
      icon: ShoppingCart,
      accent:
        "bg-[color:var(--app-success-soft)] text-[color:var(--app-success-text)] border-[color:var(--app-success-border)]",
    },
    {
      title: t("reports.financial"),
      description: t("reports.financialDescription"),
      href: "/reports/financial",
      icon: PieChart,
      accent:
        "bg-[color:var(--app-accent-soft)] text-app-accent border-[color:var(--app-accent-ring)]",
    },
  ];

  return (
    <PageLayout>
      <header className="border-b border-app app-glass px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-app">
              <BarChart3 className="h-6 w-6 text-app-accent" />
              {t("reports.title")}
            </h1>
            <p className="mt-1 text-sm text-app-muted">{t("reports.executive.description")}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-app px-4 py-2 text-xs font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("common.refresh")}
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto p-6">
        {loading ? (
          <div className="rounded-2xl app-card p-12 text-center text-sm text-app-muted">
            {t("common.loading")}
          </div>
        ) : (
          <>
            <ProjectProfitabilitySection rows={data.projectProfitability} />

            <CashFlowForecastChart
              data={data.cashFlowForecast}
              summary={data.cashFlowSummary}
            />

            <InventoryInsightsSection
              topMaterials={data.topMaterials}
              deficitAlerts={data.deficitAlerts}
              deadstock={data.deadstock}
            />
          </>
        )}

        <section>
          <h2 className="mb-3 text-sm font-bold text-app">{t("reports.executive.detailedModules")}</h2>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {reportModules.map((mod) => {
              const Icon = mod.icon;
              return (
                <Link
                  key={mod.href}
                  href={mod.href}
                  className="group rounded-2xl app-card p-6 shadow-sm transition-all hover:border-[color:var(--app-border-hover)] hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className={`rounded-xl border p-3 ${mod.accent}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <ArrowRight className="h-5 w-5 text-app-muted transition-transform group-hover:translate-x-1 group-hover:text-app-accent" />
                  </div>
                  <h3 className="mt-4 text-lg font-bold text-app">{mod.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-app-muted">{mod.description}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-app-accent">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    {t("reports.viewReport")}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    </PageLayout>
  );
}
