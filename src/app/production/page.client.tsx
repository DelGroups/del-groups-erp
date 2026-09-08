"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Factory, LayoutGrid, List, RefreshCw } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import ProductionOrderModal from "@/components/production/ProductionOrderModal";
import ProductionKanbanCard from "@/components/production/ProductionKanbanCard";
import ProductionWorkflowModal from "@/components/production/ProductionWorkflowModal";
import ProductionJobCardPrintTemplate from "@/components/production/ProductionJobCardPrintTemplate";
import ProductionProfitabilityCard, {
  ProductionHealthChip,
  ProductionStatusChip,
} from "@/components/production/ProductionProfitabilityCard";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import {
  deleteProductionOrderAction,
  fetchProductionLookupsAction,
  getProductionOrderAction,
  listProductionOrdersAction,
  updateProductionStatusAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import { withPrintableProductionContract } from "@/lib/production/contracts";
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
  const { can, isAdmin } = useAuth();
  const canManage = can("can_manage_production");
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [lookups, setLookups] = useState<ProductionLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [showCreate, setShowCreate] = useState(false);
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [workflowOrder, setWorkflowOrder] = useState<ProductionOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductionOrder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [companyName, setCompanyName] = useState("DEL GROUPS MMC");
  const { printData, setPrintData } = useDocumentPrint<{
    order: ProductionOrder;
    companyName: string;
  }>();
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

  const ensureLookups = useCallback(async () => {
    if (lookups) return lookups;
    setLoadingLookups(true);
    const result = await fetchProductionLookupsAction();
    setLoadingLookups(false);
    if (result.success && result.data) {
      setLookups(result.data);
      return result.data;
    }
    return null;
  }, [lookups]);

  const handleOpenCreate = useCallback(async () => {
    setShowCreate(true);
    await ensureLookups();
  }, [ensureLookups]);

  const handleEdit = useCallback(
    async (order: ProductionOrder) => {
      await ensureLookups();
      const full = await getProductionOrderAction(order.id);
      setWorkflowOrder(full.success && full.data ? full.data : order);
    },
    [ensureLookups]
  );

  const handlePrint = useCallback(async (order: ProductionOrder) => {
    const full = await getProductionOrderAction(order.id);
    if (!full.success || !full.data) return;
    setPrintData({
      order: withPrintableProductionContract(full.data),
      companyName,
    });
  }, [companyName, setPrintData]);

  const handleAdvance = useCallback(
    async (order: ProductionOrder, nextStatus: ProductionStatus) => {
      const result = await updateProductionStatusAction(order.id, nextStatus);
      if (!result.success) {
        setError(result.error || loadErrorLabel);
        return;
      }
      const updated = result.data || { ...order, status: nextStatus };
      setOrders((prev) => prev.map((row) => (row.id === order.id ? updated : row)));
      await ensureLookups();
      setWorkflowOrder(updated);
    },
    [ensureLookups, loadErrorLabel]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteProductionOrderAction(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      setError(result.error || loadErrorLabel);
      return;
    }
    setDeleteTarget(null);
    setOrders((prev) => prev.filter((row) => row.id !== deleteTarget.id));
  }, [deleteTarget, loadErrorLabel]);

  const handleWorkflowUpdated = useCallback((order: ProductionOrder) => {
    setOrders((prev) => prev.map((row) => (row.id === order.id ? order : row)));
    setWorkflowOrder(order);
  }, []);

  const handleWorkflowCompleted = useCallback((order: ProductionOrder) => {
    setOrders((prev) => prev.map((row) => (row.id === order.id ? order : row)));
    setWorkflowOrder(null);
  }, []);

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

        {!loading && orders.length > 0 && isAdmin && (
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
                      <ProductionKanbanCard
                        key={order.id}
                        order={order}
                        costing={costings.get(order.id)}
                        typeLabel={typeLabel(order)}
                        canManage={canManage}
                        showFinancials={isAdmin}
                        t={t}
                        onEdit={handleEdit}
                        onDelete={setDeleteTarget}
                        onPrint={handlePrint}
                        onAdvance={handleAdvance}
                      />
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
                  {isAdmin ? (
                    <>
                      <th className="px-3 py-2 text-right">{t("production.revenue")}</th>
                      <th className="px-3 py-2 text-right">{t("production.totalCost")}</th>
                      <th className="px-3 py-2 text-right">{t("production.profit")}</th>
                      <th className="px-3 py-2">{t("production.margin")}</th>
                    </>
                  ) : null}
                  <th className="px-3 py-2">{t("common.actions")}</th>
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
                      <td className="px-3 py-2"><div className="flex flex-wrap gap-1"><ProductionStatusChip status={order.status} />{isAdmin ? <ProductionHealthChip health={costing.health} /> : null}</div></td>
                      <td className="px-3 py-2">{order.customer_name || "-"}</td>
                      {isAdmin ? (
                        <>
                          <td className="px-3 py-2 text-right">{costing.revenue.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">{costing.totalCost.toFixed(2)}</td>
                          <td className={`px-3 py-2 text-right ${costing.profit < 0 ? "text-rose-400" : ""}`}>{costing.profit.toFixed(2)}</td>
                          <td className="px-3 py-2">{costing.marginPercent.toFixed(1)}%</td>
                        </>
                      ) : null}
                      <td className="px-3 py-2">
                        {isAdmin ? <ProductionProfitabilityCard order={order} costing={costing} compact /> : null}
                        {canManage ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            <button type="button" className="btn-secondary text-[10px]" onClick={() => void handleEdit(order)}>{t("common.edit")}</button>
                            <button type="button" className="btn-secondary text-[10px]" onClick={() => void handlePrint(order)}>{t("common.print")}</button>
                            <button type="button" className="btn-secondary text-[10px] text-rose-400" onClick={() => setDeleteTarget(order)}>{t("common.delete")}</button>
                          </div>
                        ) : null}
                      </td>
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
            setOrders((prev) => [order, ...prev]);
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

      {workflowOrder ? (
        <ProductionWorkflowModal
          open
          order={workflowOrder}
          lookups={lookups}
          onClose={() => setWorkflowOrder(null)}
          onUpdated={handleWorkflowUpdated}
          onCompleted={handleWorkflowCompleted}
        />
      ) : null}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        title={t("common.deleteConfirmTitle")}
        message={t("production.workflow.deleteConfirm")}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />

      {printData ? (
        <div className="print-area">
          <ProductionJobCardPrintTemplate
            order={printData.order}
            companyName={printData.companyName}
          />
        </div>
      ) : null}
    </PageLayout>
  );
}
