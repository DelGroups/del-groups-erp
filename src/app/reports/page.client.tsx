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
  FileCheck2,
  Package,
  PieChart,
  RefreshCw,
  ShoppingCart,
  Table2,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import Button from "@/components/ui/button";
import Card from "@/components/ui/card";
import PageHeader from "@/components/ui/page-header";

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
    {
      title: t("reports.glFinancialCardTitle"),
      description: t("reports.glFinancialCardDescription"),
      href: "/dashboard/reports/financial",
      icon: FileSpreadsheet,
      accent:
        "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
    },
    {
      title: t("osv.pageTitle"),
      description: t("osv.pageDescription"),
      href: "/dashboard/reports/osv",
      icon: Table2,
      accent:
        "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
    },
    {
      title: t("reconciliation.pageTitle"),
      description: t("reconciliation.pageDescription"),
      href: "/dashboard/reports/reconciliation",
      icon: FileCheck2,
      accent:
        "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    },
    {
      title: t("inventoryTurnover.pageTitle"),
      description: t("inventoryTurnover.pageDescription"),
      href: "/dashboard/reports/inventory-turnover",
      icon: Package,
      accent:
        "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    },
  ];

  return (
    <PageLayout>
      <PageHeader
        icon={<BarChart3 className="h-6 w-6 text-app-accent" />}
        title={t("reports.title")}
        subtitle={t("reports.executive.description")}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()} loading={loading}>
            {loading ? null : <RefreshCw className="h-4 w-4" />}
            {t("common.refresh")}
          </Button>
        }
      />

      <main className="app-page-content flex-1 space-y-4 overflow-y-auto">
        {loading ? (
          <Card className="text-center text-sm text-app-muted">
            <div className="py-7">{t("common.loading")}</div>
          </Card>
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
                <Card
                  key={mod.href}
                  padding={false}
                  className="group p-6 transition-all hover:border-[color:var(--app-border-hover)] hover:shadow-md"
                >
                  <Link href={mod.href} className="block">
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
                </Card>
              );
            })}
          </div>
        </section>
      </main>
    </PageLayout>
  );
}
