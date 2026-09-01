"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Factory, LayoutGrid, List, RefreshCw } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import ProductionOrderModal from "@/components/production/ProductionOrderModal";
import ProductionProfitabilityCard, {
  ProductionHealthChip,
  ProductionStatusChip,
} from "@/components/production/ProductionProfitabilityCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  fetchProductionLookupsAction,
  listProductionOrdersAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import { productionModelLabel } from "@/lib/production/models";
import {
  PRODUCTION_STATUSES,
  calcProductionCosting,
  isMissingProductionSchema,
  normalizeProductionStatus,
  type ProductionOrder,
  type ProductionStatus,
} from "@/lib/production/types";

const STATUSES: ProductionStatus[] = [...PRODUCTION_STATUSES];

export default function ProductionBoardPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const router = useRouter();
  const canManage = can("can_manage_production");
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [lookups, setLookups] = useState<ProductionLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [showCreate, setShowCreate] = useState(false);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const initialLoadStarted = useRef(false);
  const loadErrorLabel = t("production.loadError");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const ordersResult = await listProductionOrdersAction();
    if (!ordersResult.success) setError(ordersResult.error || loadErrorLabel);
    else setOrders(ordersResult.data || []);
    setLoading(false);
  }, [loadErrorLabel]);

  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    queueMicrotask(() => void loadRef.current());
  }, []);

  const handleOpenCreate = useCallback(async () => {
    setShowCreate(true);
    if (lookups || loadingLookups) return;
    setLoadingLookups(true);
    const result = await fetchProductionLookupsAction();
    if (!result.success) setError(result.error || loadErrorLabel);
    else if (result.data) setLookups(result.data);
    setLoadingLookups(false);
  }, [loadingLookups, loadErrorLabel, lookups]);

  const costings = useMemo(
    () => new Map(orders.map((order) => [order.id, calcProductionCosting(order)])),
    [orders]
  );
  const dashboard = useMemo(
    () =>
      [...costings.values()].reduce(
        (totals, order) => {
          totals.revenue += order.revenue;
          totals.cost += order.totalCost;
          totals.profit += order.profit;
          return totals;
        },
        { revenue: 0, cost: 0, profit: 0 }
      ),
    [costings]
  );
  const ordersByStatus = useMemo(() => {
    const grouped = new Map<ProductionStatus, ProductionOrder[]>(
      STATUSES.map((status) => [status, []])
    );
    for (const order of orders) {
      grouped.get(normalizeProductionStatus(order.status))?.push(order);
    }
    return grouped;
  }, [orders]);
  const dashboardMargin =
    dashboard.revenue > 0 ? (dashboard.profit / dashboard.revenue) * 100 : 0;
  const typeLabel = (order: ProductionOrder) => productionModelLabel(order.production_model);

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<Factory className="h-6 w-6 text-app-accent" />}
        title={t("production.boardTitle")}
        description={t("production.boardDescription")}
        createLabel={canManage ? t("production.newOrder") : undefined}
        onCreate={canManage ? handleOpenCreate : undefined}
        extraActions={
          <>
            <Link href="/production/bom" className="btn-secondary text-xs">
              {t("production.bomTitle")}
            </Link>
            <button type="button" className="btn-secondary text-xs" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("common.refresh")}
            </button>
            <div className="flex overflow-hidden rounded-lg border border-app">
              <button
                type="button"
                aria-label="Kanban"
                className={`px-3 py-2 ${view === "kanban" ? "bg-app-accent text-white" : "text-app"}`}
                onClick={() => setView("kanban")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Siyahı"
                className={`px-3 py-2 ${view === "list" ? "bg-app-accent text-white" : "text-app"}`}
                onClick={() => setView("list")}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {error && (
          <div className="mb-4 rounded-lg alert-danger px-4 py-3 text-sm">
            {error}
            {isMissingProductionSchema(error) && (
              <p className="mt-2 text-xs">{t("production.missingTablesHint")}</p>
            )}
          </div>
        )}

        {!loading && orders.length > 0 && (
          <section className="mb-6">
            <h3 className="mb-3 text-sm font-bold text-app">{t("production.dashboardSummary")}</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [t("production.revenue"), dashboard.revenue, ""],
                [t("production.totalCost"), dashboard.cost, ""],
                [t("production.profit"), dashboard.profit, dashboard.profit < 0 ? "text-rose-400" : "text-emerald-400"],
              ].map(([label, value, className]) => (
                <div key={String(label)} className="app-card p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-app-muted">{label}</p>
                  <p className={`mt-1 font-mono text-xl font-bold text-app ${className}`}>
                    {Number(value).toFixed(2)} {t("common.currency")}
                  </p>
                </div>
              ))}
              <div className="app-card p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-app-muted">{t("production.margin")}</p>
                <p className={`mt-1 font-mono text-xl font-bold ${
                  dashboardMargin >= 15 ? "text-emerald-400" : "text-rose-400"
                }`}>
                  {dashboardMargin.toFixed(1)}%
                </p>
              </div>
            </div>
          </section>
        )}
        {!loading && orders.length === 0 && (
          <section className="app-card mb-6 flex flex-col items-center justify-center px-6 py-14 text-center">
            <Factory className="h-10 w-10 text-app-accent" />
            <h3 className="mt-3 font-bold text-app">{t("production.boardTitle")}</h3>
            <p className="mt-1 max-w-md text-sm text-app-muted">{t("common.noData")}</p>
            {canManage && (
              <button type="button" className="btn-primary mt-4" onClick={handleOpenCreate}>
                {t("production.newOrder")}
              </button>
            )}
          </section>
        )}

        {loading ? (
          <p className="text-sm text-app-muted">{t("common.loading")}</p>
        ) : orders.length === 0 ? null : view === "kanban" ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {STATUSES.map((status) => {
              const column = ordersByStatus.get(status) || [];
              return (
                <section key={status} className="app-card p-3">
                  <h3 className="mb-3 flex items-center justify-between text-sm font-bold text-app">
                    {t(`production.status.${status}`)}
                    <span className="rounded-full bg-app-card-hover px-2 py-0.5 text-xs">{column.length}</span>
                  </h3>
                  <div className="space-y-2">
                    {!column.length && (
                      <p className="px-2 py-6 text-center text-xs text-app-muted">{t("common.noData")}</p>
                    )}
                    {column.map((order) => (
                      <Link
                        key={order.id}
                        href={`/production/${order.id}`}
                        className="app-card app-card-interactive block p-3"
                      >
                        <p className="text-xs text-app-muted">{order.order_no}</p>
                        <p className="font-semibold text-app">{order.project_name}</p>
                        <p className="mt-1 text-xs text-app-muted">{typeLabel(order)}</p>
                        <p className="text-xs">{order.customer_name || t("common.anonymousCustomer")}</p>
                        <ProductionProfitabilityCard
                          order={order}
                          costing={costings.get(order.id)}
                          compact
                        />
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-app">
            <table className="min-w-full text-sm">
              <thead className="bg-app-surface text-left text-xs uppercase text-app-muted">
                <tr>
                  <th className="px-3 py-2">{t("common.docNo")}</th>
                  <th className="px-3 py-2">{t("production.projectName")}</th>
                  <th className="px-3 py-2">{t("common.type")}</th>
                  <th className="px-3 py-2">{t("common.status")}</th>
                  <th className="px-3 py-2">{t("sales.customer")}</th>
                  <th className="px-3 py-2 text-right">{t("production.revenue")}</th>
                  <th className="px-3 py-2 text-right">{t("production.totalCost")}</th>
                  <th className="px-3 py-2 text-right">{t("production.profit")}</th>
                  <th className="px-3 py-2">{t("production.margin")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const costing = costings.get(order.id) || calcProductionCosting(order);
                  return (
                    <tr key={order.id} className="border-t border-app">
                      <td className="px-3 py-2"><Link className="text-app-accent hover:underline" href={`/production/${order.id}`}>{order.order_no}</Link></td>
                      <td className="px-3 py-2">{order.project_name}</td>
                      <td className="px-3 py-2">{typeLabel(order)}</td>
                      <td className="px-3 py-2"><div className="flex flex-wrap gap-1"><ProductionStatusChip status={order.status} /><ProductionHealthChip health={costing.health} /></div></td>
                      <td className="px-3 py-2">{order.customer_name || "-"}</td>
                      <td className="px-3 py-2 text-right">{costing.revenue.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{costing.totalCost.toFixed(2)}</td>
                      <td className={`px-3 py-2 text-right ${costing.profit < 0 ? "text-rose-400" : ""}`}>{costing.profit.toFixed(2)}</td>
                      <td className="px-3 py-2">{costing.marginPercent.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && lookups && !loadingLookups && (
        <ProductionOrderModal
          open
          lookups={lookups}
          onClose={() => setShowCreate(false)}
          onCreated={(order) => {
            setShowCreate(false);
            router.push(`/production/${order.id}`);
          }}
        />
      )}
      {showCreate && (!lookups || loadingLookups) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center app-scrim p-4">
          <div className="app-modal w-full max-w-sm p-6 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-app-accent border-t-transparent" />
            <p className="mt-4 text-sm font-semibold text-app">{t("common.loading")}</p>
            <button type="button" className="btn-secondary mt-4" onClick={() => setShowCreate(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
