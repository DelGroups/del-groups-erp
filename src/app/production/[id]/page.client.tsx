"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import ProductionContractPrintTemplate from "@/components/production/ProductionContractPrintTemplate";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/lib/supabase";
import { POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import {
  addProductionMaterialAction,
  addProductionOutsourcingAction,
  assignProductionContractorAction,
  fetchProductionLookupsAction,
  getProductionOrderAction,
  removeProductionMaterialAction,
  removeProductionOutsourcingAction,
  saveProductionContractAction,
  updateProductionOrderAction,
  updateProductionStatusAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import {
  calcProductionCosting,
  remainingBalance,
  type ProductionOrder,
  type ProductionStatus,
} from "@/lib/production/types";
import { Factory, Printer, Save } from "lucide-react";

const NEXT_STATUS: Partial<Record<ProductionStatus, ProductionStatus>> = {
  draft: "in_progress",
  in_progress: "ready",
  ready: "delivered",
};

export default function ProductionOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_production");
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [lookups, setLookups] = useState<ProductionLookups | null>(null);
  const [companyName, setCompanyName] = useState("DEL GROUPS MMC");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { printData, setPrintData } = useDocumentPrint<ProductionOrder>();

  const [projectName, setProjectName] = useState("");
  const [totalPrice, setTotalPrice] = useState("0");
  const [installFee, setInstallFee] = useState("0");
  const [advance, setAdvance] = useState("0");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [scope, setScope] = useState("");
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");

  const [materialProductId, setMaterialProductId] = useState("");
  const [materialQty, setMaterialQty] = useState("1");
  const [materialWarehouseId, setMaterialWarehouseId] = useState("");
  const [polywoodMode, setPolywoodMode] = useState<"linear_m" | "full_sheet">("linear_m");

  const [outDesc, setOutDesc] = useState("");
  const [outSupplierId, setOutSupplierId] = useState("");
  const [outSqm, setOutSqm] = useState("0");
  const [outPrice, setOutPrice] = useState("0");

  const [contractorId, setContractorId] = useState("");
  const [contractorName, setContractorName] = useState("");

  const applyOrder = useCallback((next: ProductionOrder) => {
    setOrder(next);
    setProjectName(next.project_name);
    setTotalPrice(String(next.total_project_price));
    setInstallFee(String(next.installation_fee));
    setAdvance(String(next.advance_payment));
    setDeliveryDate(next.expected_delivery_date || "");
    setScope(next.project_scope || "");
    setTerms(next.terms || "");
    setNotes(next.notes || "");
    const current = next.contractors[0];
    setContractorId(current?.contractor_id || "");
    setContractorName(current?.contractor_name || "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [orderRes, lookupsRes, settingsRes] = await Promise.all([
      getProductionOrderAction(id),
      fetchProductionLookupsAction(),
      supabase.from("settings").select("company_name").limit(1).maybeSingle(),
    ]);
    if (!orderRes.success) {
      setError(orderRes.error || t("production.loadError"));
    } else if (!orderRes.data) {
      setError(t("production.loadError"));
    } else {
      applyOrder(orderRes.data);
    }
    if (lookupsRes.success && lookupsRes.data) setLookups(lookupsRes.data);
    if (settingsRes.data?.company_name) setCompanyName(settingsRes.data.company_name as string);
    setLoading(false);
  }, [applyOrder, id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const costing = useMemo(() => (order ? calcProductionCosting(order) : null), [order]);
  const selectedProduct = lookups?.products.find((p) => p.id === materialProductId);
  const isPolywood = selectedProduct?.inventory_mode === POLYWOOD_INVENTORY_MODE;
  const liveRemaining = remainingBalance(Number(totalPrice) || 0, Number(installFee) || 0, Number(advance) || 0);

  const run = async (fn: () => Promise<{ success: boolean; error?: string; data?: ProductionOrder }>) => {
    setSaving(true);
    const result = await fn();
    setSaving(false);
    if (!result.success) {
      alert(result.error || t("common.error"));
      return;
    }
    if (result.data) applyOrder(result.data);
  };

  const handleSaveHeader = () =>
    run(() =>
      updateProductionOrderAction(id, {
        project_name: projectName,
        total_project_price: Number(totalPrice) || 0,
        installation_fee: Number(installFee) || 0,
        advance_payment: Number(advance) || 0,
        expected_delivery_date: deliveryDate || null,
        project_scope: scope,
        terms,
        notes,
      })
    );

  const handleStatus = (next: ProductionStatus) => run(() => updateProductionStatusAction(id, next));

  const handleAddMaterial = () => {
    const warehouse = lookups?.warehouses.find((w) => w.id === materialWarehouseId);
    return run(async () => {
      const result = await addProductionMaterialAction(id, {
        product_id: materialProductId,
        warehouse_id: materialWarehouseId || null,
        warehouse_name: warehouse?.name || null,
        quantity: Number(materialQty) || 0,
        polywood_sale_mode: isPolywood ? polywoodMode : null,
      });
      if (result.success) {
        setMaterialProductId("");
        setMaterialQty("1");
      }
      return result;
    });
  };

  const handleAddOutsourcing = () => {
    const supplier = lookups?.suppliers.find((s) => s.id === outSupplierId);
    return run(async () => {
      const result = await addProductionOutsourcingAction(id, {
        supplier_id: outSupplierId || null,
        supplier_name: supplier ? supplier.company_name || supplier.full_name || "" : null,
        material_description: outDesc,
        sqm_quantity: Number(outSqm) || 0,
        price_per_sqm: Number(outPrice) || 0,
      });
      if (result.success) {
        setOutDesc("");
        setOutSqm("0");
        setOutPrice("0");
      }
      return result;
    });
  };

  const handleAssignContractor = () => {
    const employee = lookups?.employees.find((e) => e.id === contractorId);
    return run(() =>
      assignProductionContractorAction(id, {
        contractor_id: contractorId || null,
        contractor_name: contractorName.trim() || employee?.full_name || "",
      })
    );
  };

  const handlePrintContract = async () => {
    const result = await saveProductionContractAction(id);
    if (!result.success) {
      alert(result.error || t("common.error"));
      return;
    }
    if (!result.data) {
      alert(t("common.error"));
      return;
    }
    applyOrder(result.data);
    setPrintData(result.data);
  };

  if (loading) {
    return (
      <PageLayout>
        <div className="p-6 text-sm text-app-muted">{t("common.loading")}</div>
      </PageLayout>
    );
  }

  if (!order) {
    return (
      <PageLayout>
        <div className="p-6 text-sm text-red-600">{error || t("common.notFound")}</div>
      </PageLayout>
    );
  }

  const nextStatus = NEXT_STATUS[order.status];
  const showOutsourcing = order.type === "custom";
  const showContractor = order.type === "custom" && order.custom_workflow === "subcontractor";
  const showContract = order.type === "custom";

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<Factory className="h-6 w-6 text-app-accent" />}
        title={`${order.order_no} · ${order.project_name}`}
        description={
          order.type === "series"
            ? t("production.series")
            : t(`production.workflow.${order.custom_workflow || "in_house"}`)
        }
        backLink={{ href: "/production", label: t("production.boardTitle") }}
        extraActions={
          <>
            {showContract && (
              <button type="button" className="btn-secondary text-xs" onClick={handlePrintContract}>
                <Printer className="h-3.5 w-3.5" />
                {t("production.contract.print")}
              </button>
            )}
            {canManage && nextStatus && (
              <button type="button" className="btn-primary text-xs" disabled={saving} onClick={() => handleStatus(nextStatus)}>
                {t(`production.advanceTo.${nextStatus}`)}
              </button>
            )}
          </>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {error && <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="flex flex-wrap gap-2 text-xs">
          {(["draft", "in_progress", "ready", "delivered"] as ProductionStatus[]).map((status) => (
            <span
              key={status}
              className={`rounded-full px-3 py-1 ${
                order.status === status ? "bg-app-accent text-white" : "bg-app-card-hover text-app-muted"
              }`}
            >
              {t(`production.status.${status}`)}
            </span>
          ))}
        </div>

        {costing && (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <CostCard label={t("production.materialCost")} value={costing.materialCost} currency={t("common.currency")} />
            <CostCard label={t("production.outsourcingCost")} value={costing.outsourcingCost} currency={t("common.currency")} />
            <CostCard label={t("production.contractorFee")} value={costing.contractorFee} currency={t("common.currency")} />
            <CostCard label={t("production.totalCost")} value={costing.totalCost} currency={t("common.currency")} />
            <CostCard
              label={`${t("production.profit")} (${costing.marginPercent.toFixed(1)}%)`}
              value={costing.profit}
              currency={t("common.currency")}
              emphasize
            />
          </section>
        )}

        <section className="rounded-xl border border-app bg-app-surface p-4">
          <h3 className="mb-3 font-semibold">{t("production.projectDetails")}</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs">
              {t("production.projectName")}
              <input
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                value={projectName}
                disabled={!canManage}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </label>
            <label className="text-xs">
              {t("production.totalProjectPrice")}
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                value={totalPrice}
                disabled={!canManage || order.type === "series"}
                onChange={(e) => setTotalPrice(e.target.value)}
              />
            </label>
            <label className="text-xs">
              {t("production.installationFee")}
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                value={installFee}
                disabled={!canManage || order.type === "series"}
                onChange={(e) => setInstallFee(e.target.value)}
              />
            </label>
            <label className="text-xs">
              {t("production.advancePayment")}
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                value={advance}
                disabled={!canManage || order.type === "series"}
                onChange={(e) => setAdvance(e.target.value)}
              />
            </label>
            <label className="text-xs">
              {t("production.remainingBalance")}
              <input
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                value={liveRemaining.toFixed(2)}
                disabled
              />
            </label>
            <label className="text-xs">
              {t("production.expectedDelivery")}
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                value={deliveryDate}
                disabled={!canManage}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </label>
            <label className="text-xs md:col-span-2">
              {t("production.projectScope")}
              <textarea
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                rows={3}
                value={scope}
                disabled={!canManage}
                onChange={(e) => setScope(e.target.value)}
              />
            </label>
            <label className="text-xs md:col-span-2">
              {t("production.contract.terms")}
              <textarea
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                rows={4}
                value={terms}
                disabled={!canManage || order.type === "series"}
                onChange={(e) => setTerms(e.target.value)}
              />
            </label>
            <label className="text-xs md:col-span-2">
              {t("common.notes")}
              <textarea
                className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                rows={2}
                value={notes}
                disabled={!canManage}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
          {canManage && (
            <button type="button" className="btn-primary mt-4 text-xs" disabled={saving} onClick={handleSaveHeader}>
              <Save className="h-3.5 w-3.5" />
              {t("common.save")}
            </button>
          )}
          {order.type === "series" && (
            <p className="mt-3 text-xs text-app-muted">{t("production.seriesRetailNote")}</p>
          )}
        </section>

        <section className="rounded-xl border border-app bg-app-surface p-4">
          <h3 className="mb-3 font-semibold">{t("production.materials")}</h3>
          <table className="mb-3 min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-app-muted">
              <tr>
                <th className="py-2">{t("forms.selectProduct")}</th>
                <th className="py-2 text-right">{t("forms.quantity")}</th>
                <th className="py-2 text-right">{t("production.unitCost")}</th>
                <th className="py-2 text-right">{t("forms.lineTotal")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {order.materials.map((row) => (
                <tr key={row.id} className="border-t border-app">
                  <td className="py-2">
                    {row.product_name}
                    {row.polywood_sale_mode ? ` · ${row.polywood_sale_mode}` : ""}
                  </td>
                  <td className="py-2 text-right">
                    {row.quantity} {row.unit}
                  </td>
                  <td className="py-2 text-right">{row.unit_cost.toFixed(2)}</td>
                  <td className="py-2 text-right">{row.line_cost.toFixed(2)}</td>
                  <td className="py-2 text-right">
                    {canManage && !order.materials_allocated && (
                      <button
                        type="button"
                        className="text-xs text-red-500"
                        onClick={() => run(() => removeProductionMaterialAction(id, row.id))}
                      >
                        {t("common.delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && order.status !== "delivered" && (
            <div className="grid gap-2 md:grid-cols-[1.4fr_0.6fr_1fr_auto] items-end">
              <select
                className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                value={materialProductId}
                onChange={(e) => setMaterialProductId(e.target.value)}
              >
                <option value="">{t("forms.selectProduct")}</option>
                {(lookups?.products || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0.001}
                step="0.001"
                className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                value={materialQty}
                onChange={(e) => setMaterialQty(e.target.value)}
              />
              <select
                className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                value={materialWarehouseId}
                onChange={(e) => setMaterialWarehouseId(e.target.value)}
              >
                <option value="">{t("common.warehouse")}</option>
                {(lookups?.warehouses || []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={handleAddMaterial}>
                {t("common.add")}
              </button>
              {isPolywood && (
                <select
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm md:col-span-2"
                  value={polywoodMode}
                  onChange={(e) => setPolywoodMode(e.target.value as "linear_m" | "full_sheet")}
                >
                  <option value="linear_m">{t("polywood.invoice.modeLinear")}</option>
                  <option value="full_sheet">{t("polywood.invoice.modeFullSheet")}</option>
                </select>
              )}
            </div>
          )}
        </section>

        {showOutsourcing && (
          <section className="rounded-xl border border-app bg-app-surface p-4">
            <h3 className="mb-1 font-semibold">{t("production.outsourcing")}</h3>
            <p className="mb-3 text-xs text-app-muted">{t("production.outsourcingHint")}</p>
            <table className="mb-3 min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-app-muted">
                <tr>
                  <th className="py-2">{t("common.description")}</th>
                  <th className="py-2">{t("purchases.supplier")}</th>
                  <th className="py-2 text-right">{t("production.sqm")}</th>
                  <th className="py-2 text-right">{t("production.pricePerSqm")}</th>
                  <th className="py-2 text-right">{t("common.total")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {order.outsourcing.map((row) => (
                  <tr key={row.id} className="border-t border-app">
                    <td className="py-2">{row.material_description}</td>
                    <td className="py-2">{row.supplier_name || "-"}</td>
                    <td className="py-2 text-right">{row.sqm_quantity}</td>
                    <td className="py-2 text-right">{row.price_per_sqm.toFixed(2)}</td>
                    <td className="py-2 text-right">{row.total_cost.toFixed(2)}</td>
                    <td className="py-2 text-right">
                      {canManage && (
                        <button
                          type="button"
                          className="text-xs text-red-500"
                          onClick={() => run(() => removeProductionOutsourcingAction(id, row.id))}
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canManage && (
              <div className="grid gap-2 md:grid-cols-[1.3fr_1fr_0.6fr_0.6fr_auto]">
                <input
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  placeholder={t("production.outsourcedMaterial")}
                  value={outDesc}
                  onChange={(e) => setOutDesc(e.target.value)}
                />
                <select
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={outSupplierId}
                  onChange={(e) => setOutSupplierId(e.target.value)}
                >
                  <option value="">{t("purchases.supplier")}</option>
                  {(lookups?.suppliers || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.company_name || s.full_name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={outSqm}
                  onChange={(e) => setOutSqm(e.target.value)}
                />
                <input
                  type="number"
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={outPrice}
                  onChange={(e) => setOutPrice(e.target.value)}
                />
                <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={handleAddOutsourcing}>
                  {t("common.add")}
                </button>
              </div>
            )}
          </section>
        )}

        {showContractor && (
          <section className="rounded-xl border border-app bg-app-surface p-4">
            <h3 className="mb-1 font-semibold">{t("production.contractor")}</h3>
            <p className="mb-3 text-xs text-app-muted">{t("production.contractorHint")}</p>
            {order.contractors[0] && (
              <p className="mb-3 text-sm">
                {order.contractors[0].contractor_name} · {order.contractors[0].commission_percentage}% ={" "}
                {order.contractors[0].calculated_fee.toFixed(2)} {t("common.currency")}
              </p>
            )}
            {canManage && (
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] items-end">
                <select
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={contractorId}
                  onChange={(e) => {
                    setContractorId(e.target.value);
                    const employee = lookups?.employees.find((emp) => emp.id === e.target.value);
                    if (employee) setContractorName(employee.full_name);
                  }}
                >
                  <option value="">{t("production.selectTeam")}</option>
                  {(lookups?.employees || []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  placeholder={t("production.contractorName")}
                  value={contractorName}
                  onChange={(e) => setContractorName(e.target.value)}
                />
                <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={handleAssignContractor}>
                  {t("common.save")}
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {printData && (
        <div className="print-area">
          <ProductionContractPrintTemplate data={{ companyName, order: printData }} />
        </div>
      )}
    </PageLayout>
  );
}

function CostCard({
  label,
  value,
  currency,
  emphasize,
}: {
  label: string;
  value: number;
  currency: string;
  emphasize?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${emphasize ? "border-app-accent bg-app-accent/10" : "border-app bg-app-surface"}`}>
      <p className="text-xs text-app-muted">{label}</p>
      <p className="mt-1 text-lg font-bold">
        {value.toFixed(2)} {currency}
      </p>
    </div>
  );
}
