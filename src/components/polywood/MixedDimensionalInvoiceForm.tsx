"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/hooks/useToast";
import ToastMessage from "@/components/ui/ToastMessage";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import {
  validatePaymentRowsRequireAccount,
  validatePaymentsNotExceedTotal,
} from "@/lib/forms/documentPreflight";
import DocumentAdditionalExpensesSection from "@/components/documents/DocumentAdditionalExpensesSection";
import {
  createEmptyDocumentExpense,
  sumDocumentAdditionalExpenses,
  validateDocumentAdditionalExpenses,
  type DocumentAdditionalExpense,
} from "@/lib/forms/documentExpenses";
import { submitSale } from "@/lib/sales/submitSale";
import {
  calcLineTotal,
  calcSaleTotals,
  type Category,
  type Customer,
  type Product,
  type SaleInsert,
  type SaleItem,
  type SalePayment,
  type AccountRow,
  type Warehouse,
} from "@/types/database.types";
import { ensurePolywoodWarehouseAction } from "@/lib/actions/polywood";
import { ensureDefaultServiceProductsAction } from "@/lib/actions/serviceProducts";
import { findOrCreateServiceProduct } from "@/lib/products/api";
import {
  isServiceProduct,
  matchesServiceCategoryName,
} from "@/lib/products/serviceCategory";
import { POLYWOOD_WAREHOUSE_TYPE } from "@/lib/polywood/constants";
import OfficialTransactionSection from "@/components/finance/OfficialTransactionSection";
import OfficialTotalsBreakdown from "@/components/finance/OfficialTotalsBreakdown";
import OfficialPaymentSplitBanner from "@/components/finance/OfficialPaymentSplitBanner";
import { buildOfficialPaymentAccountPatch, formatTreasuryAccountLabel } from "@/lib/finance/officialPaymentAutoFill";
import {
  buildOfficialDocumentFields,
  type OfficialTransactionState,
} from "@/lib/finance/officialTransaction";
import { calcOfficialTransactionTotals } from "@/lib/finance/vatEngine";
import type { VatMode } from "@/lib/finance/vatEngine";
import { useTaxPayrollConfig } from "@/hooks/useTaxPayrollConfig";
import { defaultVatMode, vatRateToNumber } from "@/lib/tax/payrollConfig";
import { DEFAULT_INVOICE_ROW_COUNT } from "@/lib/forms/invoiceDefaults";
import ProductCombobox from "@/components/products/ProductCombobox";
import {
  filterLegalCustomers,
  isLegalEntityWithVoen,
} from "@/lib/customers/entityType";

export const ADHOC_SERVICE_PRODUCT_ID = "__custom_service__";

interface Employee {
  id: string;
  full_name?: string | null;
  name?: string | null;
}

type GridItemType = "polywood" | "sinelik" | "accessory" | "service";
type GridSaleMode = "full_sheet" | "meter";

interface GridRow {
  id: string;
  itemType: GridItemType;
  productId: string;
  saleMode: GridSaleMode;
  /** Sheets (full_sheet) | metres per piece (meter) | qty (accessory/service) */
  amount: number;
  /** Number of identical cuts requested (meter mode only) */
  pieceCount: number;
  unitPrice: number;
  discountPercent: number;
  vatRate: number;
  /** Free-text service name when no catalog service is selected */
  customServiceName: string;
}

function createEmptyRow(): GridRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemType: "polywood",
    productId: "",
    saleMode: "meter",
    amount: 0,
    pieceCount: 1,
    unitPrice: 0,
    discountPercent: 0,
    vatRate: 0,
    customServiceName: "",
  };
}

function createInitialRows(): GridRow[] {
  return Array.from({ length: DEFAULT_INVOICE_ROW_COUNT }, () => createEmptyRow());
}

function isDimensionalLineType(itemType: GridItemType): boolean {
  return itemType === "polywood" || itemType === "sinelik";
}

function normalizeCategory(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function productCategoryName(product: Product): string {
  return normalizeCategory(product.category) || normalizeCategory(product.subcategory);
}

function rowQuantity(row: GridRow): number {
  if (isDimensionalLineType(row.itemType) && row.saleMode === "meter") {
    return (Number(row.amount) || 0) * (Number(row.pieceCount) || 1);
  }
  return Number(row.amount) || 0;
}

function rowTotal(row: GridRow): number {
  return calcLineTotal(rowQuantity(row), row.unitPrice, row.discountPercent);
}

function customerLabel(c: Customer): string {
  return c.full_name || c.name || c.company_name || "—";
}

function employeeLabel(e: Employee): string {
  return e.full_name || e.name || "—";
}

function isServiceLineType(itemType: GridItemType): boolean {
  return itemType === "service";
}

function rowHasProductSelection(row: GridRow): boolean {
  if (row.itemType === "service") {
    if (row.productId && row.productId !== ADHOC_SERVICE_PRODUCT_ID) return true;
    return Boolean(row.customServiceName.trim());
  }
  return Boolean(row.productId);
}

interface MixedDimensionalInvoiceFormProps {
  onClose?: () => void;
  onSuccess?: (saleId?: string) => void;
}

export default function MixedDimensionalInvoiceForm({
  onClose,
  onSuccess,
}: MixedDimensionalInvoiceFormProps) {
  const { t } = useI18n();
  const { profile } = useAuth();
  const { config: taxConfig, loading: taxConfigLoading } = useTaxPayrollConfig();
  const defaultVatRate = vatRateToNumber(taxConfig.default_vat_rate);
  const { message: toastMessage, variant: toastVariant, showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [docNo, setDocNo] = useState("");
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");

  const [rows, setRows] = useState<GridRow[]>(() => createInitialRows());
  const [additionalExpenses, setAdditionalExpenses] = useState<DocumentAdditionalExpense[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [isOfficial, setIsOfficial] = useState(false);
  const [vatMode, setVatMode] = useState<VatMode>("none");
  const [contractId, setContractId] = useState<string | null>(null);
  const [voenVerification, setVoenVerification] = useState("");
  const appliedDefaultVat = useRef(false);

  useEffect(() => {
    if (appliedDefaultVat.current || taxConfigLoading) return;
    appliedDefaultVat.current = true;
    setVatMode(defaultVatMode(taxConfig.default_vat_rate));
  }, [taxConfig.default_vat_rate, taxConfigLoading]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: cust }, { data: emp }, { data: wh }, { data: acc }, { data: prod }, { data: cats }, whResult, seedResult] =
        await Promise.all([
          supabase.from("customers").select("*").order("created_at", { ascending: false }),
          supabase.from("employees").select("*"),
          supabase.from("warehouses").select("*").order("created_at", { ascending: true }),
          supabase.from("accounts").select("*").order("created_at", { ascending: true }),
          supabase.from("products").select("*").order("name", { ascending: true }),
          supabase.from("categories").select("*").order("name", { ascending: true }),
          ensurePolywoodWarehouseAction(),
          ensureDefaultServiceProductsAction(),
        ]);

      let productList = (prod as Product[]) || [];
      if (seedResult.success && seedResult.data?.products?.length) {
        const byId = new Map(productList.map((product) => [product.id, product]));
        for (const product of seedResult.data.products) {
          byId.set(product.id, product);
        }
        productList = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      }

      setCustomers((cust as Customer[]) || []);
      setEmployees((emp as Employee[]) || []);
      setWarehouses((wh as Warehouse[]) || []);
      setAccounts(acc ?? []);
      setProducts(productList);
      setCategories((cats as Category[]) || []);

      const polywoodWarehouseId =
        whResult.success && whResult.data?.warehouse ? whResult.data.warehouse.id : "";
      const defaultWarehouseId =
        polywoodWarehouseId ||
        (wh as Warehouse[] | null)?.find((w) => w.warehouse_type === POLYWOOD_WAREHOUSE_TYPE)?.id ||
        (wh as Warehouse[] | null)?.[0]?.id ||
        "";
      setWarehouseId(defaultWarehouseId);

      setDocNo(`SPW-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!sellerId && profile?.id) {
      setSellerId(profile.id);
      setSellerName(profile.full_name || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );

  const productsForType = useCallback(
    (itemType: GridItemType): Product[] =>
      products.filter((product) => {
        const category = productCategoryName(product);
        switch (itemType) {
          case "polywood":
            return (
              Boolean(product.is_dimensional) &&
              (category === "polywood" ||
                (category !== "sinelik" &&
                  !matchesServiceCategoryName(category) &&
                  !matchesServiceCategoryName(product.subcategory) &&
                  category !== "accessories" &&
                  category !== "accessory" &&
                  category !== "aksessuar"))
            );
          case "sinelik":
            return Boolean(product.is_dimensional) && category === "sinelik";
          case "accessory":
            return !product.is_dimensional && !isServiceProduct(product, categoryById);
          case "service":
            return isServiceProduct(product, categoryById);
          default:
            return false;
        }
      }),
    [products, categoryById]
  );

  const updateRow = (id: string, patch: Partial<GridRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const handleTypeChange = (id: string, itemType: GridItemType) => {
    updateRow(id, {
      itemType,
      productId: "",
      saleMode: "meter",
      amount: itemType === "service" || itemType === "accessory" ? 1 : 0,
      pieceCount: 1,
      unitPrice: 0,
      customServiceName: "",
    });
  };

  const handleProductChange = (id: string, productId: string) => {
    if (productId === ADHOC_SERVICE_PRODUCT_ID) {
      updateRow(id, { productId, unitPrice: 0 });
      return;
    }

    const product = products.find((p) => p.id === productId) || null;
    updateRow(id, {
      productId,
      customServiceName: "",
      unitPrice: product ? Number(product.sell_price) || 0 : 0,
    });
  };

  const addRow = () => setRows((prev) => [...prev, createEmptyRow()]);
  const removeRow = (id: string) => setRows((prev) => prev.filter((row) => row.id !== id));

  const buildSaleItems = useCallback(
    (sourceRows: GridRow[]): SaleItem[] => {
      const warehouse = warehouses.find((w) => w.id === warehouseId);
      return sourceRows
        .filter((row) => rowHasProductSelection(row))
        .map((row) => {
          const product =
            row.productId && row.productId !== ADHOC_SERVICE_PRODUCT_ID
              ? products.find((p) => p.id === row.productId)
              : undefined;
          const serviceName =
            row.itemType === "service" && row.productId === ADHOC_SERVICE_PRODUCT_ID
              ? row.customServiceName.trim()
              : "";
          const quantity = rowQuantity(row);
          const isDimensionalMeter = isDimensionalLineType(row.itemType) && row.saleMode === "meter";
          const saleItemType = isDimensionalLineType(row.itemType)
            ? "dimensional"
            : row.itemType === "service"
              ? "service"
              : "accessory";
          return {
            id: row.id,
            product_id: product?.id || "",
            product_code: product?.code || "",
            product_name: product?.name || serviceName,
            warehouse_id: warehouseId,
            warehouse_name: warehouse?.name || "",
            quantity,
            unit:
              isDimensionalLineType(row.itemType)
                ? row.saleMode === "full_sheet"
                  ? t("polywood.unit.sheet")
                  : t("polywood.unit.meter")
                : isServiceLineType(row.itemType)
                  ? product?.unit || t("polywood.unit.service")
                  : product?.unit || t("polywood.unit.qty"),
            unit_price: row.unitPrice,
            discount_percent: row.discountPercent,
            vat_rate: row.vatRate,
            total: rowTotal(row),
            extra_info: "",
            sale_item_type: saleItemType,
            polywood_sale_mode: isDimensionalLineType(row.itemType) ? row.saleMode : null,
            polywood_length_m: isDimensionalMeter ? row.amount : null,
            piece_count: isDimensionalMeter ? row.pieceCount : 1,
          } as SaleItem;
        });
    },
    [products, warehouses, warehouseId, t]
  );

  const saleItems = useMemo(() => buildSaleItems(rows), [buildSaleItems, rows]);

  const additionalExpensesTotal = useMemo(
    () => sumDocumentAdditionalExpenses(additionalExpenses),
    [additionalExpenses]
  );

  const totals = useMemo(
    () => calcSaleTotals(saleItems, payments, "free", 0, additionalExpensesTotal),
    [saleItems, payments, additionalExpensesTotal]
  );

  const itemsNetTotal = totals.subtotal - totals.discount_total;
  const officialAmounts = useMemo(
    () =>
      calcOfficialTransactionTotals(itemsNetTotal, {
        isOfficial,
        vatMode,
        vatRate: defaultVatRate,
        additionalExpensesTotal,
      }),
    [itemsNetTotal, isOfficial, vatMode, defaultVatRate, additionalExpensesTotal]
  );

  const displayTotals = useMemo(
    () =>
      isOfficial
        ? {
            ...totals,
            vat_total: officialAmounts.vat_amount,
            grand_total: officialAmounts.grand_total,
            remaining_balance: officialAmounts.grand_total - totals.paid_amount,
          }
        : totals,
    [isOfficial, totals, officialAmounts]
  );

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerOptions = useMemo(
    () => (isOfficial ? filterLegalCustomers(customers) : customers),
    [customers, isOfficial]
  );

  useEffect(() => {
    if (!isOfficial || !customerId) return;
    const current = customers.find((c) => c.id === customerId);
    if (current && !isLegalEntityWithVoen(current)) {
      setCustomerId("");
      setCustomerName("");
      setContractId(null);
      setVoenVerification("");
    }
  }, [isOfficial, customerId, customers]);

  const addPaymentRow = () =>
    setPayments((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, account_id: "", method: "cash", amount: 0 },
    ]);
  const updatePayment = (id: string, patch: Partial<SalePayment>) =>
    setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const handleAccountChange = (paymentId: string, accountId: string) => {
    const patch = buildOfficialPaymentAccountPatch(
      accountId,
      paymentId,
      accounts,
      officialAmounts,
      payments,
      isOfficial
    );
    updatePayment(paymentId, patch);
  };
  const removePayment = (id: string) => setPayments((prev) => prev.filter((p) => p.id !== id));

  const handleSubmit = async () => {
    if (saleItems.length === 0) {
      showError(t("invoice.addProductAlert"));
      return;
    }
    if (!warehouseId) {
      showError(t("forms.selectWarehouse"));
      return;
    }
    for (const row of rows) {
      if (!rowHasProductSelection(row)) continue;
      if (rowQuantity(row) <= 0) {
        showError(t("invoice.insufficientStock", { product: "-", available: "0", requested: "0" }));
        return;
      }
      if (
        row.itemType === "service" &&
        row.productId === ADHOC_SERVICE_PRODUCT_ID &&
        !row.customServiceName.trim()
      ) {
        showError(t("polywood.service.nameRequired"));
        return;
      }
    }

    const preparedRows: GridRow[] = [];
    for (const row of rows) {
      if (
        row.itemType === "service" &&
        (!row.productId || row.productId === ADHOC_SERVICE_PRODUCT_ID)
      ) {
        const serviceName = row.customServiceName.trim();
        if (!serviceName) continue;

        const created = await findOrCreateServiceProduct(serviceName, row.unitPrice, categories);
        if (!created.ok || !created.product) {
          showError(
            formatRpcError(created.error, t) ??
              created.error ??
              t("polywood.service.createFailed")
          );
          return;
        }

        preparedRows.push({
          ...row,
          productId: created.product.id,
          customServiceName: "",
        });
        continue;
      }

      preparedRows.push(row);
    }

    const itemsToSubmit = buildSaleItems(preparedRows);
    if (itemsToSubmit.length === 0) {
      showError(t("invoice.addProductAlert"));
      return;
    }

    const totalsForSubmit = calcSaleTotals(
      itemsToSubmit,
      payments,
      "free",
      0,
      additionalExpensesTotal
    );
    const netForSubmit = totalsForSubmit.subtotal - totalsForSubmit.discount_total;
    const officialForSubmit = calcOfficialTransactionTotals(netForSubmit, {
      isOfficial,
      vatMode,
      vatRate: defaultVatRate,
      additionalExpensesTotal,
    });
    const finalGrandTotal = isOfficial ? officialForSubmit.grand_total : totalsForSubmit.grand_total;

    if (isOfficial && !contractId) {
      showError(t("official.contractRequired"));
      return;
    }
    if (isOfficial && selectedCustomer && !isLegalEntityWithVoen(selectedCustomer)) {
      showError(t("official.noLegalCustomers"));
      return;
    }

    const expenseError = validateDocumentAdditionalExpenses(additionalExpenses);
    if (expenseError) {
      showError(expenseError);
      return;
    }
    const paymentAccountIssue = validatePaymentRowsRequireAccount(payments);
    if (paymentAccountIssue) {
      showError(t(paymentAccountIssue.key, paymentAccountIssue.params));
      return;
    }
    const paymentsExceedIssue = validatePaymentsNotExceedTotal(
      totalsForSubmit.paid_amount,
      finalGrandTotal
    );
    if (paymentsExceedIssue) {
      showError(t(paymentsExceedIssue.key, paymentsExceedIssue.params));
      return;
    }

    setSaving(true);
    const officialState: OfficialTransactionState = {
      isOfficial,
      contractId,
      vatMode: isOfficial ? vatMode : "none",
      voenVerification,
    };
    const officialFields = buildOfficialDocumentFields(officialState, officialForSubmit);

    const header: SaleInsert = {
      doc_no: docNo,
      doc_date: docDate,
      customer_id: customerId || null,
      customer_name: customerName || null,
      seller_id: sellerId || null,
      seller_name: sellerName || null,
      warehouse_name: warehouses.find((w) => w.id === warehouseId)?.name || null,
      subtotal: totalsForSubmit.subtotal,
      discount_total: totalsForSubmit.discount_total,
      vat_total: isOfficial ? officialForSubmit.vat_amount : totalsForSubmit.vat_total,
      total_amount: finalGrandTotal,
      paid_amount: totalsForSubmit.paid_amount,
      remaining_balance: finalGrandTotal - totalsForSubmit.paid_amount,
      notes: notes || null,
    } as SaleInsert;

    const result = await submitSale({
      header,
      items: itemsToSubmit,
      payments,
      docNo,
      additionalExpenses,
      officialFields,
    });
    setSaving(false);

    if (!result.success) {
      showError(formatRpcError(result.error, t) ?? result.error ?? t("common.error"));
      return;
    }

    showSuccess(t("common.success"));
    onSuccess?.(result.saleId);
  };

  if (loading) {
    return (
      <div className="app-card p-8 text-center text-sm text-app-muted">{t("common.loading")}</div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <header className="app-glass flex flex-wrap items-center justify-between gap-3 border-b border-app px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-app">{t("polywood.mixedInvoiceTitle")}</h2>
            <p className="text-xs text-app-muted">
              {t("invoice.docNoLabel")}: <span className="font-mono text-app-accent">{docNo}</span>
            </p>
          </div>
          {onClose ? (
            <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-app-card-hover">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </header>

        <div className="grid grid-cols-1 gap-4 px-6 md:grid-cols-4">
          <label className="text-xs font-semibold text-app">
            {t("invoice.docDate")}
            <input
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
              className="app-input mt-1 w-full text-sm"
            />
          </label>

          <label className="text-xs font-semibold text-app">
            {t("common.customer")}
            <select
              value={customerId}
              onChange={(e) => {
                const id = e.target.value;
                setCustomerId(id);
                const c = customers.find((x) => x.id === id);
                setCustomerName(c ? customerLabel(c) : "");
                if (isOfficial && c?.voen) setVoenVerification(c.voen);
                if (!id) {
                  setContractId(null);
                  setVoenVerification("");
                }
              }}
              className="app-input mt-1 w-full text-sm"
            >
              <option value="">{t("invoice.anonymousCustomer")}</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {customerLabel(c)}
                </option>
              ))}
            </select>
            {isOfficial && customerOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">{t("official.noLegalCustomers")}</p>
            )}
          </label>

          <label className="text-xs font-semibold text-app">
            {t("invoice.seller")}
            <select
              value={sellerId}
              onChange={(e) => {
                const id = e.target.value;
                setSellerId(id);
                const emp = employees.find((x) => x.id === id);
                setSellerName(emp ? employeeLabel(emp) : "");
              }}
              className="app-input mt-1 w-full text-sm"
            >
              <option value="">{t("forms.notSelected")}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {employeeLabel(emp)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold text-app">
            {t("common.warehouse")}
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="app-input mt-1 w-full text-sm"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="px-6">
          <OfficialTransactionSection
            transactionType="sale"
            partyId={customerId || null}
            partyName={customerName}
            partyVoen={selectedCustomer?.voen}
            isOfficial={isOfficial}
            onIsOfficialChange={setIsOfficial}
            vatMode={vatMode}
            onVatModeChange={setVatMode}
            contractId={contractId}
            onContractIdChange={setContractId}
            voenVerification={voenVerification}
            onVoenVerificationChange={setVoenVerification}
          />
        </div>

        <div className="px-6">
          <div className="app-table-wrap">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-app-card-hover font-bold uppercase text-app">
                <tr>
                  <th className="p-2">{t("polywood.grid.type")}</th>
                  <th className="p-2">{t("polywood.grid.product")}</th>
                  <th className="p-2">{t("polywood.grid.unit")}</th>
                  <th className="p-2 text-right">{t("polywood.grid.lengthQty")}</th>
                  <th className="p-2 text-right">{t("polywood.grid.unitPrice")}</th>
                  <th className="p-2 text-right">{t("common.total")}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-app">
                {rows.map((row) => {
                  const options = productsForType(row.itemType);
                  const isMeter = isDimensionalLineType(row.itemType) && row.saleMode === "meter";
                  const isService = isServiceLineType(row.itemType);
                  const isAccessory = row.itemType === "accessory";
                  return (
                    <tr key={row.id}>
                      <td className="p-2">
                        <select
                          value={row.itemType}
                          onChange={(e) => handleTypeChange(row.id, e.target.value as GridItemType)}
                          className="app-input text-xs"
                        >
                          <option value="polywood">{t("polywood.type.polywood")}</option>
                          <option value="sinelik">{t("polywood.type.sinelik")}</option>
                          <option value="accessory">{t("polywood.type.accessory")}</option>
                          <option value="service">{t("polywood.type.service")}</option>
                        </select>
                      </td>
                      <td className="relative overflow-visible p-2">
                        {isService ? (
                          <div className="space-y-1">
                            <select
                              value={row.productId}
                              onChange={(e) => handleProductChange(row.id, e.target.value)}
                              className="app-input min-w-[180px] text-xs"
                            >
                              <option value="">{t("common.select")}</option>
                              <option value={ADHOC_SERVICE_PRODUCT_ID}>
                                {t("polywood.service.customService")}
                              </option>
                              {options.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} {p.code ? `(${p.code})` : ""}
                                </option>
                              ))}
                            </select>
                            {row.productId === ADHOC_SERVICE_PRODUCT_ID ? (
                              <input
                                type="text"
                                value={row.customServiceName}
                                onChange={(e) =>
                                  updateRow(row.id, { customServiceName: e.target.value })
                                }
                                placeholder={t("polywood.service.customServicePlaceholder")}
                                className="app-input w-full text-xs"
                              />
                            ) : null}
                          </div>
                        ) : (
                          <ProductCombobox
                            instanceId={row.id}
                            products={options}
                            selectedId={row.productId}
                            selectedName={
                              options.find((p) => p.id === row.productId)?.name || ""
                            }
                            polywoodWarehouseId={
                              isDimensionalLineType(row.itemType) ? warehouseId : null
                            }
                            onSelect={(product) =>
                              handleProductChange(row.id, product?.id || "")
                            }
                          />
                        )}
                      </td>
                      <td className="p-2">
                        {isDimensionalLineType(row.itemType) ? (
                          <select
                            value={row.saleMode}
                            onChange={(e) =>
                              updateRow(row.id, { saleMode: e.target.value as GridSaleMode })
                            }
                            className="app-input text-xs"
                          >
                            <option value="full_sheet">{t("polywood.unit.sheet")}</option>
                            <option value="meter">{t("polywood.unit.meter")}</option>
                          </select>
                        ) : isService ? (
                          <span className="text-app-muted">{t("polywood.unit.service")}</span>
                        ) : (
                          <span className="text-app-muted">
                            {options.find((p) => p.id === row.productId)?.unit || t("polywood.unit.qty")}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="number"
                            step={isService || isAccessory ? "1" : "0.01"}
                            min="0"
                            value={row.amount || ""}
                            onChange={(e) => updateRow(row.id, { amount: Number(e.target.value) || 0 })}
                            className="app-input w-24 text-right text-xs"
                            placeholder={isService ? "2" : undefined}
                          />
                          {isMeter ? (
                            <input
                              type="number"
                              step="1"
                              min="1"
                              title={t("polywood.grid.pieceCount")}
                              value={row.pieceCount || ""}
                              onChange={(e) =>
                                updateRow(row.id, {
                                  pieceCount: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                              className="app-input w-24 text-right text-xs"
                              placeholder={t("polywood.grid.pieceCount")}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.unitPrice || ""}
                          onChange={(e) => updateRow(row.id, { unitPrice: Number(e.target.value) || 0 })}
                          className="app-input w-24 text-right text-xs"
                        />
                      </td>
                      <td className="p-2 text-right font-mono font-semibold text-app">
                        {rowTotal(row).toFixed(2)}
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addRow}
            className="btn-secondary mt-3 flex items-center gap-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("common.add")}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 px-6 md:grid-cols-2">
          <DocumentAdditionalExpensesSection
            expenses={additionalExpenses}
            onChange={setAdditionalExpenses}
            accounts={accounts}
          />

          <section className="app-card space-y-3 p-4">
            <div className="flex items-center justify-between border-b border-app pb-2">
              <h3 className="text-sm font-bold text-app">{t("forms.advancePayments")}</h3>
              <button type="button" onClick={addPaymentRow} className="btn-secondary flex items-center gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" />
                {t("common.add")}
              </button>
            </div>
            <OfficialPaymentSplitBanner amounts={officialAmounts} isOfficial={isOfficial} />
            {payments.length === 0 ? (
              <p className="text-xs text-app-muted">{t("forms.additionalExpensesEmpty")}</p>
            ) : (
              payments.map((pay) => (
                <div key={pay.id} className="grid grid-cols-12 gap-2">
                  <select
                    value={pay.account_id}
                    onChange={(e) => handleAccountChange(pay.id, e.target.value)}
                    className="app-input col-span-7 text-xs"
                  >
                    <option value="">{t("modals.payment.selectAccount")}</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {formatTreasuryAccountLabel(acc, t)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pay.amount || ""}
                    onChange={(e) => updatePayment(pay.id, { amount: Number(e.target.value) || 0 })}
                    className="app-input col-span-4 text-right text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removePayment(pay.id)}
                    className="col-span-1 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
            <div className="space-y-1 border-t border-app pt-2 text-xs">
              <div className="flex justify-between font-semibold">
                <span className="text-app-muted">{t("invoice.paidTotal")}</span>
                <span className="font-mono text-emerald-600">
                  {displayTotals.paid_amount.toFixed(2)} {t("common.currency")}
                </span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-app-muted">{t("invoice.remainingDebt")}</span>
                <span className="font-mono text-rose-600">
                  {displayTotals.remaining_balance.toFixed(2)} {t("common.currency")}
                </span>
              </div>
            </div>
          </section>
        </div>

        <label className="block px-6 text-xs font-semibold text-app">
          {t("common.notes")}
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-app bg-app-card px-6 py-4">
          <div className="flex flex-wrap gap-4 text-xs text-app-muted">
            {isOfficial ? (
              <OfficialTotalsBreakdown amounts={officialAmounts} isOfficial={isOfficial} />
            ) : (
              <>
                <span>
                  {t("common.total")}:{" "}
                  <span className="font-mono font-bold text-app">{displayTotals.subtotal.toFixed(2)}</span>
                </span>
                <span>
                  {t("forms.additionalExpenses")}:{" "}
                  <span className="font-mono font-bold text-app">{additionalExpensesTotal.toFixed(2)}</span>
                </span>
                <span>
                  {t("invoice.grandTotal")}:{" "}
                  <span className="font-mono font-bold text-app-accent">{displayTotals.grand_total.toFixed(2)}</span>
                </span>
              </>
            )}
            <span>
              {t("invoice.remainingBalance")}:{" "}
              <span className="font-mono font-bold text-app">{displayTotals.remaining_balance.toFixed(2)}</span>
            </span>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="flex items-center gap-2 rounded-lg bg-[image:var(--app-gradient)] px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
