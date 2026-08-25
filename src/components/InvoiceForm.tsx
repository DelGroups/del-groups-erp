"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
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
import QuickAddProductModal from "@/components/purchases/QuickAddProductModal";
import BarcodeScanField from "@/components/documents/BarcodeScanField";
import ResponsiblePersonField from "@/components/documents/ResponsiblePersonField";
import { useResponsiblePerson } from "@/hooks/useResponsiblePerson";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchProductByBarcode, findProductByBarcodeInList } from "@/lib/products/barcode";
import {
  Building2,
  ChevronDown,
  CreditCard,
  Plus,
  Save,
  Search,
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
}

interface Employee {
  id: string;
  full_name?: string;
  name?: string;
}

interface Warehouse {
  id: string;
  name: string;
}

interface Account {
  id: string;
  name: string;
  type?: string;
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
  vat_rate?: number;
  tax_rate?: number;
  discount_percent?: number;
  discount?: number;
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

function productCode(p: Product) {
  return (p.code || p.sku || "").trim();
}

function productOptionLabel(p: Product) {
  const code = productCode(p) || "-";
  const barcode = (p.barcode || "").trim() || "-";
  return `${p.name} (Code: ${code} | Barcode: ${barcode})`;
}

function productMatches(p: Product, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (p.name || "").toLowerCase().includes(q) ||
    (p.code || "").toLowerCase().includes(q) ||
    (p.sku || "").toLowerCase().includes(q) ||
    (p.barcode || "").toLowerCase().includes(q)
  );
}

function ProductCombobox({
  products,
  selectedId,
  selectedName,
  onSelect,
}: {
  products: Product[];
  selectedId: string;
  selectedName: string;
  onSelect: (product: Product | null) => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selectedName);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!open) setQuery(selectedName || "");
  }, [selectedName, open]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = q ? products.filter((p) => productMatches(p, q)) : products;
    return list.slice(0, 80);
  }, [products, query]);

  const exactScanMatch = useMemo(() => {
    const raw = query.trim();
    if (!raw) return null;
    const barcodeHits = products.filter(
      (p) => (p.barcode || "").trim().toLowerCase() === raw.toLowerCase()
    );
    if (barcodeHits.length === 1) return barcodeHits[0];
    const codeHits = products.filter(
      (p) => productCode(p).toLowerCase() === raw.toLowerCase()
    );
    if (codeHits.length === 1) return codeHits[0];
    return null;
  }, [products, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    const option = listRef.current?.querySelector(`[data-index="${highlight}"]`);
    option?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = useCallback(
    (product: Product | null) => {
      onSelect(product);
      setQuery(product ? product.name : "");
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSelect]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery(selectedName || "");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (exactScanMatch) {
        choose(exactScanMatch);
        return;
      }
      if (!open) {
        setOpen(true);
        return;
      }
      const picked = filtered[highlight];
      if (picked) choose(picked);
    }
  };

  return (
    <div ref={rootRef} className="relative z-[9998] min-w-[220px] overflow-visible">
      <div className="relative">
        <Search className="pointer-events-none absolute left-1.5 top-1.5 h-3.5 w-3.5 text-app-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`product-combobox-list-${selectedId || "new"}`}
          value={query}
          placeholder={t("invoice.productSearchPlaceholder")}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value) onSelect(null);
          }}
          onKeyDown={handleKeyDown}
          className="w-full rounded border border-app py-1 pl-6 pr-6 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-[color:var(--app-accent-ring)]"
        />
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1.5 h-3.5 w-3.5 text-app-muted" />
      </div>

      {open && (
        <div
          id={`product-combobox-list-${selectedId || "new"}`}
          ref={listRef}
          role="listbox"
          className="app-dropdown-panel absolute left-0 top-full z-[9999] mt-1 max-h-56 w-[min(420px,70vw)] overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-app-muted">{t("invoice.productNotFound")}</div>
          ) : (
            filtered.map((p, idx) => {
              const active = idx === highlight;
              const selected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  data-index={idx}
                  aria-selected={selected}
                  onMouseEnter={() => setHighlight(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p)}
                  className={`flex w-full flex-col items-start px-3 py-1.5 text-left ${
                    active ? "app-dropdown-item-active" : "bg-app-card"
                  } ${selected ? "font-semibold" : ""}`}
                >
                  <span className="text-xs text-app">{productOptionLabel(p)}</span>
                  <span className="text-[10px] text-app-muted">
                    {t("invoice.stockLabel", {
                      stock: Number(p.stock) || 0,
                      unit: p.unit || "Ədəd",
                      price: productPrice(p).toFixed(2),
                    })}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function UniversalInvoiceForm({
  isOpen,
  onClose,
  onSuccess,
}: InvoiceFormProps) {
  const [docNo, setDocNo] = useState("");
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [sellerName, setSellerName] = useState("");

  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryType, setDeliveryType] = useState<"paid" | "free">("free");
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [notes, setNotes] = useState("");

  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    full_name: "",
    phone: "",
    company_name: "",
    address: "",
    voen: "",
  });

  const [items, setItems] = useState<SaleItem[]>([createEmptySaleItem()]);
  const [payments, setPayments] = useState<SalePayment[]>([
    { id: "1", account_id: "", method: "Nəğd", amount: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [quickAddProductRowId, setQuickAddProductRowId] = useState<string | null>(null);
  const { message: toastMessage, showError: showToastError } = useToast();
  const { can } = useAuth();
  const { t } = useI18n();
  const canSaveInvoice = can("can_create_invoice");

  const defaultWarehouse = warehouses[0];

  useEffect(() => {
    if (!isOpen) return;

    setDocNo(`SS-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`);
    setDocDate(new Date().toISOString().slice(0, 10));
    setSelectedCustomerId("");
    setSelectedCustomer(null);
    setSelectedSellerId("");
    setSellerName("");
    setDeliveryAddress("");
    setDeliveryType("free");
    setDeliveryFee(0);
    setNotes("");
    setShowAddCustomer(false);
    setNewCustomerData({
      full_name: "",
      phone: "",
      company_name: "",
      address: "",
      voen: "",
    });
    setItems([createEmptySaleItem()]);
    setPayments([{ id: "1", account_id: "", method: "Nəğd", amount: 0 }]);
    setQuickAddProductRowId(null);
    void fetchInitialData();
  }, [isOpen]);

  const fetchInitialData = async () => {
    const [{ data: cust }, { data: emp }, { data: wh }, { data: acc }, { data: prod }] =
      await Promise.all([
        supabase.from("customers").select("*").order("created_at", { ascending: false }),
        supabase.from("employees").select("*"),
        supabase.from("warehouses").select("*").order("created_at", { ascending: true }),
        supabase.from("accounts").select("*").order("created_at", { ascending: true }),
        supabase.from("products").select("*").order("name", { ascending: true }),
      ]);

    if (cust) setCustomers(cust as Customer[]);
    if (emp) setEmployees(emp);

    const warehouseRows = (wh as Warehouse[]) || [];
    setWarehouses(warehouseRows);
    const firstWh = warehouseRows[0];
    setItems([createEmptySaleItem(firstWh?.id || "", firstWh?.name || "")]);

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

    if (prod) setProductsList(prod as Product[]);
  };

  const handleCustomerChange = (id: string) => {
    setSelectedCustomerId(id);
    const found = customers.find((c) => c.id === id) || null;
    setSelectedCustomer(found);
    if (found?.address) setDeliveryAddress(found.address);
  };

  const handleSaveQuickCustomer = async () => {
    if (!newCustomerData.full_name.trim()) {
      alert(t("invoice.enterCustomerName"));
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
      alert(t("common.errorOccurred", { message: error.message }));
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

  const handleProductSelect = (rowId: string, prod: Product | null) => {
    if (!prod) {
      handleItemChange(rowId, {
        product_id: "",
        product_code: "",
        product_name: "",
        unit_price: 0,
        discount_percent: 0,
        vat_rate: 0,
        available_stock: 0,
      });
      return;
    }

    handleItemChange(rowId, {
      product_id: prod.id,
      product_code: productCode(prod),
      product_name: prod.name,
      unit: prod.unit || "Ədəd",
      unit_price: productPrice(prod),
      discount_percent: Number(prod.discount_percent ?? prod.discount) || 0,
      vat_rate: Number(prod.vat_rate ?? prod.tax_rate) || 0,
      available_stock: Number(prod.stock) || 0,
    });
  };

  const handleQuickProductCreated = (product: Product, rowId: string) => {
    setProductsList((prev) => [product, ...prev.filter((p) => p.id !== product.id)]);
    handleProductSelect(rowId, product);
  };

  const applyProductToSaleRow = (row: SaleItem, prod: Product, quantity?: number): SaleItem => {
    const updated: SaleItem = {
      ...row,
      product_id: prod.id,
      product_code: productCode(prod),
      product_name: prod.name,
      unit: prod.unit || "Ədəd",
      unit_price: productPrice(prod),
      discount_percent: Number(prod.discount_percent ?? prod.discount) || 0,
      vat_rate: Number(prod.vat_rate ?? prod.tax_rate) || 0,
      available_stock: Number(prod.stock) || 0,
      quantity: quantity ?? row.quantity,
    };
    updated.total = calcLineTotal(updated.quantity, updated.unit_price, updated.discount_percent);
    return updated;
  };

  const handleBarcodeScan = async (barcode: string) => {
    let product = findProductByBarcodeInList(productsList, barcode) as Product | null;
    if (!product) {
      const fetched = await fetchProductByBarcode(barcode);
      if (fetched) {
        product = fetched as Product;
        setProductsList((prev) => [product!, ...prev.filter((p) => p.id !== product!.id)]);
      }
    }
    if (!product) {
      showToastError(t("invoice.barcodeNotFound", { barcode }));
      return;
    }

    setItems((prev) => {
      const existing = prev.find((r) => r.product_id === product!.id);
      if (existing) {
        return prev.map((row) => {
          if (row.id !== existing.id) return row;
          return applyProductToSaleRow(row, product!, row.quantity + 1);
        });
      }

      const emptyRow = prev.find((r) => !r.product_id && !r.product_name.trim());
      if (emptyRow) {
        return prev.map((row) =>
          row.id === emptyRow.id ? applyProductToSaleRow(row, product!, 1) : row
        );
      }

      const newRow = createEmptySaleItem(
        defaultWarehouse?.id || "",
        defaultWarehouse?.name || ""
      );
      return [...prev, applyProductToSaleRow(newRow, product!, 1)];
    });
  };

  const handleWarehouseSelect = (rowId: string, warehouseId: string) => {
    const wh = warehouses.find((w) => w.id === warehouseId);
    handleItemChange(rowId, {
      warehouse_id: warehouseId,
      warehouse_name: wh?.name || "",
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
    const acc = accounts.find((a) => a.id === accountId);
    updatePayment(paymentId, {
      account_id: accountId,
      method: acc?.name || "",
    });
  };

  const removePaymentRow = (id: string) => {
    if (payments.length === 1) return;
    setPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const totals = useMemo(
    () => calcSaleTotals(items, payments, deliveryType, deliveryFee),
    [items, payments, deliveryType, deliveryFee]
  );
  const { locked: sellerLocked, lockedEmployeeId, lockedName } =
    useResponsiblePerson(employees);
  const effectiveSellerId = sellerLocked ? lockedEmployeeId : selectedSellerId;
  const seller = employees.find((e) => e.id === effectiveSellerId);
  const effectiveSellerName = sellerLocked
    ? lockedName
    : seller
      ? employeeLabel(seller, t)
      : sellerName;

  const handleSellerChange = (employeeId: string, displayName: string) => {
    setSelectedSellerId(employeeId);
    setSellerName(displayName);
  };

  const handleClose = () => {
    onClose?.();
  };

  const handleSubmit = async () => {
    if (!canSaveInvoice) {
      alert(t("invoice.noPermission"));
      return;
    }
    if (!selectedCustomerId) {
      alert(t("invoice.selectCustomerAlert"));
      return;
    }
    if (items.every((i) => !i.product_id && !i.product_name)) {
      alert(t("invoice.addProductAlert"));
      return;
    }

    setSaving(true);
    const primaryWarehouse =
      items.find((i) => i.warehouse_name)?.warehouse_name || defaultWarehouse?.name || "";
    const saleItems = items.filter((i) => i.product_id || i.product_name.trim());

    const salesPayload: SaleInsert = {
      doc_no: docNo,
      doc_date: docDate,
      customer_id: selectedCustomerId,
      customer_name: selectedCustomer ? customerLabel(selectedCustomer, t) : "",
      seller_id: effectiveSellerId || null,
      seller_name: effectiveSellerName,
      warehouse_name: primaryWarehouse,
      subtotal: totals.subtotal,
      discount_total: totals.discount_total,
      vat_total: totals.vat_total,
      total_amount: totals.grand_total,
      paid_amount: totals.paid_amount,
      remaining_balance: totals.remaining_balance,
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
      totals,
      docNo,
    });

    if (!result.success) {
      setSaving(false);
      alert(t("common.errorOccurred", { message: result.error ?? t("common.error") }));
      return;
    }

    setSaving(false);
    alert(t("invoice.saveSuccess"));
    onSuccess?.();
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-6xl space-y-4 rounded-2xl border border-app bg-app-card-hover p-5 shadow-sm">
        <div className="app-card flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-app">{t("invoice.newSaleTitle")}</h2>
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
              {t("invoice.salesManager")}
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
                    className="rounded bg-blue-600 px-3 py-1 font-bold text-white disabled:opacity-50"
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
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {customerLabel(c, t)}
                  {c.company_name ? ` (${c.company_name})` : ""}
                </option>
              ))}
            </select>

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

        <div className="app-table-wrap overflow-visible">
          <div className="flex items-center justify-between bg-slate-900 px-4 py-2.5 text-xs font-bold text-white">
            <span>{t("invoice.invoiceItems")}</span>
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[11px] hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("forms.addRow")}
            </button>
          </div>

          <div className="relative z-0 overflow-visible border-b border-amber-200 bg-amber-50 px-4 py-3">
            <BarcodeScanField onScan={handleBarcodeScan} disabled={saving} />
          </div>

          <div className="overflow-visible">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-app-card-hover font-bold uppercase text-app">
                <tr>
                  <th className="p-2.5 w-8">№</th>
                  <th className="p-2.5">{t("invoice.productName")}</th>
                  <th className="p-2.5 w-36">{t("common.warehouse")}</th>
                  <th className="p-2.5 w-20">{t("forms.quantity")}</th>
                  <th className="p-2.5 w-24">{t("forms.price")}</th>
                  <th className="p-2.5 w-20">{t("invoice.discount")}</th>
                  <th className="p-2.5 w-36">{t("invoice.info")}</th>
                  <th className="p-2.5 w-24 text-right">{t("forms.lineTotal")}</th>
                  <th className="p-2.5 w-10">{t("forms.remove")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 overflow-visible">
                {items.map((row, idx) => (
                  <tr key={row.id} className="overflow-visible">
                    <td className="p-2.5 font-mono text-app-muted">{idx + 1}</td>
                    <td className="relative z-[9997] overflow-visible p-2.5">
                      <div className="flex min-w-[220px] gap-1">
                        <div className="min-w-0 flex-1">
                          <ProductCombobox
                            products={productsList}
                            selectedId={row.product_id}
                            selectedName={row.product_name}
                            onSelect={(prod) => handleProductSelect(row.id, prod)}
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
                    <td className="p-2.5">
                      <select
                        value={row.warehouse_id}
                        onChange={(e) => handleWarehouseSelect(row.id, e.target.value)}
                        className="w-full rounded border border-app p-1"
                      >
                        <option value="">{t("invoice.warehouseOption")}</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      {row.product_id ? (
                        <p className="mt-0.5 text-[10px] text-app-muted">
                          {t("products.stock")}: {row.available_stock} {row.unit}
                        </p>
                      ) : null}
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        min="0"
                        value={row.quantity}
                        onChange={(e) =>
                          handleItemChange(row.id, { quantity: Number(e.target.value) || 0 })
                        }
                        className="w-full rounded border border-app p-1 text-center"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.01"
                        value={row.unit_price}
                        onChange={(e) =>
                          handleItemChange(row.id, { unit_price: Number(e.target.value) || 0 })
                        }
                        className="w-full rounded border border-app p-1 font-mono"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.1"
                        value={row.discount_percent}
                        onChange={(e) =>
                          handleItemChange(row.id, {
                            discount_percent: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full rounded border border-app p-1 text-center text-amber-700"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="text"
                        placeholder={t("invoice.notePlaceholder")}
                        value={row.extra_info}
                        onChange={(e) => handleItemChange(row.id, { extra_info: e.target.value })}
                        className="w-full rounded border border-app p-1"
                      />
                    </td>
                    <td className="p-2.5 text-right font-mono font-bold">
                      {row.total.toFixed(2)}
                    </td>
                    <td className="p-2.5 text-center">
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="app-card space-y-2 p-4 text-xs">
            <h4 className="flex items-center gap-1.5 border-b border-app pb-2 font-bold text-app">
              <Truck className="h-4 w-4 text-app-accent" />
              {t("invoice.delivery")}
            </h4>
            <label className="block font-semibold text-app-muted">
              {t("invoice.deliveryAddress")}
              <input
                type="text"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder={t("invoice.addressPlaceholder")}
                className="mt-1 w-full rounded-lg border border-app p-2 font-normal"
              />
            </label>
            <label className="block font-semibold text-app-muted">
              {t("invoice.deliveryType")}
              <select
                value={deliveryType}
                onChange={(e) => setDeliveryType(e.target.value as "paid" | "free")}
                className="mt-1 w-full rounded-lg border border-app bg-app-card-hover p-2 font-semibold"
              >
                <option value="free">{t("invoice.deliveryFree")}</option>
                <option value="paid">{t("invoice.deliveryPaid")}</option>
              </select>
            </label>
            {deliveryType === "paid" && (
              <label className="block font-semibold text-app-muted">
                {t("invoice.deliveryFee")}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-app p-2 font-mono"
                />
              </label>
            )}
            <label className="block font-semibold text-app-muted">
              {t("common.notes")}
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-app p-2 font-normal"
              />
            </label>
          </div>

          <div className="app-card space-y-2 p-4 text-xs">
            <div className="flex items-center justify-between border-b border-app pb-2">
              <h4 className="flex items-center gap-1.5 font-bold text-app">
                <CreditCard className="h-4 w-4 text-emerald-600" />
                {t("invoice.multiPayment")}
              </h4>
              <button
                type="button"
                onClick={addPaymentRow}
                className="flex items-center gap-1 text-[11px] font-bold text-app-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("invoice.addAccount")}
              </button>
            </div>
            {payments.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <select
                  value={p.account_id}
                  onChange={(e) => handleAccountChange(p.id, e.target.value)}
                  className="w-1/2 rounded border border-app p-1.5"
                >
                  <option value="">{t("invoice.accountOption")}</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
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
                  className="w-1/2 rounded border border-app p-1.5 text-right font-mono font-bold"
                />
                <button
                  type="button"
                  onClick={() => removePaymentRow(p.id)}
                  className="text-app-muted hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex justify-between border-t border-app pt-2 font-semibold">
              <span className="text-app-muted">{t("invoice.paidTotal")}</span>
              <span className="font-mono text-emerald-600">{totals.paid_amount.toFixed(2)} {t("common.currency")}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-app-muted">{t("invoice.remainingDebt")}</span>
              <span className="font-mono text-rose-600">{totals.remaining_balance.toFixed(2)} AZN</span>
            </div>
          </div>

          <div className="flex flex-col justify-between space-y-3 rounded-xl bg-slate-900 p-4 text-xs text-white">
            <div className="space-y-1.5">
              <div className="flex justify-between text-slate-300">
                <span>{t("invoice.subtotal")}</span>
                <span className="font-mono">{totals.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-rose-300">
                <span>{t("invoice.discountTotal")}</span>
                <span className="font-mono">-{totals.discount_total.toFixed(2)}</span>
              </div>
              {totals.delivery_cost > 0 && (
                <div className="flex justify-between text-blue-300">
                  <span>{t("invoice.deliveryCost")}</span>
                  <span className="font-mono">+{totals.delivery_cost.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-700 pt-2 text-sm font-bold">
                <span>{t("invoice.grandTotal")}</span>
                <span className="font-mono text-lg text-emerald-400">
                  {totals.grand_total.toFixed(2)} {t("common.currency")}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-slate-800 px-4 py-2 hover:bg-slate-700"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={saving || !canSaveInvoice}
                onClick={handleSubmit}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-5 py-2 font-bold hover:bg-blue-700 disabled:opacity-50"
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

    <ToastMessage message={toastMessage} />
    </>
  );
}
