"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  calcDiscountTotal,
  calcLineTotal,
  calcSaleTotals,
  createEmptySaleItem,
  type Customer,
  type SaleInsert,
  type SaleItem,
  type SalePayment,
} from "@/types/database.types";
import { useAuth } from "@/components/auth/AuthProvider";
import { submitSale } from "@/lib/sales/submitSale";
import {
  normalizeSaleItemProductId,
  validateSaleItemsHaveProductIds,
} from "@/lib/sales/saleItemProductId";
import {
  collectSaleSubmitPreflightIssues,
  preflightMessage,
  validatePaymentRowsRequireAccount,
  validatePaymentsNotExceedTotal,
  validateSaleInvoiceLines,
} from "@/lib/forms/documentPreflight";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import DocumentAdditionalExpensesSection from "@/components/documents/DocumentAdditionalExpensesSection";
import {
  sumDocumentAdditionalExpenses,
  validateDocumentAdditionalExpenses,
  type DocumentAdditionalExpense,
} from "@/lib/forms/documentExpenses";
import QuickAddProductModal from "@/components/purchases/QuickAddProductModal";
import BarcodeScanField from "@/components/documents/BarcodeScanField";
import ResponsiblePersonField from "@/components/documents/ResponsiblePersonField";
import { useResponsiblePerson } from "@/hooks/useResponsiblePerson";
import { resolveIssuedByProfileId } from "@/lib/sales/invoiceIssuer";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchProductByBarcode, findProductByBarcodeInList } from "@/lib/products/barcode";
import { POLYWOOD_INVENTORY_MODE, POLYWOOD_WAREHOUSE_TYPE } from "@/lib/polywood/constants";
import OfficialTransactionSection from "@/components/finance/OfficialTransactionSection";
import OfficialTotalsBreakdown from "@/components/finance/OfficialTotalsBreakdown";
import OfficialPaymentSplitBanner from "@/components/finance/OfficialPaymentSplitBanner";
import { buildOfficialPaymentAccountPatch, formatTreasuryAccountLabel } from "@/lib/finance/officialPaymentAutoFill";
import {
  buildOfficialDocumentFields,
  type OfficialTransactionState,
} from "@/lib/finance/officialTransaction";
import { calcOfficialTransactionTotals, type VatMode } from "@/lib/finance/vatEngine";
import {
  calcGlobalDiscountAmount,
  type GlobalDiscountMode,
} from "@/lib/finance/invoiceDiscounts";
import { useTaxPayrollConfig } from "@/hooks/useTaxPayrollConfig";
import { defaultVatMode, vatRateToNumber } from "@/lib/tax/payrollConfig";
import {
  filterLegalCustomers,
  isLegalEntityWithVoen,
} from "@/lib/customers/entityType";
import { fetchPolywoodInventorySummary } from "@/lib/polywood/inventory";
import {
  fetchCompositeAvailableStockAction,
  fetchProductAvailableStockAction,
} from "@/lib/actions/productBom";
import InvoiceProductSelectorModal from "@/components/invoices/InvoiceProductSelectorModal";
import { ensurePolywoodWarehouseAction } from "@/lib/actions/polywood";
import { createEmptySaleItems } from "@/lib/forms/invoiceDefaults";
import { productCode } from "@/lib/products/productOptionLabel";
import ProductCombobox from "@/components/products/ProductCombobox";
import {
  Building2,
  CreditCard,
  Plus,
  Save,
  Trash2,
  Truck,
  User,
  UserPlus,
  X,
} from "lucide-react";

export interface InvoiceFormProps {
  isOpen: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
  defaultType?: "sale" | "purchase" | "consignment";
  invoiceMode?: "standard" | "polywood";
}

interface Employee {
  id: string;
  full_name?: string;
  name?: string;
}

interface Warehouse {
  id: string;
  name: string;
  warehouse_type?: string | null;
}

interface Product {
  id: string;
  name: string;
  code?: string;
  sku?: string;
  barcode?: string;
  unit?: string;
  sell_price?: number;
  sale_price?: number;
  price?: number;
  stock?: number;
  warehouse_id?: string;
  inventory_mode?: string | null;
  full_sheet_length_m?: number | null;
  vat_rate?: number;
  tax_rate?: number;
  discount_percent?: number;
  discount?: number;
  is_composite?: boolean | null;
  is_service?: boolean | null;
  category?: string | null;
  subcategory?: string | null;
}

function isPolywoodWarehouseRow(warehouseId: string, warehouses: Warehouse[]): boolean {
  const wh = warehouses.find((w) => w?.id === warehouseId);
  return (wh?.warehouse_type ?? "general") === POLYWOOD_WAREHOUSE_TYPE;
}

function isPolywoodProductRow(product: Product | null | undefined): boolean {
  return product?.inventory_mode === POLYWOOD_INVENTORY_MODE;
}

function filterProductsForWarehouse(products: Product[], warehouseId: string, warehouses: Warehouse[]): Product[] {
  const polywood = isPolywoodWarehouseRow(warehouseId, warehouses);
  return products.filter((product) => {
    const isPolywoodProduct = isPolywoodProductRow(product);
    return polywood ? isPolywoodProduct : !isPolywoodProduct;
  });
}

interface Account {
  id: string;
  name: string;
  type?: string;
  is_vat_account?: boolean | null;
}

function customerLabel(c: Customer, t: (key: string) => string) {
  return c.full_name || c.name || t("invoice.anonymousCustomer");
}

function employeeLabel(e: Employee, t: (key: string) => string) {
  return e.full_name || e.name || t("invoice.anonymousEmployee");
}

function productPrice(p: Product) {
  return Number(p.sell_price ?? p.sale_price ?? p.price) || 0;
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

const INVOICE_CARD = "app-card flex h-full flex-col rounded-xl p-4 text-xs";
const INVOICE_LABEL = "mb-1 block text-xs font-medium text-app";
const INVOICE_INPUT =
  "h-9 w-full rounded-lg border border-app bg-app-card px-3 text-xs font-medium text-app focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-[color:var(--app-accent-ring)]";
const INVOICE_TEXTAREA =
  "mt-1 w-full rounded-lg border border-app bg-app-card px-3 py-2 text-xs font-medium text-app focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-[color:var(--app-accent-ring)]";

export default function UniversalInvoiceForm({
  isOpen,
  onClose,
  onSuccess,
  invoiceMode = "standard",
}: InvoiceFormProps) {
  const [docNo, setDocNo] = useState("");
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [issuerProfiles, setIssuerProfiles] = useState<
    Array<{ id: string; employee_id: string | null; is_active: boolean | null }>
  >([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [sellerName, setSellerName] = useState("");

  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryType, setDeliveryType] = useState<"paid" | "free">("free");
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [notes, setNotes] = useState("");

  const [additionalExpenses, setAdditionalExpenses] = useState<DocumentAdditionalExpense[]>([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    full_name: "",
    phone: "",
    company_name: "",
    address: "",
    voen: "",
  });

  const [items, setItems] = useState<SaleItem[]>(() => createEmptySaleItems(5));
  const [payments, setPayments] = useState<SalePayment[]>([
    { id: "1", account_id: "", method: "Nəğd", amount: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [quickAddProductRowId, setQuickAddProductRowId] = useState<string | null>(null);
  const [productSelectorOpen, setProductSelectorOpen] = useState(false);
  const [productSelectorTargetRowId, setProductSelectorTargetRowId] = useState<string | null>(
    null
  );
  const [isOfficial, setIsOfficial] = useState(false);
  const [vatMode, setVatMode] = useState<VatMode>("none");
  const [globalDiscountMode, setGlobalDiscountMode] = useState<GlobalDiscountMode>("percent");
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [contractId, setContractId] = useState<string | null>(null);
  const [voenVerification, setVoenVerification] = useState("");
  const { message: toastMessage, variant: toastVariant, showError: showToastError, showSuccess: showToastSuccess } = useToast();
  const { can, profile } = useAuth();
  const { t } = useI18n();
  const { config: taxConfig } = useTaxPayrollConfig();
  const defaultVatRate = vatRateToNumber(taxConfig.default_vat_rate);
  const canSaveInvoice = can("can_create_invoice");
  const polywoodOnly = invoiceMode === "polywood";

  const customerOptions = useMemo(
    () => (isOfficial ? filterLegalCustomers(customers) : customers),
    [customers, isOfficial]
  );

  useEffect(() => {
    if (!isOpen) return;
    const nextRate = isOfficial && vatMode !== "none" ? defaultVatRate : 0;
    setItems((prev) =>
      prev.map((row) => (row.vat_rate === nextRate ? row : { ...row, vat_rate: nextRate }))
    );
  }, [isOpen, isOfficial, vatMode, defaultVatRate]);

  useEffect(() => {
    if (!isOfficial || !selectedCustomerId) return;
    const current = customers.find((c) => c.id === selectedCustomerId);
    if (current && !isLegalEntityWithVoen(current)) {
      setSelectedCustomerId("");
      setSelectedCustomer(null);
      setContractId(null);
      setVoenVerification("");
    }
  }, [isOfficial, selectedCustomerId, customers]);

  const defaultWarehouse = warehouses[0];

  useEffect(() => {
    if (!isOpen) return;

    setDocNo(
      `${polywoodOnly ? "SPW" : "SS"}-${new Date().getFullYear()}-${Math.floor(
        10000 + Math.random() * 90000
      )}`
    );
    setDocDate(new Date().toISOString().slice(0, 10));
    setSelectedCustomerId("");
    setSelectedCustomer(null);
    setSelectedSellerId("");
    setSellerName("");
    setDeliveryAddress("");
    setDeliveryType("free");
    setDeliveryFee(0);
    setNotes("");
    setAdditionalExpenses([]);
    setShowAddCustomer(false);
    setNewCustomerData({
      full_name: "",
      phone: "",
      company_name: "",
      address: "",
      voen: "",
    });
    setItems(createEmptySaleItems(5));
    setPayments([{ id: "1", account_id: "", method: "Nəğd", amount: 0 }]);
    setQuickAddProductRowId(null);
    setProductSelectorOpen(false);
    setProductSelectorTargetRowId(null);
    setGlobalDiscountMode("percent");
    setGlobalDiscountValue(0);
    setVatMode(defaultVatMode(taxConfig.default_vat_rate));
    void fetchInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset form when the modal opens
  }, [isOpen, polywoodOnly]);

  const fetchInitialData = async () => {
    if (polywoodOnly) {
      await ensurePolywoodWarehouseAction();
    }

    const [{ data: cust }, { data: emp }, { data: wh }, { data: acc }, { data: prod }, { data: prof }] =
      await Promise.all([
        supabase.from("customers").select("*").order("created_at", { ascending: false }),
        supabase.from("employees").select("*"),
        supabase.from("warehouses").select("*").order("created_at", { ascending: true }),
        supabase.from("accounts").select("*").order("created_at", { ascending: true }),
        supabase.from("products").select("*").order("name", { ascending: true }),
        supabase
          .from("profiles")
          .select("id, employee_id, is_active")
          .eq("is_active", true)
          .order("full_name"),
      ]);

    if (cust) setCustomers(cust as Customer[]);
    if (emp) setEmployees(emp);
    if (prof) setIssuerProfiles(prof);

    const allWarehouses = ((wh as Warehouse[]) || []).filter(Boolean);
    const warehouseRows = polywoodOnly
      ? allWarehouses.filter(
          (w) => (w.warehouse_type ?? "general") === POLYWOOD_WAREHOUSE_TYPE
        )
      : allWarehouses.filter(
          (w) => (w.warehouse_type ?? "general") !== POLYWOOD_WAREHOUSE_TYPE
        );
    setWarehouses(warehouseRows);
    const firstWh = warehouseRows[0];
    setItems(createEmptySaleItems(5, firstWh?.id || "", firstWh?.name || ""));

    const accountRows = (acc ?? []) as unknown as Account[];
    setAccounts(accountRows);
    if (accountRows[0]) {
      setPayments([
        {
          id: "1",
          account_id: accountRows[0].id,
          method: accountRows[0].name,
          amount: 0,
        },
      ]);
    }

    if (prod) {
      const filtered = (prod as Product[]).filter((item) =>
        polywoodOnly
          ? item.inventory_mode === POLYWOOD_INVENTORY_MODE
          : item.inventory_mode !== POLYWOOD_INVENTORY_MODE
      );
      setProducts(filtered);
    }
  };

  const handleCustomerChange = (id: string) => {
    setSelectedCustomerId(id);
    const found = customers.find((c) => c.id === id) || null;
    setSelectedCustomer(found);
    if (found?.address) setDeliveryAddress(found.address);
    if (isOfficial && found?.voen) setVoenVerification(found.voen);
    if (!id) {
      setContractId(null);
      setVoenVerification("");
    }
  };

  const handleSaveQuickCustomer = async () => {
    if (!newCustomerData.full_name.trim()) {
      showToastError(t("invoice.enterCustomerName"));
      return;
    }

    setSavingCustomer(true);
    const payload = {
      code: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      full_name: newCustomerData.full_name.trim(),
      name: newCustomerData.full_name.trim(),
      phone: newCustomerData.phone.trim(),
      company_name: newCustomerData.company_name.trim(),
      address: newCustomerData.address.trim(),
      voen: newCustomerData.voen.trim(),
      balance: 0,
    };

    const { data, error } = await supabase.from("customers").insert([payload]).select().single();
    setSavingCustomer(false);

    if (error) {
      showToastError(t("common.errorOccurred", { message: error.message }));
      return;
    }

    setCustomers((prev) => [data as Customer, ...prev]);
    handleCustomerChange(data.id);
    setShowAddCustomer(false);
    setNewCustomerData({
      full_name: "",
      phone: "",
      company_name: "",
      address: "",
      voen: "",
    });
  };

  const handleItemChange = (id: string, patch: Partial<SaleItem>) => {
    setItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, ...patch };
        updated.total = calcLineTotal(
          updated.quantity,
          updated.unit_price,
          updated.discount_percent
        );
        return updated;
      })
    );
  };

  const resolveProductAvailableStock = async (
    prod: Product,
    polywoodRow: boolean,
    warehouseId?: string,
    fullSheetLengthM = 4
  ): Promise<{ availableStock: number; polywoodSummary?: { total: number; fullSheets: number } }> => {
    if (polywoodRow && warehouseId) {
      try {
        const summary = await fetchPolywoodInventorySummary(prod.id, warehouseId, fullSheetLengthM);
        return {
          availableStock: summary.total_length_m,
          polywoodSummary: {
            total: summary.total_length_m,
            fullSheets: summary.full_sheet_count,
          },
        };
      } catch {
        return { availableStock: Number(prod.stock) || 0 };
      }
    }

    if (prod.is_composite) {
      const result = await fetchCompositeAvailableStockAction(prod.id);
      return { availableStock: result.success ? result.stock : 0 };
    }

    return { availableStock: Number(prod.stock) || 0 };
  };

  const resolveLineVatRate = (prod: Product): number => {
    if (!isOfficial || vatMode === "none") return 0;
    const productRate = Number(prod.vat_rate ?? prod.tax_rate);
    if (Number.isFinite(productRate) && productRate > 0) return productRate;
    return defaultVatRate;
  };

  const handleProductSelect = async (
    rowId: string,
    prod: Product | null,
    quantityOverride?: number
  ) => {
    if (!prod) {
      handleItemChange(rowId, {
        product_id: "",
        product_code: "",
        product_name: "",
        unit_price: 0,
        discount_percent: 0,
        vat_rate: 0,
        available_stock: 0,
        polywood_total_length_m: 0,
        polywood_full_sheet_count: 0,
      });
      return;
    }

    const row = items.find((item) => item.id === rowId);
    const polywoodRow = row ? isPolywoodWarehouseRow(row.warehouse_id, warehouses) : false;

    if (polywoodRow && !isPolywoodProductRow(prod)) {
      showToastError(t("polywood.invoice.onlyPolywoodProducts"));
      return;
    }
    if (!polywoodRow && isPolywoodProductRow(prod)) {
      showToastError(t("polywood.invoice.usePolywoodWarehouse"));
      return;
    }

    const fullSheetLengthM = Number(prod.full_sheet_length_m) || 4;
    const stockResult = await resolveProductAvailableStock(
      prod,
      polywoodRow,
      row?.warehouse_id,
      fullSheetLengthM
    );
    const polywoodSummary = stockResult.polywoodSummary || {
      total: stockResult.availableStock,
      fullSheets: 0,
    };

    handleItemChange(rowId, {
      product_id: prod.id,
      product_code: productCode(prod),
      product_name: prod.name,
      quantity: quantityOverride ?? row?.quantity ?? 1,
      unit: polywoodRow ? "Metr" : prod.unit || "Ədəd",
      unit_price: polywoodRow
        ? roundPrice(
            (row?.polywood_sale_mode || "linear_m") === "full_sheet"
              ? productPrice(prod) * fullSheetLengthM
              : productPrice(prod)
          )
        : productPrice(prod),
      discount_percent: Number(prod.discount_percent ?? prod.discount) || 0,
      vat_rate: resolveLineVatRate(prod),
      available_stock: stockResult.availableStock,
      polywood_sale_mode: polywoodRow ? row?.polywood_sale_mode || "linear_m" : null,
      polywood_full_sheet_length_m: fullSheetLengthM,
      polywood_total_length_m: polywoodSummary.total,
      polywood_full_sheet_count: polywoodSummary.fullSheets,
    });
  };

  const handleQuickProductCreated = (product: Product, rowId: string) => {
    setProducts((prev) => [product, ...prev.filter((p) => p.id !== product.id)]);
    handleProductSelect(rowId, product);
  };

  const openProductSelectorModal = () => {
    const emptyRow = items.find((row) => !row.product_id);
    if (emptyRow) {
      setProductSelectorTargetRowId(emptyRow.id);
      setProductSelectorOpen(true);
      return;
    }

    const newRow = createEmptySaleItem(
      defaultWarehouse?.id || "",
      defaultWarehouse?.name || ""
    );
    setItems((prev) => [...prev, newRow]);
    setProductSelectorTargetRowId(newRow.id);
    setProductSelectorOpen(true);
  };

  const handleModalProductSelect = async (
    product: Product,
    quantity: number,
    closeAfter: boolean
  ) => {
    if (!productSelectorTargetRowId) return;

    const targetRowId = productSelectorTargetRowId;
    setProducts((prev) => [product, ...prev.filter((p) => p.id !== product.id)]);
    await handleProductSelect(targetRowId, product, quantity);

    if (closeAfter) {
      setProductSelectorOpen(false);
      setProductSelectorTargetRowId(null);
      return;
    }

    setItems((prev) => {
      const nextEmpty = prev.find((row) => !row.product_id && row.id !== targetRowId);
      if (nextEmpty) {
        setProductSelectorTargetRowId(nextEmpty.id);
        return prev;
      }

      const source = prev.find((row) => row.id === targetRowId);
      const newRow = createEmptySaleItem(
        source?.warehouse_id || defaultWarehouse?.id || "",
        source?.warehouse_name || defaultWarehouse?.name || ""
      );
      setProductSelectorTargetRowId(newRow.id);
      return [...prev, newRow];
    });
  };

  const applyProductToSaleRow = (
    row: SaleItem,
    prod: Product,
    quantity?: number,
    availableStock?: number
  ): SaleItem => {
    const polywoodRow = isPolywoodWarehouseRow(row.warehouse_id, warehouses);
    const fullSheetLengthM = Number(prod.full_sheet_length_m) || 4;
    const mode = polywoodRow ? row.polywood_sale_mode || "linear_m" : null;
    const meterPrice = productPrice(prod);
    const updated: SaleItem = {
      ...row,
      product_id: prod.id,
      product_code: productCode(prod),
      product_name: prod.name,
      unit: polywoodRow ? (mode === "full_sheet" ? "Vərəq" : "Metr") : prod.unit || "Ədəd",
      unit_price: polywoodRow
        ? roundPrice(mode === "full_sheet" ? meterPrice * fullSheetLengthM : meterPrice)
        : meterPrice,
      discount_percent: Number(prod.discount_percent ?? prod.discount) || 0,
      vat_rate: Number(prod.vat_rate ?? prod.tax_rate) || 0,
      available_stock: availableStock ?? (Number(prod.stock) || 0),
      quantity: quantity ?? row.quantity,
      polywood_sale_mode: mode,
      polywood_full_sheet_length_m: polywoodRow ? fullSheetLengthM : null,
    };
    updated.total = calcLineTotal(updated.quantity, updated.unit_price, updated.discount_percent);
    return updated;
  };

  const handleBarcodeScan = async (barcode: string) => {
    let product = findProductByBarcodeInList(products, barcode) as Product | null;
    if (!product) {
      const fetched = await fetchProductByBarcode(barcode);
      if (fetched) {
        product = fetched as Product;
        setProducts((prev) => [product!, ...prev.filter((p) => p.id !== product!.id)]);
      }
    }
    if (!product) {
      showToastError(t("invoice.barcodeNotFound", { barcode }));
      return;
    }

    if (!polywoodOnly && isPolywoodProductRow(product)) {
      showToastError(t("polywood.invoice.usePolywoodWarehouse"));
      return;
    }
    if (polywoodOnly && !isPolywoodProductRow(product)) {
      showToastError(t("polywood.invoice.onlyPolywoodProducts"));
      return;
    }

    const stockResult = await resolveProductAvailableStock(
      product,
      polywoodOnly,
      defaultWarehouse?.id,
      Number(product.full_sheet_length_m) || 4
    );

    setItems((prev) => {
      const existing = prev.find((r) => r.product_id === product!.id);
      if (existing) {
        return prev.map((row) => {
          if (row.id !== existing.id) return row;
          return applyProductToSaleRow(
            row,
            product!,
            row.quantity + 1,
            stockResult.availableStock
          );
        });
      }

      const emptyRow = prev.find((r) => !r.product_id && !r.product_name.trim());
      if (emptyRow) {
        return prev.map((row) =>
          row.id === emptyRow.id
            ? applyProductToSaleRow(row, product!, 1, stockResult.availableStock)
            : row
        );
      }

      const newRow = createEmptySaleItem(
        defaultWarehouse?.id || "",
        defaultWarehouse?.name || ""
      );
      return [
        ...prev,
        applyProductToSaleRow(newRow, product!, 1, stockResult.availableStock),
      ];
    });
  };

  const handleWarehouseSelect = (rowId: string, warehouseId: string) => {
    if (polywoodOnly) return;
    const wh = warehouses.find((w) => w.id === warehouseId);
    const polywood = isPolywoodWarehouseRow(warehouseId, warehouses);
    handleItemChange(rowId, {
      warehouse_id: warehouseId,
      warehouse_name: wh?.name || "",
      product_id: "",
      product_code: "",
      product_name: "",
      unit: polywood ? "Metr" : "Ədəd",
      quantity: 1,
      available_stock: 0,
      polywood_sale_mode: polywood ? "linear_m" : null,
      polywood_full_sheet_length_m: 4,
      polywood_total_length_m: 0,
      polywood_full_sheet_count: 0,
    });
  };

  const addRow = () => {
    setItems((prev) => [
      ...prev,
      createEmptySaleItem(defaultWarehouse?.id || "", defaultWarehouse?.name || ""),
    ]);
  };

  const removeRow = (id: string) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((row) => row.id !== id));
  };

  const addPaymentRow = () => {
    const acc = accounts[0];
    setPayments((prev) => [
      ...prev,
      {
        id: `${Date.now()}`,
        account_id: acc?.id || "",
        method: acc?.name || "Nəğd",
        amount: 0,
      },
    ]);
  };

  const updatePayment = (id: string, patch: Partial<SalePayment>) => {
    setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

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

  const removePaymentRow = (id: string) => {
    if (payments.length === 1) return;
    setPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const additionalExpensesTotal = useMemo(
    () => sumDocumentAdditionalExpenses(additionalExpenses),
    [additionalExpenses]
  );

  const totals = useMemo(
    () => calcSaleTotals(items, payments, deliveryType, deliveryFee, additionalExpensesTotal),
    [items, payments, deliveryType, deliveryFee, additionalExpensesTotal]
  );

  const lineDiscountTotal = useMemo(() => calcDiscountTotal(items), [items]);

  const globalDiscountAmount = useMemo(
    () =>
      calcGlobalDiscountAmount(
        totals.subtotal - lineDiscountTotal,
        globalDiscountMode,
        globalDiscountValue
      ),
    [totals.subtotal, lineDiscountTotal, globalDiscountMode, globalDiscountValue]
  );

  const totalDiscountAmount = lineDiscountTotal + globalDiscountAmount;
  const itemsNetTotal = totals.subtotal - totalDiscountAmount;

  const officialAmounts = useMemo(
    () =>
      calcOfficialTransactionTotals(itemsNetTotal, {
        isOfficial,
        vatMode,
        vatRate: defaultVatRate,
        deliveryCost: totals.delivery_cost,
        additionalExpensesTotal,
      }),
    [itemsNetTotal, isOfficial, vatMode, defaultVatRate, totals.delivery_cost, additionalExpensesTotal]
  );

  const displayTotals = useMemo(() => {
    const baseGrand = isOfficial
      ? officialAmounts.grand_total
      : totals.subtotal - totalDiscountAmount + totals.delivery_cost + additionalExpensesTotal;

    return {
      ...totals,
      discount_total: totalDiscountAmount,
      line_discount_total: lineDiscountTotal,
      global_discount_total: globalDiscountAmount,
      vat_total: isOfficial ? officialAmounts.vat_amount : totals.vat_total,
      grand_total: baseGrand,
      remaining_balance: baseGrand - totals.paid_amount,
    };
  }, [
    isOfficial,
    totals,
    officialAmounts,
    totalDiscountAmount,
    lineDiscountTotal,
    globalDiscountAmount,
    additionalExpensesTotal,
  ]);

  const salePreflightIssue = useMemo(() => {
    if (!isOpen) return null;

    return collectSaleSubmitPreflightIssues({
      canSave: canSaveInvoice,
      customerId: selectedCustomerId,
      items,
      payments,
      paidAmount: totals.paid_amount,
      grandTotal: displayTotals.grand_total,
      resolveAvailableStock: (item) => {
        if (item.available_stock != null && Number.isFinite(Number(item.available_stock))) {
          return Number(item.available_stock);
        }
        const product = (products ?? []).find((p) => p.id === item.product_id);
        return Number(product?.stock) || 0;
      },
    });
  }, [
    isOpen,
    canSaveInvoice,
    items,
    payments,
    products,
    selectedCustomerId,
    totals.grand_total,
    totals.paid_amount,
    displayTotals.grand_total,
  ]);
  const salePreflightHint = salePreflightIssue ? preflightMessage(t, salePreflightIssue) : undefined;
  const { locked: sellerLocked, lockedEmployeeId, lockedName } =
    useResponsiblePerson(employees);
  const effectiveSellerId = sellerLocked ? lockedEmployeeId : selectedSellerId;
  const seller = employees.find((e) => e.id === effectiveSellerId);
  const effectiveSellerName = sellerLocked
    ? lockedName
    : seller
      ? employeeLabel(seller, t)
      : sellerName;

  useEffect(() => {
    if (sellerLocked || selectedSellerId || !profile?.employee_id) return;
    const ownEmployee = employees.find((employee) => employee.id === profile.employee_id);
    if (!ownEmployee) return;
    setSelectedSellerId(ownEmployee.id);
    setSellerName(employeeLabel(ownEmployee, t));
  }, [employees, profile?.employee_id, selectedSellerId, sellerLocked, t]);

  const handleSellerChange = (employeeId: string, displayName: string) => {
    setSelectedSellerId(employeeId);
    setSellerName(displayName);
  };

  const handleClose = () => {
    onClose?.();
  };

  const handleSubmit = async () => {
    if (!canSaveInvoice) {
      showToastError(t("invoice.noPermission"));
      return;
    }
    if (!selectedCustomerId) {
      showToastError(t("invoice.selectCustomerAlert"));
      return;
    }

    const saleItems = items
      .filter((i) => i.product_id || i.product_name.trim())
      .map((item) => normalizeSaleItemProductId(item, products ?? []));

    const productIdError = validateSaleItemsHaveProductIds(saleItems, products ?? []);
    if (productIdError) {
      showToastError(productIdError);
      return;
    }

    const lineIssue = validateSaleInvoiceLines(saleItems, (item) => {
      if (item.available_stock != null && Number.isFinite(Number(item.available_stock))) {
        return Number(item.available_stock);
      }
      const product = (products ?? []).find((p) => p.id === item.product_id);
      return Number(product?.stock) || 0;
    });
    if (lineIssue) {
      showToastError(preflightMessage(t, lineIssue));
      return;
    }

    const paymentAccountIssue = validatePaymentRowsRequireAccount(payments);
    if (paymentAccountIssue) {
      showToastError(preflightMessage(t, paymentAccountIssue));
      return;
    }

    if (isOfficial && !contractId) {
      showToastError(t("official.contractRequired"));
      return;
    }
    if (isOfficial && selectedCustomer && !isLegalEntityWithVoen(selectedCustomer)) {
      showToastError(t("official.noLegalCustomers"));
      return;
    }

    const paymentTotalIssue = validatePaymentsNotExceedTotal(
      totals.paid_amount,
      displayTotals.grand_total
    );
    if (paymentTotalIssue) {
      showToastError(preflightMessage(t, paymentTotalIssue));
      return;
    }

    const additionalExpenseError = validateDocumentAdditionalExpenses(additionalExpenses);
    if (additionalExpenseError) {
      showToastError(additionalExpenseError);
      return;
    }

    setSaving(true);
    const primaryWarehouse =
      items.find((i) => i.warehouse_name)?.warehouse_name || defaultWarehouse?.name || "";

    const officialState: OfficialTransactionState = {
      isOfficial,
      contractId,
      vatMode: isOfficial ? vatMode : "none",
      voenVerification,
    };
    const officialFields = buildOfficialDocumentFields(officialState, officialAmounts);

    const issuedBy = resolveIssuedByProfileId({
      selectedEmployeeId: effectiveSellerId,
      profiles: issuerProfiles,
      currentProfileId: profile?.id,
      role: profile?.role,
    });

    const salesPayload: SaleInsert = {
      doc_no: docNo,
      doc_date: docDate,
      customer_id: selectedCustomerId,
      customer_name: selectedCustomer ? customerLabel(selectedCustomer, t) : "",
      seller_id: effectiveSellerId || null,
      seller_name: effectiveSellerName,
      issued_by: issuedBy,
      warehouse_name: primaryWarehouse,
      subtotal: totals.subtotal,
      discount_total: displayTotals.discount_total,
      vat_total: isOfficial ? officialAmounts.vat_amount : displayTotals.vat_total,
      total_amount: displayTotals.grand_total,
      paid_amount: totals.paid_amount,
      remaining_balance: displayTotals.grand_total - totals.paid_amount,
      delivery_address: deliveryAddress,
      delivery_type: deliveryType,
      delivery_fee: totals.delivery_cost,
      note: notes,
      created_at: new Date().toISOString(),
    };

    const result = await submitSale({
      header: salesPayload,
      items: saleItems,
      payments,
      docNo,
      additionalExpenses,
      officialFields,
    });

    if (!result.success) {
      setSaving(false);
      showToastError(formatRpcError(result.error ?? t("common.error"), t));
      return;
    }

    setSaving(false);
    showToastSuccess(t("invoice.saveSuccess"));
    onSuccess?.();
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto app-scrim p-4">
      <div className="my-6 w-full max-w-6xl space-y-4 rounded-2xl border border-app bg-app-card-hover p-5 shadow-sm">
        <div className="app-card flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-app">
              {polywoodOnly ? t("sales.polywoodInvoice") : t("invoice.newSaleTitle")}
            </h2>
            <p className="text-[11px] text-app-muted">
              {t("invoice.docNoLabel")}: <span className="font-mono font-semibold text-app-accent">{docNo}</span>
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="font-semibold text-app-muted">
              {t("common.date")}
              <input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="ml-2 rounded-lg border border-app px-2 py-1 font-semibold text-app"
              />
            </label>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover hover:text-app"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="app-card space-y-2 p-4 text-xs">
            <h3 className="flex items-center gap-1.5 border-b border-app pb-2 font-bold text-app">
              <User className="h-4 w-4 text-app-accent" />
              {t("invoice.issuedBy")}
            </h3>
            <ResponsiblePersonField
              employees={employees}
              value={effectiveSellerId}
              onChange={handleSellerChange}
            />
          </div>

          <div className="app-card space-y-2 p-4 text-xs">
            <div className="flex items-center justify-between border-b border-app pb-2">
              <h3 className="flex items-center gap-1.5 font-bold text-app">
                <Building2 className="h-4 w-4 text-emerald-600" />
                {t("invoice.customerInfo")}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCustomer((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-bold text-app-accent hover:underline"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {t("invoice.newCustomer")}
              </button>
            </div>

            {showAddCustomer && (
              <div className="space-y-2 rounded-lg border border-[color:var(--app-accent-ring)] bg-[color:var(--app-accent-soft)] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder={t("invoice.fullNamePlaceholder")}
                    value={newCustomerData.full_name}
                    onChange={(e) =>
                      setNewCustomerData({ ...newCustomerData, full_name: e.target.value })
                    }
                    className="col-span-2 rounded border border-app p-1.5"
                  />
                  <input
                    type="text"
                    placeholder={t("common.phone")}
                    value={newCustomerData.phone}
                    onChange={(e) =>
                      setNewCustomerData({ ...newCustomerData, phone: e.target.value })
                    }
                    className="rounded border border-app p-1.5"
                  />
                  <input
                    type="text"
                    placeholder={t("invoice.voen")}
                    value={newCustomerData.voen}
                    onChange={(e) =>
                      setNewCustomerData({ ...newCustomerData, voen: e.target.value })
                    }
                    className="rounded border border-app p-1.5"
                  />
                  <input
                    type="text"
                    placeholder={t("common.company")}
                    value={newCustomerData.company_name}
                    onChange={(e) =>
                      setNewCustomerData({ ...newCustomerData, company_name: e.target.value })
                    }
                    className="rounded border border-app p-1.5"
                  />
                  <input
                    type="text"
                    placeholder={t("invoice.addressLabel")}
                    value={newCustomerData.address}
                    onChange={(e) =>
                      setNewCustomerData({ ...newCustomerData, address: e.target.value })
                    }
                    className="rounded border border-app p-1.5"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddCustomer(false)}
                    className="app-input px-2 py-1 text-app-muted"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={savingCustomer}
                    onClick={handleSaveQuickCustomer}
                    className="rounded bg-[image:var(--app-gradient)] px-3 py-1 font-bold text-white disabled:opacity-50"
                  >
                    {savingCustomer ? t("common.saving") : t("common.save")}
                  </button>
                </div>
              </div>
            )}

            <select
              value={selectedCustomerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="w-full rounded-lg border border-app bg-app-card-hover p-2 font-semibold"
            >
              <option value="">{t("invoice.selectCustomer")}</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {customerLabel(c, t)}
                  {c.company_name ? ` (${c.company_name})` : ""}
                </option>
              ))}
            </select>
            {isOfficial && customerOptions.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">{t("official.noLegalCustomers")}</p>
            )}

            {selectedCustomer && (
              <div className="space-y-0.5 border-t border-app pt-2 text-[11px] text-app-muted">
                <p>
                  <strong>{t("invoice.tel")}:</strong> {selectedCustomer.phone || "-"}
                </p>
                <p>
                  <strong>{t("invoice.voen")}:</strong> {selectedCustomer.voen || "-"}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="px-0">
          <OfficialTransactionSection
            transactionType="sale"
            partyId={selectedCustomerId || null}
            partyName={selectedCustomer ? customerLabel(selectedCustomer, t) : undefined}
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

        <div className="app-table-wrap overflow-visible">
          <div className="flex flex-wrap items-center justify-between gap-3 app-toolbar px-4 py-3 text-xs font-bold">
            <span className="min-w-0 truncate">{t("invoice.invoiceItems")}</span>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              {!polywoodOnly ? (
                <button
                  type="button"
                  onClick={openProductSelectorModal}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[image:var(--app-gradient)] px-3 text-xs font-bold text-white shadow-sm hover:brightness-110"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t("invoice.productSelector.openModalButton")}</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={addRow}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-app bg-app-card px-3 text-xs font-semibold text-app hover:bg-app-card-hover"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t("forms.addRow")}</span>
              </button>
            </div>
          </div>

          {polywoodOnly && defaultWarehouse ? (
            <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900">
              <strong>{t("common.warehouse")}:</strong> {defaultWarehouse.name}
              <span className="ml-2 text-emerald-700">({t("polywood.invoice.onlyPolywoodProducts")})</span>
            </div>
          ) : null}

          <div className="relative z-0 overflow-visible border-b border-amber-200 bg-amber-50 px-4 py-3">
            <BarcodeScanField onScan={handleBarcodeScan} disabled={saving} />
          </div>

          <div className="overflow-visible">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-app-card-hover font-bold uppercase text-app">
                <tr>
                  <th className="px-3 py-3 w-8">№</th>
                  <th className="px-3 py-3">{t("invoice.productName")}</th>
                  {!polywoodOnly ? (
                    <th className="px-3 py-3 w-36">{t("common.warehouse")}</th>
                  ) : null}
                  <th className="px-3 py-3 w-20">{t("forms.quantity")}</th>
                  <th className="px-3 py-3 w-24">{t("forms.price")}</th>
                  <th className="px-3 py-3 w-20">{t("invoice.lineDiscount")}</th>
                  <th className="px-3 py-3 w-36">{t("invoice.info")}</th>
                  <th className="px-3 py-3 w-24 text-right">{t("forms.lineTotal")}</th>
                  <th className="px-3 py-3 w-10">{t("forms.remove")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 overflow-visible">
                {items.map((row, idx) => (
                  <tr key={row.id} className="overflow-visible">
                    <td className="px-3 py-3 font-mono text-app-muted">{idx + 1}</td>
                    <td className="relative overflow-visible px-3 py-3">
                      <div className="flex min-w-[220px] gap-1">
                        <div className="min-w-0 flex-1">
                          <ProductCombobox
                            instanceId={row.id}
                            products={
                              polywoodOnly
                                ? products
                                : filterProductsForWarehouse(products, row.warehouse_id, warehouses)
                            }
                            selectedId={row.product_id}
                            selectedName={row.product_name}
                            polywoodWarehouseId={
                              isPolywoodWarehouseRow(row.warehouse_id, warehouses)
                                ? row.warehouse_id
                                : polywoodOnly
                                  ? defaultWarehouse?.id || null
                                  : null
                            }
                            onSelect={(prod) => void handleProductSelect(row.id, prod)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setQuickAddProductRowId(row.id)}
                          title={t("invoice.createProduct")}
                          className="flex shrink-0 items-center justify-center self-start rounded border border-emerald-200 bg-emerald-50 px-2 py-2 text-emerald-700 hover:bg-emerald-100"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    {!polywoodOnly ? (
                      <td className="px-3 py-3">
                        <select
                          value={row.warehouse_id}
                          onChange={(e) => handleWarehouseSelect(row.id, e.target.value)}
                          className={INVOICE_INPUT}
                        >
                          <option value="">{t("invoice.warehouseOption")}</option>
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                        {row.product_id ? (
                          <div className="mt-1 text-[10px] text-app-muted">
                            {t("products.stock")}: {row.available_stock} {row.unit}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="px-3 py-3 align-top">
                      {polywoodOnly && row.product_id ? (
                        <div className="mb-2 space-y-1 text-[10px] text-app-muted">
                          <p>
                            {t("polywood.invoice.totalLength")}: {row.polywood_total_length_m ?? row.available_stock} m
                          </p>
                          <p>
                            {t("polywood.invoice.fullSheets")}: {row.polywood_full_sheet_count ?? 0} ×{" "}
                            {row.polywood_full_sheet_length_m ?? 4}m
                          </p>
                          <select
                            value={row.polywood_sale_mode || "linear_m"}
                            onChange={(e) =>
                              (() => {
                                const nextMode = e.target.value as "linear_m" | "full_sheet";
                                const sheetLen = row.polywood_full_sheet_length_m || 4;
                                const perMeterPrice =
                                  row.polywood_sale_mode === "full_sheet"
                                    ? row.unit_price / sheetLen
                                    : row.unit_price;
                                handleItemChange(row.id, {
                                  polywood_sale_mode: nextMode,
                                  unit: nextMode === "full_sheet" ? "Vərəq" : "Metr",
                                  unit_price: roundPrice(
                                    nextMode === "full_sheet"
                                      ? perMeterPrice * sheetLen
                                      : perMeterPrice
                                  ),
                                });
                              })()
                            }
                            className="mt-1 w-full rounded border border-app p-1 text-[10px]"
                          >
                            <option value="linear_m">{t("polywood.invoice.modeLinear")}</option>
                            <option value="full_sheet">{t("polywood.invoice.modeFullSheet")}</option>
                          </select>
                          <div className="mt-2 grid grid-cols-2 gap-1">
                            <label className="text-[10px]">
                              {t("polywood.invoice.lengthM")}
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                className="mt-0.5 w-full rounded border border-app p-1"
                                value={row.polywood_length_m ?? row.quantity ?? ""}
                                onChange={(e) => {
                                  const length = Number(e.target.value) || 0;
                                  const width = Number(row.polywood_width_m) || 0;
                                  const pieces = Number(row.polywood_pieces) || 1;
                                  handleItemChange(row.id, {
                                    polywood_length_m: length,
                                    quantity: length,
                                    polywood_total_area_m2:
                                      width > 0 ? length * width * pieces : null,
                                  });
                                }}
                              />
                            </label>
                            <label className="text-[10px]">
                              {t("polywood.invoice.widthM")}
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                className="mt-0.5 w-full rounded border border-app p-1"
                                value={row.polywood_width_m ?? ""}
                                onChange={(e) => {
                                  const width = Number(e.target.value) || 0;
                                  const length =
                                    Number(row.polywood_length_m ?? row.quantity) || 0;
                                  const pieces = Number(row.polywood_pieces) || 1;
                                  handleItemChange(row.id, {
                                    polywood_width_m: width,
                                    polywood_total_area_m2:
                                      width > 0 ? length * width * pieces : null,
                                  });
                                }}
                              />
                            </label>
                            <label className="text-[10px]">
                              {t("polywood.invoice.pieces")}
                              <input
                                type="number"
                                min="1"
                                step="1"
                                className="mt-0.5 w-full rounded border border-app p-1"
                                value={row.polywood_pieces ?? 1}
                                onChange={(e) => {
                                  const pieces = Math.max(1, Number(e.target.value) || 1);
                                  const length =
                                    Number(row.polywood_length_m ?? row.quantity) || 0;
                                  const width = Number(row.polywood_width_m) || 0;
                                  handleItemChange(row.id, {
                                    polywood_pieces: pieces,
                                    polywood_total_area_m2:
                                      width > 0 ? length * width * pieces : null,
                                  });
                                }}
                              />
                            </label>
                            <label className="text-[10px]">
                              {t("polywood.invoice.totalAreaM2")}
                              <input
                                type="number"
                                readOnly
                                className="mt-0.5 w-full rounded border border-app bg-app-surface p-1"
                                value={row.polywood_total_area_m2 ?? ""}
                              />
                            </label>
                            <label className="col-span-2 text-[10px]">
                              {t("polywood.invoice.cuttingOption")}
                              <select
                                className="mt-0.5 w-full rounded border border-app p-1"
                                value={row.polywood_cutting_option || ""}
                                onChange={(e) =>
                                  handleItemChange(row.id, {
                                    polywood_cutting_option: e.target.value || null,
                                  })
                                }
                              >
                                <option value="">{t("common.select")}</option>
                                <option value="straight">{t("polywood.invoice.cutStraight")}</option>
                                <option value="custom">{t("polywood.invoice.cutCustom")}</option>
                              </select>
                            </label>
                            <label className="col-span-2 text-[10px]">
                              {t("polywood.invoice.edgeOption")}
                              <select
                                className="mt-0.5 w-full rounded border border-app p-1"
                                value={row.polywood_edge_option || ""}
                                onChange={(e) =>
                                  handleItemChange(row.id, {
                                    polywood_edge_option: e.target.value || null,
                                  })
                                }
                              >
                                <option value="">{t("common.select")}</option>
                                <option value="none">{t("polywood.invoice.edgeNone")}</option>
                                <option value="banded">{t("polywood.invoice.edgeBanded")}</option>
                              </select>
                            </label>
                          </div>
                        </div>
                      ) : null}
                      <input
                        type="number"
                        min="0"
                        step={polywoodOnly && row.polywood_sale_mode === "linear_m" ? "0.001" : "1"}
                        value={row.quantity}
                        onChange={(e) =>
                          handleItemChange(row.id, { quantity: Number(e.target.value) || 0 })
                        }
                        className={`${INVOICE_INPUT} text-center`}
                      />
                      {polywoodOnly && row.polywood_sale_mode ? (
                        <p className="mt-0.5 text-center text-[10px] text-app-muted">
                          {row.polywood_sale_mode === "full_sheet"
                            ? t("polywood.invoice.qtySheets")
                            : t("polywood.invoice.qtyMeters")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        step="0.01"
                        value={row.unit_price}
                        onChange={(e) =>
                          handleItemChange(row.id, { unit_price: Number(e.target.value) || 0 })
                        }
                        className={`${INVOICE_INPUT} font-mono`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        step="0.1"
                        value={row.discount_percent}
                        onChange={(e) =>
                          handleItemChange(row.id, {
                            discount_percent: Number(e.target.value) || 0,
                          })
                        }
                        className={`${INVOICE_INPUT} text-center text-amber-700`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        placeholder={t("invoice.notePlaceholder")}
                        value={row.extra_info}
                        onChange={(e) => handleItemChange(row.id, { extra_info: e.target.value })}
                        className={INVOICE_INPUT}
                      />
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-bold tabular-nums">
                      {row.total.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="text-app-muted hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <div className={`${INVOICE_CARD} space-y-3`}>
            <h4 className="flex items-center gap-1.5 border-b border-app pb-2 text-sm font-bold text-app">
              <Truck className="h-4 w-4 shrink-0 text-app-accent" />
              <span className="truncate">{t("invoice.delivery")}</span>
            </h4>
            <label className="block min-w-0">
              <span className={INVOICE_LABEL}>{t("invoice.deliveryAddress")}</span>
              <input
                type="text"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder={t("invoice.addressPlaceholder")}
                className={INVOICE_INPUT}
              />
            </label>
            <label className="block min-w-0">
              <span className={INVOICE_LABEL}>{t("invoice.deliveryType")}</span>
              <select
                value={deliveryType}
                onChange={(e) => setDeliveryType(e.target.value as "paid" | "free")}
                className={INVOICE_INPUT}
              >
                <option value="free">{t("invoice.deliveryFree")}</option>
                <option value="paid">{t("invoice.deliveryPaid")}</option>
              </select>
            </label>
            {deliveryType === "paid" && (
              <label className="block min-w-0">
                <span className={INVOICE_LABEL}>{t("invoice.deliveryFee")}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(Number(e.target.value) || 0)}
                  className={`${INVOICE_INPUT} font-mono`}
                />
              </label>
            )}
            <label className="block min-w-0">
              <span className={INVOICE_LABEL}>{t("common.notes")}</span>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={INVOICE_TEXTAREA}
              />
            </label>
          </div>

          <DocumentAdditionalExpensesSection
            expenses={additionalExpenses}
            onChange={setAdditionalExpenses}
            accounts={accounts}
            disabled={saving}
            className="text-xs"
          />

          <div className={`${INVOICE_CARD} space-y-3`}>
            <div className="flex items-center justify-between gap-2 border-b border-app pb-2">
              <h4 className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-app">
                <CreditCard className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="truncate">{t("invoice.multiPayment")}</span>
              </h4>
              <button
                type="button"
                onClick={addPaymentRow}
                className="btn-secondary flex shrink-0 items-center gap-1 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("invoice.addAccount")}
              </button>
            </div>
            <OfficialPaymentSplitBanner amounts={officialAmounts} isOfficial={isOfficial} />
            <div className="space-y-2">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2 rounded-xl border border-app bg-app-card-hover p-2"
                >
                  <select
                    value={p.account_id}
                    onChange={(e) => handleAccountChange(p.id, e.target.value)}
                    className={INVOICE_INPUT}
                  >
                    <option value="">{t("invoice.accountOption")}</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {formatTreasuryAccountLabel(acc, t)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder={t("invoice.amountPlaceholder")}
                    value={p.amount}
                    onChange={(e) =>
                      updatePayment(p.id, { amount: Number(e.target.value) || 0 })
                    }
                    className={`${INVOICE_INPUT} text-right font-mono font-bold`}
                  />
                  <button
                    type="button"
                    onClick={() => removePaymentRow(p.id)}
                    className="flex h-9 items-center justify-center rounded-lg text-app-muted hover:bg-rose-500/10 hover:text-rose-600"
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-auto space-y-1 border-t border-app pt-2">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                <span className="text-app-muted">{t("invoice.paidTotal")}</span>
                <span className="font-mono tabular-nums text-emerald-600">
                  {totals.paid_amount.toFixed(2)} {t("common.currency")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                <span className="text-app-muted">{t("invoice.remainingDebt")}</span>
                <span className="font-mono tabular-nums text-rose-600">
                  {totals.remaining_balance.toFixed(2)} {t("common.currency")}
                </span>
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col justify-between gap-3 rounded-xl app-toolbar p-4 text-xs">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-4 text-slate-100">
                <span className="min-w-0 truncate">{t("invoice.subtotal")}</span>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {totals.subtotal.toFixed(2)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 text-rose-200">
                <span className="min-w-0 truncate">{t("invoice.lineDiscountTotal")}</span>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  -{displayTotals.line_discount_total.toFixed(2)}
                </span>
              </div>
              <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-300">
                  {t("invoice.globalDiscount")}
                </p>
                <div className="flex gap-2">
                  <select
                    value={globalDiscountMode}
                    onChange={(e) =>
                      setGlobalDiscountMode(e.target.value as GlobalDiscountMode)
                    }
                    className="w-1/3 rounded border border-white/20 bg-white/10 p-1.5 text-[11px]"
                  >
                    <option value="percent">%</option>
                    <option value="amount">AZN</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={globalDiscountValue}
                    onChange={(e) => setGlobalDiscountValue(Number(e.target.value) || 0)}
                    className="w-2/3 rounded border border-white/20 bg-white/10 p-1.5 text-right font-mono"
                  />
                </div>
                {displayTotals.global_discount_total > 0 ? (
                  <div className="flex items-baseline justify-between gap-4 text-rose-200">
                    <span className="min-w-0 truncate">{t("invoice.globalDiscountApplied")}</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      -{displayTotals.global_discount_total.toFixed(2)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex items-baseline justify-between gap-4 text-rose-200">
                <span className="min-w-0 truncate">{t("invoice.discountTotal")}</span>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  -{displayTotals.discount_total.toFixed(2)}
                </span>
              </div>
              {isOfficial ? (
                <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-300">
                    {t("invoice.vatToggleLabel")}
                  </p>
                  <div className="inline-flex overflow-hidden rounded-lg border border-white/20">
                    <button
                      type="button"
                      onClick={() => setVatMode("none")}
                      className={`px-3 py-1.5 text-[11px] font-semibold ${
                        vatMode === "none" ? "bg-slate-600 text-white" : "text-slate-300"
                      }`}
                    >
                      {t("invoice.vatOff")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVatMode("exclusive")}
                      className={`px-3 py-1.5 text-[11px] font-semibold ${
                        vatMode !== "none" ? "bg-emerald-600 text-white" : "text-slate-300"
                      }`}
                    >
                      {t("invoice.vatOn", { rate: defaultVatRate })}
                    </button>
                  </div>
                </div>
              ) : null}
              {totals.delivery_cost > 0 && (
                <div className="flex items-baseline justify-between gap-4 text-blue-200">
                  <span className="min-w-0 truncate">{t("invoice.deliveryCost")}</span>
                  <span className="shrink-0 font-mono text-sm tabular-nums">
                    +{totals.delivery_cost.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 text-amber-200">
                <span className="min-w-0 truncate">{t("forms.additionalExpenses")}</span>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  +{additionalExpensesTotal.toFixed(2)}
                </span>
              </div>
              {isOfficial ? (
                <OfficialTotalsBreakdown
                  amounts={officialAmounts}
                  isOfficial={isOfficial}
                  dark
                />
              ) : (
                <div className="flex items-baseline justify-between gap-4 border-t border-white/20 pt-3">
                  <span className="text-sm font-bold text-white">{t("invoice.grandTotal")}</span>
                  <span className="shrink-0 font-mono text-xl font-bold tabular-nums text-emerald-300">
                    {displayTotals.grand_total.toFixed(2)} {t("common.currency")}
                  </span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 hover:bg-white/20"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={saving || Boolean(salePreflightIssue)}
                title={salePreflightHint}
                onClick={handleSubmit}
                className="flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-5 py-2 font-bold hover:brightness-110 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? t("common.saving") : t("invoice.confirmSave")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {quickAddProductRowId && (
      <QuickAddProductModal
        onClose={() => setQuickAddProductRowId(null)}
        onCreated={(product) => {
          handleQuickProductCreated(product as Product, quickAddProductRowId);
          setQuickAddProductRowId(null);
        }}
      />
    )}

    {productSelectorOpen && productSelectorTargetRowId && !polywoodOnly ? (
      <InvoiceProductSelectorModal
        open
        products={filterProductsForWarehouse(
          products,
          items.find((row) => row.id === productSelectorTargetRowId)?.warehouse_id || "",
          warehouses
        )}
        onClose={() => {
          setProductSelectorOpen(false);
          setProductSelectorTargetRowId(null);
        }}
        onSelect={(product, quantity, closeAfter) => {
          void handleModalProductSelect(product, quantity, closeAfter);
        }}
      />
    ) : null}

    <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
