"use client";

import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import PageLayout from "@/components/layout/PageLayout";
import { ERPPage } from "@/components/layout/ERPLayout";
import Panel from "@/components/ui/panel";
import Button from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import KpiCard from "@/components/dashboard/KpiCard";
import LowStockAlerts from "@/components/dashboard/LowStockAlerts";
import RecentTransactionsTable from "@/components/dashboard/RecentTransactionsTable";
import MonthlyTrendChart from "@/components/dashboard/MonthlyTrendChart";
import { fetchDashboardData } from "@/lib/dashboard/fetchDashboard";
import { reconcileCustomerArBalancesAction } from "@/lib/actions/customerAr";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { canViewFinancials } from "@/lib/auth/permissionMatrix";
import type { DashboardData } from "@/types/database.types";
import { supabase } from "@/lib/supabase";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import AppsPageClient from "@/app/apps/page.client";
import { useNewUi } from "@/components/shell/NewUiProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import {
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

/** Tables whose changes move a KPI, the trend chart or the activity list. */
const LIVE_TABLES = ["sales", "purchases", "transactions", "customers", "products"] as const;
/** Fallback refresh for when Realtime events are unavailable. */
const LIVE_POLL_MS = 30_000;

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

function ManagementDashboardPage() {
  const { t } = useI18n();
  const { can, profile } = useAuth();
  // Money figures only for users who may see them (prompt 24b); the data is not even loaded otherwise.
  const financials = canViewFinancials(profile);
  const canReconcileAr =
    can("can_manage_finance") || can("can_edit_sales") || can("can_manage_settings");
  const companyName = useCompanyProfile().displayName;
  // Widgets of modules the tenant does not have are hidden.
  const { isEnabled } = useEnabledModules();
  const showSales = financials && isEnabled("sales");
  const showPurchases = financials && isEnabled("purchases");
  const showAccounting = financials && isEnabled("accounting");
  const showInventory = isEnabled("inventory");
  const [loading, setLoading] = useState(true);
  const [reconcilingAr, setReconcilingAr] = useState(false);
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const dashboard = await fetchDashboardData({ financials });
    setData(dashboard);
    setLoading(false);
  }, [financials]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // Keep the KPIs live: refresh silently on any change to the underlying
  // tables (Supabase Realtime), when the tab regains focus, and on a timer.
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (document.visibilityState === "visible") void loadDashboard(true);
      }, 800);
    };

    const channel = supabase.channel("dashboard-live");
    for (const table of LIVE_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(refresh, LIVE_POLL_MS);

    return () => {
      clearTimeout(debounce);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
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
      <ERPPage
        pageTitle={t("dashboard.title")}
        subtitle={t("dashboard.subtitle", { company: companyName })}
        actions={
          <>
            <Badge variant="success" className="normal-case">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Onlayn
            </Badge>
            <Button appearance="outline" color="secondary" size="sm" href="/reports">
              <BarChart3 className="h-4 w-4" />
              {t("nav.items.reports")}
            </Button>
            <Button
              appearance="outline"
              color="primary"
              size="sm"
              disabled={loading}
              onClick={() => void loadDashboard()}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t("dashboard.refresh")}
            </Button>
            <Button appearance="solid" color="secondary" size="sm" href="/settings">
              <Settings className="h-4 w-4" />
              {t("dashboard.settingsLink")}
            </Button>
          </>
        }
      >
          {showSales && hasArDiscrepancies ? (
            <Alert variant="warning" title={t("dashboard.arDiscrepancyTitle")}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p>{t("dashboard.arDiscrepancySummary", { count: arDiscrepancies.length })}</p>
                  <ul className="mt-2 space-y-1 text-[length:var(--erp-text-xs)]">
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
                {canReconcileAr ? (
                  <Button
                    color="warning"
                    size="sm"
                    disabled={reconcilingAr || loading}
                    onClick={() => void handleReconcileAr()}
                  >
                    <RefreshCw className={`h-4 w-4 ${reconcilingAr ? "animate-spin" : ""}`} />
                    {t("dashboard.arReconcileButton")}
                  </Button>
                ) : null}
              </div>
            </Alert>
          ) : null}

          {financials ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {showSales ? (
              <KpiCard
                label={t("dashboard.kpiRevenue")}
                value={loading ? "..." : `${kpis.monthlyRevenue.toFixed(2)} ${t("common.currency")}`}
                sublabel="Cari ay satışları"
                icon={<TrendingUp className="h-5 w-5" />}
                accent="emerald"
              />
            ) : null}
            {showAccounting ? (
              <KpiCard
                label={t("dashboard.kpiExpenses")}
                value={loading ? "..." : `${kpis.monthlyExpenses.toFixed(2)} ${t("common.currency")}`}
                sublabel="Məxaric əməliyyatları"
                icon={<ArrowDownRight className="h-5 w-5" />}
                accent="rose"
              />
            ) : null}
            {showAccounting ? (
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
            ) : null}
            {showSales ? (
              <KpiCard
                label={t("dashboard.kpiCustomerDebt")}
                value={loading ? "..." : `${kpis.customerDebts.toFixed(2)} ${t("common.currency")}`}
                sublabel={t("dashboard.kpiCustomerDebtHint")}
                icon={<ArrowUpRight className="h-5 w-5" />}
                accent="amber"
              />
            ) : null}
            {showPurchases ? (
              <KpiCard
                label={t("dashboard.kpiSupplierDebt")}
                value={loading ? "..." : `${kpis.supplierDebts.toFixed(2)} ${t("common.currency")}`}
                sublabel="Ödənilməmiş alışlar"
                icon={<Wallet className="h-5 w-5" />}
                accent="indigo"
              />
            ) : null}
          </div>
          ) : null}

          {showAccounting ? (
            <Panel title={t("dashboard.monthlyTrendTitle")} subtitle={t("dashboard.monthlyTrendSubtitle")}>
              <MonthlyTrendChart data={data.monthlyTrend} />
            </Panel>
          ) : null}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {showInventory ? (
              <Panel title={t("dashboard.lowStock")}>
                <LowStockAlerts products={data.lowStockAlerts} />
              </Panel>
            ) : null}
            {showAccounting ? (
              <Panel title={t("dashboard.recentActivity")} subtitle={t("dashboard.recentActivitySubtitle")}>
                <RecentTransactionsTable rows={data.recentActivities} />
              </Panel>
            ) : null}
          </div>
      </ERPPage>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}

// The widget home is loaded only by users who get it (NEW_HOME, prompt 24b).
const HomeDashboard = dynamic(() => import("@/components/home/HomeDashboard"), { ssr: false });

/**
 * Home: with the new shell on, the first screen is the app launcher (every module as a tile,
 * the user picks one), or the widget home for users who get NEW_HOME. With the new shell off,
 * the management dashboard as before.
 */
export default function HomePage() {
  const { active, newHome } = useNewUi();
  if (!active) return <ManagementDashboardPage />;
  return newHome ? <HomeDashboard /> : <AppsPageClient />;
}
