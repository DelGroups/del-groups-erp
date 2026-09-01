"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageLayout from "@/components/layout/PageLayout";
import KpiCard from "@/components/dashboard/KpiCard";
import LowStockAlerts from "@/components/dashboard/LowStockAlerts";
import RecentTransactionsTable from "@/components/dashboard/RecentTransactionsTable";
import MonthlyTrendChart from "@/components/dashboard/MonthlyTrendChart";
import { fetchDashboardData } from "@/lib/dashboard/fetchDashboard";
import { reconcileCustomerArBalancesAction } from "@/lib/actions/customerAr";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import type { DashboardData } from "@/types/database.types";
import { supabase } from "@/lib/supabase";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  RefreshCw,
  Settings,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

const emptyDashboard: DashboardData = {
  kpis: {
    monthlyRevenue: 0,
    monthlyExpenses: 0,
    netProfit: 0,
    customerDebts: 0,
    supplierDebts: 0,
  },
  lowStockAlerts: [],
  recentActivities: [],
  monthlyTrend: [],
};

export default function ManagementDashboardPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canReconcileAr =
    can("can_manage_finance") || can("can_edit_sales") || can("can_manage_settings");
  const [companyName, setCompanyName] = useState("DEL GROUPS MMC");
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [reconcilingAr, setReconcilingAr] = useState(false);
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    const [{ data: settings }, dashboard] = await Promise.all([
      supabase.from("settings").select("company_name, logo_url").limit(1).single(),
      fetchDashboardData(),
    ]);

    if (settings?.company_name) setCompanyName(settings.company_name);
    if (settings?.logo_url) setLogoUrl(settings.logo_url);
    setData(dashboard);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleReconcileAr = async () => {
    setReconcilingAr(true);
    const result = await reconcileCustomerArBalancesAction();
    if (!result.success) {
      showError(formatRpcError(result.error, t) || t("dashboard.arReconcileFailed"));
    } else {
      await loadDashboard();
    }
    setReconcilingAr(false);
  };

  const { kpis } = data;
  const arDiscrepancies = data.arDiscrepancies || [];
  const hasArDiscrepancies = arDiscrepancies.length > 0;

  return (
    <PageLayout>
        <header className="app-glass flex flex-col justify-between gap-4 border-b border-app px-6 py-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Logo"
                className="h-9 w-9 rounded-lg border border-app object-contain p-0.5 shadow-sm"
              />
            )}
            <div>
              <h2 className="text-xl font-bold text-app">{t("dashboard.title")}</h2>
              <p className="text-sm text-app-muted">
                {t("dashboard.subtitle", { company: companyName })}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Onlayn
            </span>
            <Link
              href="/reports"
              className="flex items-center gap-1.5 rounded-lg border border-app px-3 py-2 text-xs font-semibold text-app hover:bg-app-card-hover"
            >
              <BarChart3 className="h-4 w-4" />
              {t("nav.items.reports")}
            </Link>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-app px-3 py-2 text-xs font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t("dashboard.refresh")}
            </button>
            <Link
              href="/settings"
              className="flex items-center gap-1.5 rounded-lg bg-app-card-hover px-3 py-2 text-xs font-semibold text-app hover:bg-app-card-hover"
            >
              <Settings className="h-4 w-4" />
              {t("dashboard.settingsLink")}
            </Link>
          </div>
        </header>

        <main className="flex-1 space-y-6 overflow-y-auto p-6">
          {hasArDiscrepancies ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold">{t("dashboard.arDiscrepancyTitle")}</p>
                    <p className="mt-1 text-sm text-amber-900">
                      {t("dashboard.arDiscrepancySummary", { count: arDiscrepancies.length })}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-amber-900">
                      {arDiscrepancies.slice(0, 5).map((row) => (
                        <li key={row.customer_id}>
                          {row.customer_name}: {t("dashboard.arDiscrepancyRow", {
                            stored: row.stored_balance.toFixed(2),
                            ledger: row.ledger_balance.toFixed(2),
                            delta: row.delta.toFixed(2),
                          })}
                        </li>
                      ))}
                      {arDiscrepancies.length > 5 ? (
                        <li>{t("dashboard.arDiscrepancyMore", { count: arDiscrepancies.length - 5 })}</li>
                      ) : null}
                    </ul>
                  </div>
                </div>
                {canReconcileAr ? (
                  <button
                    type="button"
                    onClick={() => void handleReconcileAr()}
                    disabled={reconcilingAr || loading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${reconcilingAr ? "animate-spin" : ""}`} />
                    {t("dashboard.arReconcileButton")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              label={t("dashboard.kpiRevenue")}
              value={loading ? "..." : `${kpis.monthlyRevenue.toFixed(2)} ${t("common.currency")}`}
              sublabel="Cari ay satışları"
              icon={<TrendingUp className="h-5 w-5" />}
              accent="emerald"
            />
            <KpiCard
              label={t("dashboard.kpiExpenses")}
              value={loading ? "..." : `${kpis.monthlyExpenses.toFixed(2)} ${t("common.currency")}`}
              sublabel="Məxaric əməliyyatları"
              icon={<ArrowDownRight className="h-5 w-5" />}
              accent="rose"
            />
            <KpiCard
              label={t("dashboard.kpiProfit")}
              value={loading ? "..." : `${kpis.netProfit.toFixed(2)} ${t("common.currency")}`}
              sublabel={kpis.netProfit >= 0 ? "Mənfəətli ay" : "Mənfi balans"}
              icon={
                kpis.netProfit >= 0 ? (
                  <TrendingUp className="h-5 w-5" />
                ) : (
                  <TrendingDown className="h-5 w-5" />
                )
              }
              accent={kpis.netProfit >= 0 ? "blue" : "rose"}
            />
            <KpiCard
              label={t("dashboard.kpiCustomerDebt")}
              value={loading ? "..." : `${kpis.customerDebts.toFixed(2)} ${t("common.currency")}`}
              sublabel={t("dashboard.kpiCustomerDebtHint")}
              icon={<ArrowUpRight className="h-5 w-5" />}
              accent="amber"
            />
            <KpiCard
              label={t("dashboard.kpiSupplierDebt")}
              value={loading ? "..." : `${kpis.supplierDebts.toFixed(2)} ${t("common.currency")}`}
              sublabel="Ödənilməmiş alışlar"
              icon={<Wallet className="h-5 w-5" />}
              accent="indigo"
            />
          </div>

          <MonthlyTrendChart data={data.monthlyTrend} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <LowStockAlerts products={data.lowStockAlerts} />
            <RecentTransactionsTable rows={data.recentActivities} />
          </div>
        </main>
      <ToastMessage message={toastMessage} variant={toastVariant} />
      </PageLayout>
  );
}
