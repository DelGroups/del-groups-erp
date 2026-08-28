"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createProductionOrderAction,
  fetchProductionLookupsAction,
  listProductionOrdersAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import {
  calcProductionCosting,
  type CustomWorkflow,
  type ProductionOrder,
  type ProductionOrderType,
  type ProductionStatus,
} from "@/lib/production/types";
import { Factory, LayoutGrid, List, RefreshCw } from "lucide-react";

const STATUSES: ProductionStatus[] = ["draft", "in_progress", "ready", "delivered"];

function customerLabel(c: { full_name?: string | null; name?: string | null; company_name?: string | null }) {
  return c.full_name || c.name || c.company_name || "";
}

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
  const [saving, setSaving] = useState(false);

  const [type, setType] = useState<ProductionOrderType>("custom");
  const [workflow, setWorkflow] = useState<CustomWorkflow>("in_house");
  const [projectName, setProjectName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [finishedProductId, setFinishedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [warehouseId, setWarehouseId] = useState("");
  const [totalPrice, setTotalPrice] = useState("0");
  const [installFee, setInstallFee] = useState("0");
  const [advance, setAdvance] = useState("0");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [scope, setScope] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [ordersRes, lookupsRes] = await Promise.all([
      listProductionOrdersAction(),
      fetchProductionLookupsAction(),
    ]);
    if (!ordersRes.success) setError(ordersRes.error || t("production.loadError"));
    else setOrders(ordersRes.data || []);
    if (lookupsRes.success && lookupsRes.data) setLookups(lookupsRes.data);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const bomProductIds = useMemo(
    () => new Set((lookups?.boms || []).map((bom) => bom.finished_product_id)),
    [lookups]
  );

  const resetCreate = () => {
    setType("custom");
    setWorkflow("in_house");
    setProjectName("");
    setCustomerId("");
    setFinishedProductId("");
    setQuantity("1");
    setWarehouseId("");
    setTotalPrice("0");
    setInstallFee("0");
    setAdvance("0");
    setDeliveryDate("");
    setScope("");
    setNotes("");
  };

  const handleCreate = async () => {
    const customer = lookups?.customers.find((c) => c.id === customerId);
    const warehouse = lookups?.warehouses.find((w) => w.id === warehouseId);
    const product = lookups?.products.find((p) => p.id === finishedProductId);
    setSaving(true);
    const result = await createProductionOrderAction({
      type,
      custom_workflow: type === "custom" ? workflow : null,
      project_name:
        type === "series"
          ? projectName.trim() || `${product?.name || t("production.series")} × ${quantity}`
          : projectName.trim(),
      customer_id: customerId || null,
      customer_name: customer ? customerLabel(customer) : null,
      finished_product_id: type === "series" ? finishedProductId : null,
      quantity: Number(quantity) || 1,
      warehouse_id: warehouseId || null,
      warehouse_name: warehouse?.name || null,
      total_project_price: Number(totalPrice) || 0,
      installation_fee: Number(installFee) || 0,
      advance_payment: Number(advance) || 0,
      expected_delivery_date: deliveryDate || null,
      project_scope: scope || null,
      notes: notes || null,
    });
    setSaving(false);
    if (!result.success) {
      alert(result.error || t("common.error"));
      return;
    }
    if (!result.data) {
      alert(t("common.error"));
      return;
    }
    setShowCreate(false);
    resetCreate();
    router.push(`/production/${result.data.id}`);
  };

  const statusLabel = (status: ProductionStatus) => t(`production.status.${status}`);
  const typeLabel = (order: ProductionOrder) =>
    order.type === "series"
      ? t("production.series")
      : t(`production.workflow.${order.custom_workflow || "in_house"}`);

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<Factory className="h-6 w-6 text-app-accent" />}
        title={t("production.boardTitle")}
        description={t("production.boardDescription")}
        createLabel={canManage ? t("production.newOrder") : undefined}
        onCreate={canManage ? () => setShowCreate(true) : undefined}
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
                className={`px-3 py-2 text-xs ${view === "kanban" ? "bg-app-accent text-white" : "text-app"}`}
                onClick={() => setView("kanban")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={`px-3 py-2 text-xs ${view === "list" ? "bg-app-accent text-white" : "text-app"}`}
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
          </div>
        )}
        {loading ? (
          <p className="text-sm text-app-muted">{t("common.loading")}</p>
        ) : view === "kanban" ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {STATUSES.map((status) => {
              const column = orders.filter((order) => order.status === status);
              return (
                <section key={status} className="app-card p-3">
                  <h3 className="mb-3 flex items-center justify-between text-sm font-bold text-app">
                    {statusLabel(status)}
                    <span className="rounded-full bg-app-card-hover px-2 py-0.5 text-xs">{column.length}</span>
                  </h3>
                  <div className="space-y-2">
                    {column.length === 0 && (
                      <p className="px-2 py-6 text-center text-xs text-app-muted">{t("common.noData")}</p>
                    )}
                    {column.map((order) => {
                      const costing = calcProductionCosting(order);
                      return (
                        <Link
                          key={order.id}
                          href={`/production/${order.id}`}
                          className="app-card app-card-interactive block p-3"
                        >
                          <p className="text-xs text-app-muted">{order.order_no}</p>
                          <p className="font-semibold text-app">{order.project_name}</p>
                          <p className="mt-1 text-xs text-app-muted">{typeLabel(order)}</p>
                          <p className="text-xs">{order.customer_name || t("common.anonymousCustomer")}</p>
                          {order.type === "custom" && (
                            <p className="mt-2 text-xs font-semibold">
                              {costing.projectPrice.toFixed(2)} {t("common.currency")} ·{" "}
                              {t("production.margin")}: {costing.marginPercent.toFixed(1)}%
                            </p>
                          )}
                        </Link>
                      );
                    })}
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
                  <th className="px-3 py-2 text-right">{t("production.totalProjectPrice")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t border-app">
                    <td className="px-3 py-2">
                      <Link className="text-app-accent hover:underline" href={`/production/${order.id}`}>
                        {order.order_no}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{order.project_name}</td>
                    <td className="px-3 py-2">{typeLabel(order)}</td>
                    <td className="px-3 py-2">{statusLabel(order.status)}</td>
                    <td className="px-3 py-2">{order.customer_name || "-"}</td>
                    <td className="px-3 py-2 text-right">
                      {order.total_project_price.toFixed(2)} {t("common.currency")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-app-surface p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold">{t("production.newOrder")}</h3>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${type === "series" ? "border-app-accent bg-app-accent/10" : "border-app"}`}
                onClick={() => setType("series")}
              >
                {t("production.series")}
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${type === "custom" ? "border-app-accent bg-app-accent/10" : "border-app"}`}
                onClick={() => setType("custom")}
              >
                {t("production.custom")}
              </button>
            </div>

            {type === "custom" && (
              <div className="mb-4 grid gap-2 md:grid-cols-3">
                {(["in_house", "outsourced_cut", "subcontractor"] as CustomWorkflow[]).map((wf) => (
                  <button
                    key={wf}
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-left text-xs ${workflow === wf ? "border-app-accent bg-app-accent/10" : "border-app"}`}
                    onClick={() => setWorkflow(wf)}
                  >
                    {t(`production.workflow.${wf}`)}
                  </button>
                ))}
              </div>
            )}

            {type === "series" ? (
              <div className="grid gap-3">
                <label className="text-xs">
                  {t("production.finishedProduct")}
                  <select
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={finishedProductId}
                    onChange={(e) => setFinishedProductId(e.target.value)}
                  >
                    <option value="">{t("common.select")}</option>
                    {(lookups?.products || [])
                      .filter((p) => bomProductIds.has(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs">
                  {t("forms.quantity")}
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  {t("production.projectName")}
                  <input
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs md:col-span-2">
                  {t("production.projectName")}
                  <input
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  {t("sales.customer")}
                  <select
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">{t("common.select")}</option>
                    {(lookups?.customers || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {customerLabel(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  {t("production.expectedDelivery")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  {t("production.totalProjectPrice")}
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={totalPrice}
                    onChange={(e) => setTotalPrice(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  {t("production.installationFee")}
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={installFee}
                    onChange={(e) => setInstallFee(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  {t("production.advancePayment")}
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={advance}
                    onChange={(e) => setAdvance(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  {t("common.warehouse")}
                  <select
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                  >
                    <option value="">{t("common.select")}</option>
                    {(lookups?.warehouses || []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs md:col-span-2">
                  {t("production.projectScope")}
                  <textarea
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    rows={3}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  />
                </label>
              </div>
            )}

            <label className="mt-3 block text-xs">
              {t("common.notes")}
              <textarea
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn-primary" disabled={saving} onClick={handleCreate}>
                {saving ? t("common.saving") : t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
