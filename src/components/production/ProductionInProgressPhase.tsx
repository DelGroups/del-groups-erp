"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import MaterialShortageConfirmModal from "@/components/production/MaterialShortageConfirmModal";
import {
  addProductionExpenseAction,
  addProductionMaterialAction,
  cancelPurchaseRequestAction,
  fetchWarehouseProductsForProductionAction,
  listPurchaseRequestsAction,
  removeProductionExpenseAction,
  removeProductionMaterialAction,
  type ProductionLookups,
  type WarehouseProductOption,
} from "@/lib/actions/production";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  calcProductionCosting,
  mergeProductionOrder,
  remainingBalanceFromOrder,
  type ProductionExpenseCategory,
  type ProductionOrder,
  type PurchaseRequest,
} from "@/lib/production/types";
import {
  buildMaterialLineSelection,
  decodeMaterialLineSelection,
  encodeMaterialLineSelection,
  formatMaterialPayloadDebug,
  type MaterialLineSelection,
} from "@/lib/production/materialSelection";
import { isValidUuid } from "@/lib/auth/validate";
import { adjustWarehouseProductsForOrderAllocations } from "@/lib/production/orderStock";
import {
  hasWarehouseStockShortage,
  warehouseStockShortageDelta,
} from "@/lib/production/warehouseStock";

type WorkflowTab = "materials" | "services" | "payments";

const WORKFLOW_EXPENSE_CATEGORIES: { value: ProductionExpenseCategory; labelKey: string }[] = [
  { value: "tools", labelKey: "production.workflow.expenseLaser" },
  { value: "delivery", labelKey: "production.workflow.expensePaint" },
  { value: "installation", labelKey: "production.workflow.expenseMaster" },
  { value: "transport", labelKey: "production.workflow.expenseTransport" },
  { value: "other", labelKey: "production.expenseCategory.other" },
];

function formatMoney(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

function SummaryCard({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: "good" | "bad" | "neutral";
}) {
  const color =
    emphasize === "good"
      ? "text-emerald-400"
      : emphasize === "bad"
        ? "text-rose-400"
        : "text-app";
  return (
    <div className="rounded-xl border border-app bg-app-surface p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-app-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

interface Props {
  order: ProductionOrder;
  lookups: ProductionLookups | null;
  saving: boolean;
  setSaving: (value: boolean) => void;
  setError: (value: string | null) => void;
  onUpdated: (order: ProductionOrder) => void;
}

export default function ProductionInProgressPhase({
  order,
  lookups,
  saving,
  setSaving,
  setError,
  onUpdated,
}: Props) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const currency = t("common.currency");
  const [tab, setTab] = useState<WorkflowTab>("materials");
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);

  const [materialOptionValue, setMaterialOptionValue] = useState("");
  const [materialSelection, setMaterialSelection] = useState<MaterialLineSelection | null>(null);
  const [materialWarehouseId, setMaterialWarehouseId] = useState("");
  const [materialQty, setMaterialQty] = useState(1);
  const [warehouseProducts, setWarehouseProducts] = useState<WarehouseProductOption[]>([]);
  const [loadingWarehouseProducts, setLoadingWarehouseProducts] = useState(false);
  const [shortageConfirmOpen, setShortageConfirmOpen] = useState(false);

  const [expenseCategory, setExpenseCategory] = useState<ProductionExpenseCategory>("other");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState(0);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [expenseSupplierId, setExpenseSupplierId] = useState("");

  const costing = useMemo(() => calcProductionCosting(order), [order]);
  const activePurchaseRequests = useMemo(
    () => purchaseRequests.filter((row) => row.status === "pending" || row.status === "ordered"),
    [purchaseRequests]
  );
  const fulfilledPurchaseRequests = useMemo(
    () => purchaseRequests.filter((row) => row.status === "fulfilled"),
    [purchaseRequests]
  );

  const displayWarehouseProducts = useMemo(
    () =>
      materialWarehouseId
        ? adjustWarehouseProductsForOrderAllocations(
            warehouseProducts,
            order.materials,
            materialWarehouseId
          )
        : warehouseProducts,
    [warehouseProducts, order.materials, materialWarehouseId]
  );

  const refreshPurchaseRequests = () => {
    void listPurchaseRequestsAction(order.id).then((result) => {
      if (result.success && result.data) setPurchaseRequests(result.data);
    });
  };
  const servicesAndOverhead = costing.outsourcingCost + costing.sideExpenseCost;
  const estimatedProfit = order.total_project_price - (costing.materialCost + servicesAndOverhead);
  const remaining = useMemo(() => remainingBalanceFromOrder(order), [order]);

  const selectedProduct = useMemo(() => {
    if (!materialSelection?.productId) return null;
    return (
      displayWarehouseProducts.find(
        (row) => row.product_id === materialSelection.productId || row.id === materialSelection.productId
      ) || null
    );
  }, [displayWarehouseProducts, materialSelection]);
  const availableStock = Number(selectedProduct?.stock || 0);
  const stockShortage = Boolean(selectedProduct) && hasWarehouseStockShortage(materialQty, availableStock);
  const shortageDelta = warehouseStockShortageDelta(materialQty, availableStock);
  const unitCost = Number(selectedProduct?.buy_price || 0);
  const lineTotalCost = (Number(materialQty) || 0) * unitCost;
  const productUnit = selectedProduct?.unit || "ədəd";

  const formatStockValue = (stock: number, unit: string) => {
    if (unit.toLowerCase().includes("m") && !unit.includes("²")) {
      return stock.toFixed(2);
    }
    return String(Math.round(stock * 100) / 100);
  };

  const productOptionLabel = (product: WarehouseProductOption) =>
    t("production.workflow.productInWarehouse", {
      name: product.name,
      stock: formatStockValue(product.stock, product.unit),
      unit: product.unit,
    });

  const productOptionValue = (product: WarehouseProductOption) =>
    encodeMaterialLineSelection(buildMaterialLineSelection(product, materialWarehouseId));

  const handleMaterialProductChange = (value: string) => {
    setMaterialOptionValue(value);
    const decoded = decodeMaterialLineSelection(value, materialWarehouseId, displayWarehouseProducts);
    setMaterialSelection(decoded);
  };

  const clearMaterialProduct = () => {
    setMaterialOptionValue("");
    setMaterialSelection(null);
  };

  const accountsById = useMemo(
    () => new Map((lookups?.accounts || []).map((row) => [row.id, row])),
    [lookups?.accounts]
  );
  const suppliersById = useMemo(
    () => new Map((lookups?.suppliers || []).map((row) => [row.id, row])),
    [lookups?.suppliers]
  );

  useEffect(() => {
    void listPurchaseRequestsAction(order.id).then((result) => {
      if (result.success && result.data) setPurchaseRequests(result.data);
    });
  }, [order.id]);

  useEffect(() => {
    if (!materialWarehouseId) {
      setWarehouseProducts([]);
      clearMaterialProduct();
      return;
    }

    let cancelled = false;
    setLoadingWarehouseProducts(true);
    void fetchWarehouseProductsForProductionAction(materialWarehouseId).then((result) => {
      if (cancelled) return;
      setLoadingWarehouseProducts(false);
      if (!result.success) {
        setWarehouseProducts([]);
        setError(result.error || t("common.error"));
        return;
      }
      const rows = result.data || [];
      setWarehouseProducts(rows);
      setMaterialSelection((current) => {
        if (!current?.productId) return current;
        const stillValid = rows.some(
          (row) => row.product_id === current.productId || row.id === current.productId
        );
        return stillValid ? current : null;
      });
      setMaterialOptionValue((current) => {
        if (!current) return current;
        const decoded = decodeMaterialLineSelection(current, materialWarehouseId, rows);
        return decoded ? current : "";
      });
    });

    return () => {
      cancelled = true;
    };
  }, [materialWarehouseId, setError, t]);

  const applyOrder = (next: ProductionOrder) => onUpdated(next);

  const runAction = async <T,>(
    action: () => Promise<{ success: boolean; error?: string; data?: T }>,
    onSuccess?: (data: T) => void
  ) => {
    setSaving(true);
    setError(null);
    const result = await action();
    setSaving(false);
    if (!result.success) {
      setError(result.error || t("common.error"));
      return;
    }
    if (result.data !== undefined && onSuccess) onSuccess(result.data);
  };

  const submitAddMaterial = async (confirmDeficitPurchase = false) => {
    if (!materialSelection?.productId || !isValidUuid(materialSelection.productId)) {
      setError(`${t("production.workflow.selectProduct")} — ${formatMaterialPayloadDebug(materialSelection)}`);
      return;
    }
    await runAction(
      () =>
        addProductionMaterialAction(order.id, {
          product_id: materialSelection.productId,
          product_name: materialSelection.productName || selectedProduct?.name || null,
          product_code: materialSelection.productCode || selectedProduct?.code || null,
          warehouse_id: materialSelection.warehouseId || materialWarehouseId,
          warehouse_name:
            lookups?.warehouses.find((row) => row.id === materialWarehouseId)?.name || null,
          unit_cost: materialSelection.unitPrice || selectedProduct?.buy_price || 0,
          quantity: materialQty,
          issue_now: true,
          confirm_deficit_purchase: confirmDeficitPurchase,
        }),
      (data) => {
        applyOrder(mergeProductionOrder(order, data));
        setMaterialQty(1);
        clearMaterialProduct();
        setShortageConfirmOpen(false);
        refreshPurchaseRequests();
      }
    );
  };

  const addMaterial = async () => {
    if (!materialWarehouseId) {
      setError(t("production.workflow.selectWarehouseFirst"));
      return;
    }
    if (!materialSelection?.productId || !isValidUuid(materialSelection.productId)) {
      setError(`${t("production.workflow.selectProduct")} — ${formatMaterialPayloadDebug(materialSelection)}`);
      return;
    }
    if (!isValidUuid(materialWarehouseId)) {
      setError(`${t("production.workflow.selectWarehouseFirst")} — ${formatMaterialPayloadDebug(materialSelection)}`);
      return;
    }
    if (stockShortage) {
      setShortageConfirmOpen(true);
      return;
    }
    await submitAddMaterial(false);
  };

  const confirmShortageAddMaterial = async () => {
    await submitAddMaterial(true);
  };

  const deleteMaterial = async (materialId: string) => {
    await runAction(
      () => removeProductionMaterialAction(order.id, materialId),
      (data) => {
        applyOrder(data);
        refreshPurchaseRequests();
      }
    );
  };

  const cancelPurchaseRequest = async (requestId: string) => {
    await runAction(
      () => cancelPurchaseRequestAction(order.id, requestId),
      (data) => setPurchaseRequests(data)
    );
  };

  const addExpense = async () => {
    if (!expenseDescription.trim()) {
      setError(t("production.expenseDescription"));
      return;
    }
    if (expenseAmount <= 0) {
      setError(t("production.workflow.invalidAmount"));
      return;
    }
    const supplier = expenseSupplierId ? suppliersById.get(expenseSupplierId) : null;
    const supplierLabel = supplier?.full_name || supplier?.company_name || "";
    const notes = supplierLabel ? `Podratçı: ${supplierLabel}` : null;

    await runAction(
      () =>
        addProductionExpenseAction(order.id, {
          category: expenseCategory,
          description: expenseDescription.trim(),
          amount: expenseAmount,
          expense_date: expenseDate,
          account_id: expenseAccountId || null,
          account_name: expenseAccountId
            ? accountsById.get(expenseAccountId)?.name || null
            : null,
          notes,
        }),
      (data) => {
        applyOrder(mergeProductionOrder(order, data));
        setExpenseDescription("");
        setExpenseAmount(0);
        setExpenseAccountId("");
        setExpenseSupplierId("");
      }
    );
  };

  const deleteExpense = async (expenseId: string) => {
    await runAction(
      () => removeProductionExpenseAction(order.id, expenseId),
      (data) => applyOrder(data)
    );
  };

  const expenseCategoryLabel = (category: ProductionExpenseCategory) => {
    const mapped = WORKFLOW_EXPENSE_CATEGORIES.find((row) => row.value === category);
    if (mapped) return t(mapped.labelKey);
    return t(`production.expenseCategory.${category}`);
  };

  const paymentRows = useMemo(() => {
    const rows: { label: string; amount: number; account?: string; kind: string }[] = [];
    if (order.advance_payment > 0) {
      rows.push({
        kind: "advance",
        label: t("production.advancePayment"),
        amount: order.advance_payment,
        account: order.advance_account_id
          ? accountsById.get(order.advance_account_id)?.name || "—"
          : "—",
      });
    }
    for (const expense of order.expenses) {
      rows.push({
        kind: "expense",
        label: expense.description,
        amount: expense.amount,
        account: expense.account_name || (expense.account_id ? accountsById.get(expense.account_id)?.name : "—") || "—",
      });
    }
    for (const row of order.outsourcing) {
      rows.push({
        kind: "outsourcing",
        label: row.material_description,
        amount: row.total_cost,
        account: row.supplier_name || "—",
      });
    }
    return rows;
  }, [order, accountsById, t]);

  const totalPaidOut =
    order.expenses.reduce((sum, row) => sum + row.amount, 0) +
    order.outsourcing.reduce((sum, row) => sum + row.total_cost, 0);

  const visibleTabs = useMemo(
    () => (isAdmin ? (["materials", "services", "payments"] as WorkflowTab[]) : (["materials", "services"] as WorkflowTab[])),
    [isAdmin]
  );

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab("materials");
  }, [tab, visibleTabs]);

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label={t("production.workflow.projectBudget")}
            value={formatMoney(order.total_project_price, currency)}
          />
          <SummaryCard
            label={t("production.materialCost")}
            value={formatMoney(costing.materialCost, currency)}
          />
          <SummaryCard
            label={t("production.workflow.servicesAndExpenses")}
            value={formatMoney(servicesAndOverhead, currency)}
          />
          <SummaryCard
            label={t("production.workflow.estimatedProfit")}
            value={formatMoney(estimatedProfit, currency)}
            emphasize={estimatedProfit >= 0 ? "good" : "bad"}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-app pb-2">
        {visibleTabs.map((key) => (
          <button
            key={key}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tab === key ? "bg-app-accent text-white" : "bg-app-card-hover text-app hover:bg-app-surface"
            }`}
            onClick={() => setTab(key)}
          >
            {key === "materials"
              ? t("production.workflow.tabMaterials")
              : key === "services"
                ? t("production.workflow.tabServices")
                : t("production.workflow.tabPayments")}
          </button>
        ))}
      </div>

      {tab === "materials" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-app bg-app-card-hover/40 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">
                <span className="text-app-muted">{t("production.warehouse")}</span>
                <select
                  className="input-field mt-1 w-full"
                  value={materialWarehouseId}
                  onChange={(e) => {
                    setMaterialWarehouseId(e.target.value);
                    clearMaterialProduct();
                  }}
                >
                  <option value="">—</option>
                  {(lookups?.warehouses || []).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">{t("production.workflow.selectProduct")}</span>
                <select
                  className="input-field mt-1 w-full"
                  value={materialOptionValue}
                  disabled={!materialWarehouseId || loadingWarehouseProducts}
                  onChange={(e) => handleMaterialProductChange(e.target.value)}
                >
                  <option value="">
                    {!materialWarehouseId
                      ? t("production.workflow.selectWarehouseFirst")
                      : loadingWarehouseProducts
                        ? t("production.workflow.loadingProducts")
                        : "—"}
                  </option>
                  {displayWarehouseProducts.map((p) => (
                    <option key={p.product_id} value={productOptionValue(p)}>{productOptionLabel(p)}</option>
                  ))}
                </select>
              </label>
            </div>

            {selectedProduct ? (
              <p className="mt-2 text-xs">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${
                    stockShortage ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-400"
                  }`}
                >
                  {t("production.workflow.stockAvailable", {
                    stock: formatStockValue(availableStock, productUnit),
                    unit: productUnit,
                  })}
                </span>
              </p>
            ) : null}

            <div className={`mt-3 grid gap-3 ${isAdmin ? "md:grid-cols-3" : "md:grid-cols-1"}`}>
              <label className="block text-sm">
                <span className="text-app-muted">{t("forms.quantity")}</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className={`input-field mt-1 w-full ${stockShortage ? "border-rose-500 ring-1 ring-rose-500/40" : ""}`}
                  value={materialQty}
                  onChange={(e) => setMaterialQty(Number(e.target.value))}
                  disabled={!materialSelection?.productId}
                />
              </label>
              {isAdmin ? (
                <>
                  <div className="rounded-lg border border-app bg-app-surface px-3 py-2 text-sm">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-app-muted">
                      {t("production.workflow.unitCostLabel")}
                    </span>
                    <p className="mt-1 font-mono font-semibold text-app">
                      {selectedProduct ? formatMoney(unitCost, currency) : "—"}
                      {selectedProduct ? ` / ${productUnit}` : ""}
                    </p>
                  </div>
                  <div className="rounded-lg border border-app bg-app-surface px-3 py-2 text-sm">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-app-muted">
                      {t("production.workflow.totalMaterialCost")}
                    </span>
                    <p className={`mt-1 font-mono font-semibold ${stockShortage ? "text-rose-400" : "text-emerald-400"}`}>
                      {selectedProduct ? formatMoney(lineTotalCost, currency) : "—"}
                    </p>
                  </div>
                </>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={saving || !materialWarehouseId || !materialSelection?.productId}
                onClick={() => void addMaterial()}
              >
                {t("production.workflow.addMaterial")}
              </button>
            </div>
          </div>

          <MaterialShortageConfirmModal
            open={shortageConfirmOpen}
            available={availableStock}
            deficit={shortageDelta}
            unit={productUnit}
            loading={saving}
            onConfirm={() => void confirmShortageAddMaterial()}
            onCancel={() => setShortageConfirmOpen(false)}
          />

          {fulfilledPurchaseRequests.length > 0 ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
              <p className="font-semibold text-emerald-200">{t("production.workflow.purchaseRequestFulfilled")}</p>
              <ul className="mt-2 space-y-1 text-xs text-emerald-100">
                {fulfilledPurchaseRequests.map((row) => (
                  <li key={row.id}>
                    {row.request_no}: {row.product_name} — {row.quantity} {row.unit}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {activePurchaseRequests.length > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <p className="font-semibold text-amber-200">{t("production.workflow.purchaseRequests")}</p>
              <ul className="mt-2 space-y-1 text-xs">
                {activePurchaseRequests.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {row.request_no}: {row.product_name} — {row.quantity} {row.unit} ({row.status})
                    </span>
                    {row.purchase_id ? (
                      <Link href="/purchases" className="text-app-accent underline">
                        {t("production.workflow.draftPurchase")}
                      </Link>
                    ) : null}
                    {row.status === "pending" || row.status === "ordered" ? (
                      <button
                        type="button"
                        className="rounded border border-amber-500/50 px-2 py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20"
                        disabled={saving}
                        onClick={() => void cancelPurchaseRequest(row.id)}
                      >
                        {t("production.workflow.cancelPurchaseRequest")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-app">
            <table className="min-w-full text-sm">
              <thead className="bg-app-card-hover/60 text-left text-xs uppercase text-app-muted">
                <tr>
                  <th className="px-3 py-2">№</th>
                  <th className="px-3 py-2">{t("forms.selectProduct")}</th>
                  <th className="px-3 py-2">{t("production.warehouse")}</th>
                  <th className="px-3 py-2 text-right">{t("forms.quantity")}</th>
                  {isAdmin ? (
                    <>
                      <th className="px-3 py-2 text-right">{t("production.unitCost")}</th>
                      <th className="px-3 py-2 text-right">{t("forms.lineTotal")}</th>
                    </>
                  ) : null}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {order.materials.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 5} className="px-3 py-6 text-center text-app-muted">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : (
                  order.materials.map((row, index) => (
                    <tr key={row.id} className="border-t border-app">
                      <td className="px-3 py-2 text-app-muted">{index + 1}</td>
                      <td className="px-3 py-2 font-medium">{row.product_name}</td>
                      <td className="px-3 py-2">{row.warehouse_name || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {row.quantity} {row.unit}
                      </td>
                      {isAdmin ? (
                        <>
                          <td className="px-3 py-2 text-right">{row.unit_cost.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{row.line_cost.toFixed(2)}</td>
                        </>
                      ) : null}
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300"
                          disabled={saving}
                          onClick={() => void deleteMaterial(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("common.delete")}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "services" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-app bg-app-card-hover/40 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm md:col-span-2">
                <span className="text-app-muted">{t("production.workflow.serviceDescription")}</span>
                <input
                  className="input-field mt-1 w-full"
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                  placeholder={t("production.expenseDescription")}
                />
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">{t("production.workflow.category")}</span>
                <select
                  className="input-field mt-1 w-full"
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value as ProductionExpenseCategory)}
                >
                  {WORKFLOW_EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat.labelKey} value={cat.value}>{t(cat.labelKey)}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">{t("production.workflow.contractor")}</span>
                <select
                  className="input-field mt-1 w-full"
                  value={expenseSupplierId}
                  onChange={(e) => setExpenseSupplierId(e.target.value)}
                >
                  <option value="">—</option>
                  {(lookups?.suppliers || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name || s.company_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">{t("production.workflow.amountAzn")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input-field mt-1 w-full"
                  value={expenseAmount || ""}
                  onChange={(e) => setExpenseAmount(Number(e.target.value))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-app-muted">{t("production.workflow.date")}</span>
                <input
                  type="date"
                  className="input-field mt-1 w-full"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                />
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="text-app-muted">{t("production.payFromAccount")}</span>
                <select
                  className="input-field mt-1 w-full"
                  value={expenseAccountId}
                  onChange={(e) => setExpenseAccountId(e.target.value)}
                >
                  <option value="">{t("production.workflow.payLater")}</option>
                  {(lookups?.accounts || []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={saving}
              onClick={() => void addExpense()}
            >
              {t("production.workflow.addExpense")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-app">
            <table className="min-w-full text-sm">
              <thead className="bg-app-card-hover/60 text-left text-xs uppercase text-app-muted">
                <tr>
                  <th className="px-3 py-2">{t("production.workflow.descriptionCol")}</th>
                  <th className="px-3 py-2">{t("production.workflow.category")}</th>
                  <th className="px-3 py-2">{t("production.workflow.contractor")}</th>
                  <th className="px-3 py-2 text-right">{t("production.workflow.amountAzn")}</th>
                  <th className="px-3 py-2">{t("production.workflow.accountCol")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {order.expenses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-app-muted">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : (
                  order.expenses.map((row) => {
                    const contractorMatch = row.notes?.match(/Podratçı:\s*(.+)/);
                    return (
                      <tr key={row.id} className="border-t border-app">
                        <td className="px-3 py-2">{row.description}</td>
                        <td className="px-3 py-2">{expenseCategoryLabel(row.category)}</td>
                        <td className="px-3 py-2">{contractorMatch?.[1] || "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{row.amount.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          {row.account_name ||
                            (row.account_id ? accountsById.get(row.account_id)?.name : null) ||
                            (row.finance_expense_id ? t("production.postedToFinance") : t("production.projectOnlyCost"))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300"
                            disabled={saving}
                            onClick={() => void deleteExpense(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("common.delete")}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "payments" && isAdmin ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              label={t("production.workflow.customerAdvance")}
              value={formatMoney(order.advance_payment, currency)}
            />
            <SummaryCard
              label={t("production.workflow.totalPayouts")}
              value={formatMoney(totalPaidOut, currency)}
            />
            <SummaryCard
              label={t("production.remainingBalance")}
              value={formatMoney(remaining, currency)}
              emphasize={remaining > 0 ? "neutral" : "good"}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-app">
            <table className="min-w-full text-sm">
              <thead className="bg-app-card-hover/60 text-left text-xs uppercase text-app-muted">
                <tr>
                  <th className="px-3 py-2">{t("production.workflow.descriptionCol")}</th>
                  <th className="px-3 py-2">{t("production.workflow.accountCol")}</th>
                  <th className="px-3 py-2 text-right">{t("production.workflow.amountAzn")}</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-app-muted">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : (
                  paymentRows.map((row, index) => (
                    <tr key={`${row.kind}-${index}`} className="border-t border-app">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2">{row.account || "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.amount.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-app-muted">{t("production.workflow.paymentsHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
