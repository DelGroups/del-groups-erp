"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import PageLayout from "@/components/layout/PageLayout";
import DocumentPageHeader from "@/components/documents/DocumentPageHeader";
import ProductionContractPrintTemplate from "@/components/production/ProductionContractPrintTemplate";
import ProductionJobCardPrintTemplate from "@/components/production/ProductionJobCardPrintTemplate";
import ProductionProfitabilityCard, {
  ProductionStatusChip,
} from "@/components/production/ProductionProfitabilityCard";
import { useAuth } from "@/components/auth/AuthProvider";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useDocumentPrint } from "@/hooks/useDocumentPrint";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/lib/supabase";
import { POLYWOOD_INVENTORY_MODE } from "@/lib/polywood/constants";
import { mergeContractDetailFormState } from "@/app/production/contractInsert";
import { sanitizeAddProductionMaterialInput } from "@/app/production/materialInsert";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import { formatProductionDbError } from "@/lib/production/payloads";
import { formatDeliveryActionError, validateCustomDeliveryPreflight, validateSeriesDeliveryPreflight } from "@/lib/production/delivery";
import { withPrintableProductionContract } from "@/lib/production/contracts";
import {
  addProductionMaterialAction,
  addProductionExpenseAction,
  addProductionOutsourcingAction,
  assignProductionContractorAction,
  fetchProductionLookupsAction,
  getProductionOrderAction,
  issueProductionMaterialAction,
  issueProductionStageAction,
  removeProductionExpenseAction,
  removeProductionMaterialAction,
  removeProductionOutsourcingAction,
  saveProductionContractAction,
  syncProductionDeliveryAction,
  updateProductionOrderAction,
  updateProductionStatusAction,
  type ProductionLookups,
} from "@/lib/actions/production";
import { productionModelLabel } from "@/lib/production/models";
import {
  PRODUCTION_EXPENSE_CATEGORIES,
  PRODUCTION_STATUS_NEXT,
  calcProductionCosting,
  isMissingProductionSchema,
  mergeProductionOrder,
  normalizeProductionStatus,
  remainingBalance,
  normalizeStatus,
  type ProductionExpenseCategory,
  type ProductionMaterial,
  type ProductionOrder,
  type ProductionStatus,
} from "@/lib/production/types";
import { Boxes, CircleDollarSign, Factory, LayoutDashboard, Printer, Save, ScanBarcode } from "lucide-react";

type ProjectTab = "overview" | "materials" | "expenses";
const PROJECT_TABS: ProjectTab[] = ["overview", "materials", "expenses"];

export default function ProductionOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { t } = useI18n();
  const { can } = useAuth();
  const canManage = can("can_manage_production");
  const canIssue =
    canManage || can("can_writeoff_inventory") || can("can_manage_warehouses");
  const [order, setOrder] = useState<ProductionOrder | null>(null);
  const [lookups, setLookups] = useState<ProductionLookups | null>(null);
  const [companyName, setCompanyName] = useState("DEL GROUPS MMC");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProjectTab>("overview");
  const loadErrorLabel = t("production.loadError");
  const { printData, setPrintData } = useDocumentPrint<{
    mode: "contract" | "job-card";
    order: ProductionOrder;
  }>();

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
  const [materialStageNo, setMaterialStageNo] = useState("1");
  const [materialStageLabel, setMaterialStageLabel] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [issueNow, setIssueNow] = useState(false);
  const [polywoodMode, setPolywoodMode] = useState<"linear_m" | "full_sheet">("linear_m");

  const [outDesc, setOutDesc] = useState("");
  const [outSupplierId, setOutSupplierId] = useState("");
  const [outSqm, setOutSqm] = useState("0");
  const [outPrice, setOutPrice] = useState("0");

  const [contractorId, setContractorId] = useState("");
  const [contractorName, setContractorName] = useState("");

  const [expenseCategory, setExpenseCategory] = useState<ProductionExpenseCategory>("transport");
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("0");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [advanceAccountId, setAdvanceAccountId] = useState("");

  const { message: toastMessage, showError: showToastError } = useToast();
  const [actionError, setActionError] = useState<string | null>(null);

  const showDeliveryError = useCallback(
    (raw?: string | null) => {
      const message = formatDeliveryActionError(raw, t);
      setActionError(message);
      showToastError(message);
    },
    [showToastError, t]
  );

  const applyOrder = useCallback((next: ProductionOrder, options?: { syncHeader?: boolean; merge?: boolean; dropTempMaterials?: boolean }) => {
    setOrder((prev) => {
      const base =
        options?.dropTempMaterials && prev
          ? { ...prev, materials: prev.materials.filter((row) => !row.id.startsWith("temp-")) }
          : prev;
      const merged = options?.merge && base ? mergeProductionOrder(base, next) : next;
      if (options?.merge && next.materials.length) {
        const maxStage = merged.materials.reduce((max, row) => Math.max(max, row.stage_no || 1), 1);
        queueMicrotask(() => setMaterialStageNo(String(maxStage)));
      }
      return merged;
    });
    if (options?.syncHeader) {
      setProjectName(next.project_name);
      setTotalPrice(String(next.total_project_price));
      setInstallFee(String(next.installation_fee));
      setAdvance(String(next.advance_payment));
      setAdvanceAccountId(next.advance_account_id || "");
      setDeliveryDate(next.expected_delivery_date || "");
      setScope(next.project_scope || "");
      setTerms(next.terms || "");
      setNotes(next.notes || "");
    }
    if (options?.syncHeader || !options?.merge) {
      const current = next.contractors[0];
      setContractorId(current?.contractor_id || "");
      setContractorName(current?.contractor_name || "");
      const maxStage = next.materials.reduce((max, row) => Math.max(max, row.stage_no || 1), 1);
      setMaterialStageNo(String(maxStage));
      setIssueNow(normalizeProductionStatus(next.status) !== "Draft");
    }
  }, []);
  const applyOrderRef = useRef(applyOrder);
  const loadErrorLabelRef = useRef(loadErrorLabel);

  useEffect(() => {
    applyOrderRef.current = applyOrder;
    loadErrorLabelRef.current = loadErrorLabel;
  }, [applyOrder, loadErrorLabel]);

  useEffect(() => {
    if (!id) {
      queueMicrotask(() => {
        setLoading(false);
        setError(loadErrorLabelRef.current);
      });
      return;
    }

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError(null);
    });

    void (async () => {
      try {
        const [orderRes, settingsRes] = await Promise.all([
          getProductionOrderAction(id),
          supabase.from("settings").select("company_name").limit(1).maybeSingle(),
        ]);
        if (!active) return;

        if (!orderRes.success) {
          setError(orderRes.error || loadErrorLabelRef.current);
          setOrder(null);
        } else if (!orderRes.data) {
          setError(loadErrorLabelRef.current);
          setOrder(null);
        } else {
          applyOrderRef.current(orderRes.data, { syncHeader: true });
        }

        if (settingsRes.data?.company_name) {
          setCompanyName(settingsRes.data.company_name as string);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : loadErrorLabelRef.current);
        setOrder(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (loading || !order || lookups) return;
    let active = true;
    void fetchProductionLookupsAction().then((lookupsRes) => {
      if (active && lookupsRes.success && lookupsRes.data) setLookups(lookupsRes.data);
    });
    return () => {
      active = false;
    };
  }, [loading, lookups, order]);

  const productsById = useMemo(
    () => new Map((lookups?.products || []).map((product) => [product.id, product])),
    [lookups?.products]
  );
  const productsByScanKey = useMemo(() => {
    const map = new Map<string, ProductionLookups["products"][number]>();
    for (const product of lookups?.products || []) {
      if (product.barcode?.trim()) map.set(product.barcode.trim().toLocaleLowerCase(), product);
      if (product.code?.trim()) map.set(product.code.trim().toLocaleLowerCase(), product);
    }
    return map;
  }, [lookups?.products]);
  const selectedProduct = productsById.get(materialProductId);
  const isPolywood = selectedProduct?.inventory_mode === POLYWOOD_INVENTORY_MODE;
  const liveRemaining = useMemo(
    () => remainingBalance(Number(totalPrice) || 0, Number(installFee) || 0, Number(advance) || 0),
    [advance, installFee, totalPrice]
  );

  const stages = useMemo(() => {
    const map = new Map<number, { label: string | null; rows: ProductionMaterial[] }>();
    for (const row of order?.materials || []) {
      const current = map.get(row.stage_no) || { label: row.stage_label, rows: [] };
      if (!current.label && row.stage_label) current.label = row.stage_label;
      current.rows.push(row);
      map.set(row.stage_no, current);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [order?.materials]);
  const previewOrder = useMemo(
    () =>
      order
        ? {
            ...order,
            total_project_price: Number(totalPrice) || 0,
            installation_fee: Number(installFee) || 0,
            advance_payment: Number(advance) || 0,
          }
        : null,
    [advance, installFee, order, totalPrice]
  );
  const previewCosting = useMemo(
    () => (previewOrder ? calcProductionCosting(previewOrder) : null),
    [previewOrder]
  );
  const orderFlags = useMemo(() => {
    const status = normalizeProductionStatus(order?.status || "Draft");
    return {
      status,
      nextStatus: PRODUCTION_STATUS_NEXT[status],
      isDelivered: status === "Delivered",
      isDraft: status === "Draft",
      showOutsourcing: order?.type === "Custom",
      showContractor: order?.production_model === "subcontractor_custom",
      showContract: order?.type === "Custom",
    };
  }, [order?.custom_workflow, order?.status, order?.type]);
  const deliverForm = useMemo(
    () => ({
      totalProjectPrice: Number(totalPrice) || 0,
      advancePayment: Number(advance) || 0,
      advanceAccountId: advanceAccountId || null,
    }),
    [advance, advanceAccountId, totalPrice]
  );
  const deliverPreflight = useMemo(() => {
    if (!order || order.type !== "Custom") return { ok: true as const };
    return validateCustomDeliveryPreflight(order, deliverForm);
  }, [deliverForm, order]);
  const finishedProduct = useMemo(
    () =>
      order?.finished_product_id ? productsById.get(order.finished_product_id) || null : null,
    [order?.finished_product_id, productsById]
  );
  const seriesDeliverPreflight = useMemo(() => {
    if (!order || order.type !== "Series") return { ok: true as const };
    return validateSeriesDeliveryPreflight(order, finishedProduct?.sell_price);
  }, [finishedProduct?.sell_price, order]);
  const deliverReady =
    order?.type === "Custom" &&
    orderFlags.nextStatus === "Delivered" &&
    deliverPreflight.ok;
  const seriesDeliverReady =
    order?.type === "Series" &&
    orderFlags.nextStatus === "Delivered" &&
    seriesDeliverPreflight.ok;
  const materialLinePreview = useMemo(
    () => ({
      stock: Number(selectedProduct?.stock || 0),
      unit: selectedProduct?.unit || "",
      subtotal: (Number(materialQty) || 0) * Number(selectedProduct?.buy_price || 0),
      lowStock: Boolean(selectedProduct) && Number(selectedProduct?.stock || 0) < Number(materialQty || 0),
    }),
    [materialQty, selectedProduct]
  );

  const run = useCallback(
    async (
      fn: () => Promise<{ success: boolean; error?: string; data?: ProductionOrder }>,
      options?: {
        syncHeader?: boolean;
        merge?: boolean;
        localPatch?: (prev: ProductionOrder) => ProductionOrder;
        toastOnError?: boolean;
        formatError?: (raw?: string | null) => string;
      }
    ) => {
      let snapshot: ProductionOrder | null = null;
      if (options?.localPatch) {
        setOrder((prev) => {
          if (!prev) return prev;
          snapshot = prev;
          return options.localPatch!(prev);
        });
      }
      setSaving(true);
      setActionError(null);
      const result = await fn();
      setSaving(false);
      if (!result.success) {
        if (snapshot) setOrder(snapshot);
        const format = options?.formatError || formatProductionDbError;
        const message = format(result.error);
        setActionError(message);
        if (options?.toastOnError) showToastError(message);
        return;
      }
      if (result.data) {
        applyOrder(result.data, {
          syncHeader: options?.syncHeader,
          merge: options?.merge,
          dropTempMaterials: Boolean(options?.localPatch),
        });
      }
    },
    [applyOrder, showToastError]
  );

  const handleSaveHeader = () =>
    run(
      () =>
        updateProductionOrderAction(id, {
        project_name: projectName,
        total_project_price: Number(totalPrice) || 0,
        installation_fee: Number(installFee) || 0,
        advance_payment: Number(advance) || 0,
        advance_account_id: Number(advance) > 0 ? advanceAccountId || null : null,
        expected_delivery_date: deliveryDate || null,
        project_scope: scope,
        terms,
        notes,
        }),
      { syncHeader: true }
    );

  const handleStatus = (next: ProductionStatus) => {
    const status = normalizeStatus(next) as ProductionStatus;
    if (status === normalizeStatus(order?.status || "")) return;
    return run(() => updateProductionStatusAction(id, status), {
      toastOnError: status === "In-Progress" || status === "Ready",
      formatError:
        status === "In-Progress"
          ? (raw) => raw?.trim() || t("production.materialIssueFailed")
          : formatProductionDbError,
    });
  };

  const handleSeriesDeliver = () => {
    if (!seriesDeliverPreflight.ok) {
      showDeliveryError(seriesDeliverPreflight.error);
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(t("production.seriesDeliveryConfirm"))) {
      return;
    }
    return run(
      () =>
        updateProductionStatusAction(id, "Delivered", {
          advanceAccountId: Number(advance) > 0 ? advanceAccountId || order?.advance_account_id : null,
        }),
      {
        toastOnError: true,
        formatError: (raw) => formatDeliveryActionError(raw, t),
      }
    );
  };

  const handleDeliver = () => {
    if (!deliverPreflight.ok) {
      showDeliveryError(deliverPreflight.error);
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(t("production.deliveryConfirm"))) {
      return;
    }
    return run(
      () =>
        updateProductionStatusAction(id, "Delivered", {
          advanceAccountId: Number(advance) > 0 ? advanceAccountId : null,
          header: {
            project_name: projectName,
            total_project_price: Number(totalPrice) || 0,
            installation_fee: Number(installFee) || 0,
            advance_payment: Number(advance) || 0,
            expected_delivery_date: deliveryDate || null,
            project_scope: scope,
            terms,
            notes,
          },
        }),
      {
        toastOnError: true,
        formatError: (raw) => formatDeliveryActionError(raw, t),
      }
    );
  };

  const handleSyncDelivery = () => {
    if (typeof window !== "undefined" && !window.confirm(t("production.deliverySyncConfirm"))) {
      return;
    }
    return run(
      () =>
        syncProductionDeliveryAction(id, Number(advance) > 0 ? advanceAccountId || null : null),
      {
        syncHeader: true,
        toastOnError: true,
        formatError: (raw) => formatDeliveryActionError(raw, t),
      }
    );
  };

  const handleAddMaterial = (productId = materialProductId) => {
    const product = productsById.get(productId);
    const warehouse = lookups?.warehouses.find((w) => w.id === materialWarehouseId);
    const qty = Number(materialQty) || 0;
    const unitCost = Number(product?.buy_price || 0);
    const rowPolywood = product?.inventory_mode === POLYWOOD_INVENTORY_MODE;
    const tempId = `temp-${Date.now()}`;

    return run(
      async () => {
        const result = await addProductionMaterialAction(id, sanitizeAddProductionMaterialInput({
          product_id: productId,
          warehouse_id: materialWarehouseId || null,
          warehouse_name: warehouse?.name || null,
          quantity: qty,
          polywood_sale_mode: rowPolywood ? polywoodMode : null,
          stage_no: Number(materialStageNo) || 1,
          stage_label: materialStageLabel || null,
          notes: materialNotes || null,
          issue_now: issueNow,
        }));
        if (result.success) {
          setMaterialProductId("");
          setMaterialQty("1");
          setMaterialNotes("");
        }
        return result;
      },
      {
        merge: true,
        localPatch: (prev) => ({
          ...prev,
          materials: [
            ...prev.materials,
            {
              id: tempId,
              production_order_id: id,
              product_id: productId,
              product_code: product?.code || null,
              product_name: product?.name || "",
              warehouse_id: materialWarehouseId || null,
              warehouse_name: warehouse?.name || null,
              quantity: qty,
              unit: product?.unit || "Ədəd",
              unit_cost: unitCost,
              line_cost: qty * unitCost,
              inventory_mode: rowPolywood ? POLYWOOD_INVENTORY_MODE : "standard",
              polywood_sale_mode: rowPolywood ? polywoodMode : null,
              polywood_length_m: null,
              stage_no: Number(materialStageNo) || 1,
              stage_label: materialStageLabel || null,
              notes: materialNotes || null,
              issued: issueNow,
              issued_at: null,
              created_by_name: null,
            },
          ],
        }),
      }
    );
  };

  useBarcodeScanner(
    (barcode) => {
      const value = barcode.trim().toLocaleLowerCase();
      const product = productsByScanKey.get(value);
      if (!product) {
        setScanNotice(t("production.scanNotFound", { barcode }));
        window.setTimeout(() => setScanNotice(null), 3000);
        return;
      }
      setTab("materials");
      setMaterialProductId(product.id);
      setScanNotice(
        t("production.scanAdding", {
          name: product.name,
          stock: Number(product.stock || 0),
        })
      );
      void handleAddMaterial(product.id);
      window.setTimeout(() => setScanNotice(null), 3000);
    },
    {
      enabled:
        Boolean(order) &&
        canIssue &&
        normalizeProductionStatus(order?.status || "") !== "Delivered" &&
        !saving,
    }
  );

  const handleAddOutsourcing = () => {
    const supplier = lookups?.suppliers.find((s) => s.id === outSupplierId);
    return run(
      async () => {
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
    },
      { merge: true }
    );
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

  const handleAddExpense = () => {
    const account = lookups?.accounts.find((a) => a.id === expenseAccountId);
    return run(
      async () => {
      const result = await addProductionExpenseAction(id, {
        category: expenseCategory,
        description: expenseDesc,
        amount: Number(expenseAmount) || 0,
        expense_date: expenseDate || null,
        account_id: expenseAccountId || null,
        account_name: account?.name || null,
      });
      if (result.success) {
        setExpenseDesc("");
        setExpenseAmount("0");
      }
      return result;
    },
      { merge: true }
    );
  };

  const handlePrintContract = async () => {
    const draftOrder = order
      ? mergeContractDetailFormState(order, {
          terms,
          projectScope: scope,
          deliveryDate,
          advance,
          projectPrice: totalPrice,
          installFee,
          notes,
        })
      : null;

    const headerSaved = await updateProductionOrderAction(id, {
      project_name: projectName,
      total_project_price: Number(totalPrice) || 0,
      installation_fee: Number(installFee) || 0,
      advance_payment: Number(advance) || 0,
      advance_account_id: Number(advance) > 0 ? advanceAccountId || null : null,
      expected_delivery_date: deliveryDate || null,
      project_scope: scope,
      terms,
      notes,
    });
    if (!headerSaved.success) {
      setActionError(formatProductionDbError(headerSaved.error));
      return;
    }
    if (headerSaved.data) applyOrder(headerSaved.data, { syncHeader: true });

    const result = await saveProductionContractAction(id);
    if (result.success && result.data) {
      applyOrder(result.data);
      setPrintData({ mode: "contract", order: result.data });
      return;
    }
    if (draftOrder) {
      setPrintData({
        mode: "contract",
        order: withPrintableProductionContract(draftOrder),
      });
      if (
        result.error &&
        !/production_contracts|schema cache|Could not find the '[^']+' column/i.test(result.error)
      ) {
        setActionError(formatProductionDbError(result.error));
      }
      return;
    }
    setActionError(formatProductionDbError(result.error));
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
        {error && isMissingProductionSchema(error) && (
          <p className="px-6 text-sm text-app-muted">{t("production.missingTablesHint")}</p>
        )}
      </PageLayout>
    );
  }

  const { status, nextStatus, isDelivered, isDraft, showOutsourcing, showContractor, showContract } = orderFlags;

  return (
    <PageLayout>
      <DocumentPageHeader
        icon={<Factory className="h-6 w-6 text-app-accent" />}
        title={`${order.order_no} · ${order.project_name}`}
        description={productionModelLabel(order.production_model)}
        backLink={{ href: "/production", label: t("production.boardTitle") }}
      />

      <div className="flex-1 overflow-auto">
        <div className="sticky top-0 z-30 border-b border-app bg-app-surface/95 px-4 py-3 shadow-sm backdrop-blur md:px-6">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
            <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl border border-app bg-app p-1">
              {PROJECT_TABS.map((item) => {
                const Icon =
                  item === "overview"
                    ? LayoutDashboard
                    : item === "materials"
                      ? Boxes
                      : CircleDollarSign;
                return (
                  <button
                    key={item}
                    type="button"
                    className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${
                      tab === item
                        ? "bg-app-accent text-white shadow-sm"
                        : "text-app-muted hover:bg-app-card-hover hover:text-app"
                    }`}
                    onClick={() => setTab(item)}
                  >
                    <Icon className="h-4 w-4" />
                    {t(`production.tabs.${item}`)}
                  </button>
                );
              })}
            </nav>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setPrintData({ mode: "job-card", order })}
              >
                <Printer className="h-3.5 w-3.5" />
                {t("production.jobCardPrint")}
              </button>
              {showContract && (
                <button type="button" className="btn-secondary text-xs" onClick={handlePrintContract}>
                  <Printer className="h-3.5 w-3.5" />
                  {t("production.contract.print")}
                </button>
              )}
              {canManage && (
                <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={handleSaveHeader}>
                  <Save className="h-3.5 w-3.5" />
                  {t("common.save")}
                </button>
              )}
              {canManage && nextStatus && (
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={
                    saving ||
                    (order.type === "Custom" && nextStatus === "Delivered" && !deliverReady) ||
                    (order.type === "Series" && nextStatus === "Delivered" && !seriesDeliverReady)
                  }
                  title={
                    order.type === "Custom" && nextStatus === "Delivered" && !deliverPreflight.ok
                      ? deliverPreflight.error
                      : order.type === "Series" && nextStatus === "Delivered" && !seriesDeliverPreflight.ok
                        ? seriesDeliverPreflight.error
                        : undefined
                  }
                  onClick={() => {
                    if (order.type === "Custom" && nextStatus === "Delivered") {
                      void handleDeliver();
                      return;
                    }
                    if (order.type === "Series" && nextStatus === "Delivered") {
                      void handleSeriesDeliver();
                      return;
                    }
                    void handleStatus(nextStatus);
                  }}
                >
                  {t(`production.advanceTo.${nextStatus}`)}
                </button>
              )}
              {canManage && order.type === "Custom" && !order.sale_id && (
                <button
                  type="button"
                  className="btn-secondary border-amber-500/40 text-xs text-amber-800 dark:text-amber-200"
                  disabled={saving}
                  title={t("production.deliverySyncHint")}
                  onClick={() => void handleSyncDelivery()}
                >
                  {t("production.deliverySync")}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
        {error && <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {actionError && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
        )}
        {order.type === "Custom" && orderFlags.nextStatus === "Delivered" && !deliverPreflight.ok && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            {deliverPreflight.error}
          </div>
        )}
        {order.type === "Series" && orderFlags.nextStatus === "Delivered" && !seriesDeliverPreflight.ok && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            {seriesDeliverPreflight.error}
          </div>
        )}
        {scanNotice && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
            {scanNotice}
          </div>
        )}

        <ProductionProfitabilityCard
          order={previewOrder || order}
          costing={previewCosting || undefined}
        />

        {isDelivered && order.type === "Custom" && !order.sale_id && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
            <p className="font-semibold">{t("production.deliveryMissingTitle")}</p>
            <p className="mt-1 text-xs opacity-90">{t("production.deliveryMissingHint")}</p>
          </div>
        )}

        {isDelivered && order.type === "Series" && order.customer_id && !order.sale_id && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
            <p className="font-semibold">{t("production.seriesDeliveryMissingTitle")}</p>
            <p className="mt-1 text-xs opacity-90">{t("production.seriesDeliveryMissingHint")}</p>
          </div>
        )}

        {isDelivered && ((order.type === "Custom" && order.sale_id) || (order.type === "Series" && order.sale_id)) && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            <p className="font-semibold">{t("production.deliveryIntegratedTitle")}</p>
            <p className="mt-1 text-xs opacity-90">
              {order.type === "Series"
                ? t("production.seriesDeliveryIntegratedHint")
                : t("production.deliveryIntegratedHint")}
            </p>
            {order.sale_id && (
              <a href="/sales" className="mt-2 inline-block text-xs font-semibold underline">
                {t("production.viewSalesInvoice")}
              </a>
            )}
          </div>
        )}

        {isDelivered && order.type === "Series" && !order.customer_id && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            <p className="font-semibold">{t("production.seriesStockOutTitle")}</p>
            <p className="mt-1 text-xs opacity-90">{t("production.seriesStockOutHint")}</p>
          </div>
        )}

        {tab === "overview" && (
          <>
            <section className="app-card p-4 md:p-5">
              <div className="mb-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-app-muted">{t("production.orderCard")}</p>
                <h3 className="text-base font-bold text-app">{t("production.projectDetails")}</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
                <label className="text-xs font-semibold text-app xl:col-span-6">
                  {t("production.projectName")}
                  <input
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={projectName}
                    disabled={!canManage}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </label>
                <div className="text-xs font-semibold text-app xl:col-span-6">
                  <span className="block">{t("sales.customer")}</span>
                  <div className="mt-1 min-h-10 rounded-lg border border-app bg-app px-3 py-2 text-sm">
                    {order.customer_name || order.customer_id ? (
                      order.customer_name || order.customer_id
                    ) : (
                      <span className="text-red-600">{t("production.deliveryRequiresCustomer")}</span>
                    )}
                  </div>
                </div>
                <div className="text-xs font-semibold text-app xl:col-span-3">
                  <span className="block">{t("common.status")}</span>
                  <div className="mt-1 flex min-h-10 items-center rounded-lg border border-app bg-app px-3">
                    <ProductionStatusChip status={status} />
                  </div>
                </div>
                <label className="text-xs font-semibold text-app xl:col-span-3">
                  {t("production.totalProjectPrice")}
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={totalPrice}
                    disabled={!canManage || order.type === "Series"}
                    onChange={(e) => setTotalPrice(e.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold text-app xl:col-span-3">
                  {t("production.installationFee")}
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={installFee}
                    disabled={!canManage || order.type === "Series"}
                    onChange={(e) => setInstallFee(e.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold text-app xl:col-span-3">
                  {t("production.advancePayment")}
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={advance}
                    disabled={!canManage || order.type === "Series"}
                    onChange={(e) => setAdvance(e.target.value)}
                  />
                </label>
                {Number(advance) > 0 && !isDelivered && (
                  <label className="text-xs font-semibold text-app xl:col-span-6">
                    {t("production.advanceAccount")}
                    <select
                      className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2 text-sm"
                      value={advanceAccountId}
                      disabled={!canManage || order.advance_transaction_id != null}
                      onChange={(e) => setAdvanceAccountId(e.target.value)}
                    >
                      <option value="">{t("production.selectAdvanceAccount")}</option>
                      {(lookups?.accounts || []).map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                          {account.balance != null ? ` (${Number(account.balance).toFixed(2)})` : ""}
                        </option>
                      ))}
                    </select>
                    {order.advance_transaction_id ? (
                      <p className="mt-1 text-[11px] text-emerald-600">{t("production.advancePosted")}</p>
                    ) : null}
                  </label>
                )}
                <label className="text-xs font-semibold text-app xl:col-span-3">
                  {t("production.remainingBalance")}
                  <input
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={liveRemaining.toFixed(2)}
                    disabled
                  />
                </label>
                <label className="text-xs font-semibold text-app xl:col-span-3">
                  {t("production.expectedDelivery")}
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    value={deliveryDate}
                    disabled={!canManage}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold text-app md:col-span-2 xl:col-span-6">
                  {t("production.projectScope")}
                  <textarea
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    rows={3}
                    value={scope}
                    disabled={!canManage}
                    onChange={(e) => setScope(e.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold text-app md:col-span-2 xl:col-span-6">
                  {t("production.contract.terms")}
                  <textarea
                    className="mt-1 w-full rounded-lg border border-app bg-app px-3 py-2"
                    rows={4}
                    value={terms}
                    disabled={!canManage || order.type === "Series"}
                    onChange={(e) => setTerms(e.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold text-app md:col-span-2 xl:col-span-12">
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
              {order.type === "Series" && (
                <p className="mt-3 text-xs text-app-muted">
                  {order.customer_id
                    ? t("production.seriesCustomerDeliveryNote")
                    : t("production.seriesRetailNote")}
                </p>
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
                              onClick={() =>
                                run(() => removeProductionOutsourcingAction(id, row.id), {
                                  localPatch: (prev) => ({
                                    ...prev,
                                    outsourcing: prev.outsourcing.filter((item) => item.id !== row.id),
                                  }),
                                })
                              }
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
          </>
        )}

        {tab === "materials" && (
          <section className="app-card p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-app">{t("production.tabs.materials")}</h3>
                <p className="mt-1 text-xs text-app-muted">{t("production.requisitionHint")}</p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-500">
                <ScanBarcode className="h-4 w-4" />
                {t("production.scannerActive")}
              </div>
            </div>

            {stages.length === 0 && <p className="mb-4 text-sm text-app-muted">{t("common.noData")}</p>}

            {stages.map(([stageNo, group]) => {
              const pending = group.rows.filter((row) => !row.issued);
              return (
                <div key={stageNo} className="mb-5 overflow-x-auto rounded-lg border border-app">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-app-card-hover/50 px-3 py-2">
                    <p className="text-sm font-semibold">
                      {t("production.stage")} {stageNo}
                      {group.label ? ` · ${group.label}` : ""}
                    </p>
                    {canIssue && !isDelivered && pending.length > 0 && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={saving}
                        onClick={() => run(() => issueProductionStageAction(id, stageNo), { merge: true })}
                      >
                        {t("production.issueStage")} ({pending.length})
                      </button>
                    )}
                  </div>
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase text-app-muted">
                      <tr>
                        <th className="px-3 py-2">{t("forms.selectProduct")}</th>
                        <th className="px-3 py-2">{t("production.availableStock")}</th>
                        <th className="px-3 py-2">{t("production.warehouse")}</th>
                        <th className="px-3 py-2 text-right">{t("forms.quantity")}</th>
                        <th className="px-3 py-2 text-right">{t("production.unitCost")}</th>
                        <th className="px-3 py-2 text-right">{t("forms.lineTotal")}</th>
                        <th className="px-3 py-2">{t("common.status")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.id} className="border-t border-app">
                          <td className="px-3 py-2">
                            {row.product_name}
                            {row.polywood_sale_mode ? ` · ${row.polywood_sale_mode}` : ""}
                            {row.notes ? <span className="block text-xs text-app-muted">{row.notes}</span> : null}
                          </td>
                          <td className="px-3 py-2">
                            {(() => {
                              const product = row.product_id ? productsById.get(row.product_id) : null;
                              const stock = Number(product?.stock || 0);
                              const enough = stock >= row.quantity;
                              return (
                                <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${
                                  enough ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                                }`}>
                                  {stock} {product?.unit || row.unit}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2">{row.warehouse_name || "-"}</td>
                          <td className="px-3 py-2 text-right">
                            {row.quantity} {row.unit}
                          </td>
                          <td className="px-3 py-2 text-right">{row.unit_cost.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">{row.line_cost.toFixed(2)}</td>
                          <td className="px-3 py-2">
                            <span className={row.issued ? "text-emerald-400" : "text-amber-400"}>
                              {row.issued ? t("production.issued") : t("production.planned")}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canIssue && !row.issued && !isDelivered && (
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  className="text-xs text-app-accent"
                                  onClick={() =>
                                    run(() => issueProductionMaterialAction(id, row.id), { merge: true })
                                  }
                                >
                                  {t("production.issueNow")}
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-red-500"
                                  onClick={() =>
                                    run(() => removeProductionMaterialAction(id, row.id), {
                                      localPatch: (prev) => ({
                                        ...prev,
                                        materials: prev.materials.filter((item) => item.id !== row.id),
                                      }),
                                    })
                                  }
                                >
                                  {t("common.delete")}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}

            {canIssue && !isDelivered && (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6 items-end">
                <select
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm xl:col-span-2"
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
                  <option value="">{t("production.warehouse")}</option>
                  {(lookups?.warehouses || []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.warehouse_type === "polywood" ? " (Polywood)" : ""}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={materialStageNo}
                  onChange={(e) => setMaterialStageNo(e.target.value)}
                  placeholder={t("production.stage")}
                />
                <input
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={materialStageLabel}
                  onChange={(e) => setMaterialStageLabel(e.target.value)}
                  placeholder={t("production.stageLabel")}
                />
                <input
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm xl:col-span-2"
                  value={materialNotes}
                  onChange={(e) => setMaterialNotes(e.target.value)}
                  placeholder={t("common.notes")}
                />
                {isPolywood && (
                  <select
                    className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                    value={polywoodMode}
                    onChange={(e) => setPolywoodMode(e.target.value as "linear_m" | "full_sheet")}
                  >
                    <option value="linear_m">{t("polywood.invoice.modeLinear")}</option>
                    <option value="full_sheet">{t("polywood.invoice.modeFullSheet")}</option>
                  </select>
                )}
                {isDraft && (
                  <label className="flex items-center gap-2 text-xs text-app">
                    <input type="checkbox" checked={issueNow} onChange={(e) => setIssueNow(e.target.checked)} />
                    {t("production.issueNow")}
                  </label>
                )}
                <div className="rounded-lg border border-app bg-app-card-hover/50 px-3 py-2 text-xs">
                  <span className="block text-app-muted">{t("production.stockLineTotal")}</span>
                  <strong className={materialLinePreview.lowStock ? "text-rose-500" : "text-emerald-500"}>
                    {selectedProduct
                      ? `${materialLinePreview.stock} ${materialLinePreview.unit}`
                      : "—"}
                    {" · "}
                    {materialLinePreview.subtotal.toFixed(2)} {t("common.currency")}
                  </strong>
                </div>
                <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={() => handleAddMaterial()}>
                  {t("common.add")}
                </button>
              </div>
            )}
          </section>
        )}

        {tab === "expenses" && (
          <section className="rounded-xl border border-app bg-app-surface p-4">
            <h3 className="mb-1 font-semibold">{t("production.tabs.expenses")}</h3>
            <p className="mb-4 text-xs text-app-muted">{t("production.projectExpensesHint")}</p>
            <table className="mb-3 min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-app-muted">
                <tr>
                  <th className="py-2">{t("common.date")}</th>
                  <th className="py-2">{t("common.category")}</th>
                  <th className="py-2">{t("production.expenseDescription")}</th>
                  <th className="py-2">{t("production.payFromAccount")}</th>
                  <th className="py-2 text-right">{t("common.total")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {order.expenses.length === 0 && (
                  <tr>
                    <td className="py-6 text-center text-app-muted" colSpan={6}>
                      {t("common.noData")}
                    </td>
                  </tr>
                )}
                {order.expenses.map((row) => (
                  <tr key={row.id} className="border-t border-app">
                    <td className="py-2">{row.expense_date || "-"}</td>
                    <td className="py-2">{t(`production.expenseCategory.${row.category}`)}</td>
                    <td className="py-2">
                      {row.description}
                      {row.finance_expense_id ? (
                        <span className="ml-2 text-[11px] text-emerald-400">{t("production.postedToFinance")}</span>
                      ) : (
                        <span className="ml-2 text-[11px] text-app-muted">{t("production.projectOnlyCost")}</span>
                      )}
                    </td>
                    <td className="py-2">{row.account_name || "-"}</td>
                    <td className="py-2 text-right">{row.amount.toFixed(2)}</td>
                    <td className="py-2 text-right">
                      {canManage && !row.finance_expense_id && (
                        <button
                          type="button"
                          className="text-xs text-red-500"
                          onClick={() =>
                            run(() => removeProductionExpenseAction(id, row.id), {
                              localPatch: (prev) => ({
                                ...prev,
                                expenses: prev.expenses.filter((item) => item.id !== row.id),
                              }),
                            })
                          }
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canManage && !isDelivered && (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6 items-end">
                <select
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value as ProductionExpenseCategory)}
                >
                  {PRODUCTION_EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {t(`production.expenseCategory.${cat}`)}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm xl:col-span-2"
                  placeholder={t("production.expenseDescription")}
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                />
                <input
                  type="number"
                  min={0}
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                />
                <input
                  type="date"
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                />
                <select
                  className="rounded-lg border border-app bg-app px-3 py-2 text-sm"
                  value={expenseAccountId}
                  onChange={(e) => setExpenseAccountId(e.target.value)}
                >
                  <option value="">{t("production.projectOnlyCost")}</option>
                  {(lookups?.accounts || []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.balance != null ? ` (${Number(account.balance).toFixed(2)})` : ""}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={handleAddExpense}>
                  {t("common.add")}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      </div>

      {printData && (
        <div className="print-area">
          {printData.mode === "contract" ? (
            <ProductionContractPrintTemplate data={{ companyName, order: printData.order }} />
          ) : (
            <ProductionJobCardPrintTemplate companyName={companyName} order={printData.order} />
          )}
        </div>
      )}
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </PageLayout>
  );
}
