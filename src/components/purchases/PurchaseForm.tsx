"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Save, Trash2, User, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type {
  Product,
  PurchaseLineItem,
  PurchaseRecord,
  Supplier,
  Warehouse,
} from "@/types/database.types";
import {
  calcPurchaseGrandTotal,
  calcPurchaseLineTotal,
  calcPurchasePaymentsTotal,
  createEmptyPurchaseLineItem,
  createEmptyPurchasePayment,
  generatePurchaseInvoiceNumber,
  type PurchasePaymentRow,
} from "@/lib/purchases/helpers";
import { useAuth } from "@/components/auth/AuthProvider";
import { useI18n } from "@/i18n/I18nProvider";
import { submitPurchase, updatePurchase } from "@/lib/purchases/submitPurchase";
import QuickAddSupplierModal from "@/components/purchases/QuickAddSupplierModal";
import QuickAddProductModal from "@/components/purchases/QuickAddProductModal";
import BarcodeScanField from "@/components/documents/BarcodeScanField";
import ResponsiblePersonField from "@/components/documents/ResponsiblePersonField";
import { useResponsiblePerson } from "@/hooks/useResponsiblePerson";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";
import { fetchProductByBarcode, findProductByBarcodeInList } from "@/lib/products/barcode";

interface Account {
  id: string;
  name: string;
  type: string;
}

interface EmployeeOption {
  id: string;
  full_name: string | null;
}

interface PurchaseFormProps {
  suppliers: Supplier[];
  products: Product[];
  warehouses: Warehouse[];
  mode?: "create" | "edit";
  initialPurchase?: PurchaseRecord | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function PurchaseForm({
  suppliers: suppliersProp,
  products: productsProp,
  warehouses,
  mode = "create",
  initialPurchase = null,
  onSuccess,
  onCancel,
}: PurchaseFormProps) {
  const isEdit = mode === "edit" && !!initialPurchase;
  const existingPaid = isEdit ? Number(initialPurchase?.paid_amount ?? 0) : 0;

  const [supplierList, setSupplierList] = useState(suppliersProp);
  const [productList, setProductList] = useState(productsProp);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [quickAddProductRowId, setQuickAddProductRowId] = useState<string | null>(null);

  const [invoiceNumber] = useState(
    () => initialPurchase?.invoice_number || generatePurchaseInvoiceNumber()
  );
  const [docDate, setDocDate] = useState(
    initialPurchase?.doc_date ||
      initialPurchase?.created_at?.slice(0, 10) ||
      new Date().toISOString().slice(0, 10)
  );
  const [supplierId, setSupplierId] = useState(initialPurchase?.supplier_id || "");
  const [warehouseId, setWarehouseId] = useState(
    initialPurchase?.warehouse_id || warehouses[0]?.id || ""
  );
  const [responsibleId, setResponsibleId] = useState(
    initialPurchase?.responsible_id || ""
  );
  const [responsibleName, setResponsibleName] = useState(
    initialPurchase?.responsible_name || ""
  );
  const [notes, setNotes] = useState(initialPurchase?.notes || "");
  const [items, setItems] = useState<PurchaseLineItem[]>(
    initialPurchase?.items?.length
      ? initialPurchase.items
      : [createEmptyPurchaseLineItem()]
  );
  const [payments, setPayments] = useState<PurchasePaymentRow[]>([
    createEmptyPurchasePayment(),
  ]);
  const [saving, setSaving] = useState(false);
  const { message: toastMessage, showError: showToastError } = useToast();
  const { can } = useAuth();
  const { t } = useI18n();
  const canSavePurchase = isEdit ? can("can_edit_purchases") : can("can_create_purchase");

  useEffect(() => {
    setSupplierList(suppliersProp);
  }, [suppliersProp]);

  useEffect(() => {
    setProductList(productsProp);
  }, [productsProp]);

  useEffect(() => {
    if (warehouses[0] && !warehouseId) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  useEffect(() => {
    void supabase
      .from("accounts")
      .select("id, name, type")
      .order("name")
      .then(({ data }) => {
        const rows = (data as Account[]) || [];
        setAccounts(rows);
        if (rows[0]) {
          setPayments((prev) =>
            prev.map((p, idx) =>
              idx === 0 && !p.account_id ? { ...p, account_id: rows[0].id } : p
            )
          );
        }
      });
  }, []);

  useEffect(() => {
    void supabase
      .from("employees")
      .select("id, full_name")
      .order("full_name")
      .then(({ data }) => setEmployees((data as EmployeeOption[]) || []));
  }, []);

  const { locked: responsibleLocked, lockedEmployeeId, lockedName } =
    useResponsiblePerson(employees);
  const effectiveResponsibleId = responsibleLocked ? lockedEmployeeId : responsibleId;
  const effectiveResponsibleName = responsibleLocked ? lockedName : responsibleName;

  const handleResponsibleChange = (employeeId: string, displayName: string) => {
    setResponsibleId(employeeId);
    setResponsibleName(displayName);
  };

  const grandTotal = useMemo(() => calcPurchaseGrandTotal(items), [items]);
  const newPaymentsTotal = useMemo(() => calcPurchasePaymentsTotal(payments), [payments]);
  const totalPaid = existingPaid + newPaymentsTotal;
  const debt = Math.max(0, grandTotal - totalPaid);
  const status = debt > 0 ? t("forms.statusDebtor") : t("forms.statusPaid");

  const updateItem = (id: string, patch: Partial<PurchaseLineItem>) => {
    setItems((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, ...patch };
        updated.total = calcPurchaseLineTotal(updated.quantity, updated.unit_price);
        return updated;
      })
    );
  };

  const handleProductSelect = (rowId: string, productId: string) => {
    const product = productList.find((p) => p.id === productId);
    if (!product) {
      updateItem(rowId, {
        product_id: "",
        product_code: "",
        product_name: "",
        unit_price: 0,
        total: 0,
      });
      return;
    }
    const qty = items.find((r) => r.id === rowId)?.quantity || 1;
    updateItem(rowId, {
      product_id: product.id,
      product_code: product.code,
      product_name: product.name,
      unit: product.unit || "Ədəd",
      unit_price: Number(product.buy_price) || 0,
      total: calcPurchaseLineTotal(qty, Number(product.buy_price) || 0),
    });
  };

  const handleProductCreated = (product: Product, rowId: string) => {
    setProductList((prev) => [product, ...prev]);
    handleProductSelect(rowId, product.id);
  };

  const applyProductToPurchaseRow = (
    row: PurchaseLineItem,
    product: Product,
    quantity: number
  ): PurchaseLineItem => ({
    ...row,
    product_id: product.id,
    product_code: product.code,
    product_name: product.name,
    unit: product.unit || "Ədəd",
    unit_price: Number(product.buy_price) || 0,
    quantity,
    total: calcPurchaseLineTotal(quantity, Number(product.buy_price) || 0),
  });

  const handleBarcodeScan = async (barcode: string) => {
    let product = findProductByBarcodeInList(productList, barcode);
    if (!product) {
      const fetched = await fetchProductByBarcode(barcode);
      if (fetched) {
        product = fetched;
        setProductList((prev) => [fetched, ...prev.filter((p) => p.id !== fetched.id)]);
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
          const quantity = row.quantity + 1;
          return {
            ...row,
            quantity,
            total: calcPurchaseLineTotal(quantity, row.unit_price),
          };
        });
      }

      const emptyRow = prev.find((r) => !r.product_id && !r.product_name.trim());
      if (emptyRow) {
        return prev.map((row) =>
          row.id === emptyRow.id ? applyProductToPurchaseRow(row, product!, 1) : row
        );
      }

      return [...prev, applyProductToPurchaseRow(createEmptyPurchaseLineItem(), product!, 1)];
    });
  };

  const handleSupplierCreated = (supplier: Supplier) => {
    setSupplierList((prev) => [supplier, ...prev]);
    setSupplierId(supplier.id);
  };

  const addRow = () => setItems((prev) => [...prev, createEmptyPurchaseLineItem()]);
  const removeRow = (id: string) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((row) => row.id !== id));
  };

  const addPaymentRow = () => {
    setPayments((prev) => [
      ...prev,
      {
        ...createEmptyPurchasePayment(),
        account_id: accounts[0]?.id || "",
      },
    ]);
  };

  const updatePayment = (id: string, patch: Partial<PurchasePaymentRow>) => {
    setPayments((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePaymentRow = (id: string) => {
    if (payments.length === 1) return;
    setPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSubmit = async () => {
    if (!canSavePurchase) {
      alert(t("forms.noPurchasePermission"));
      return;
    }
    if (!supplierId) {
      alert(t("forms.selectSupplier"));
      return;
    }
    if (!warehouseId) {
      alert(t("forms.selectWarehouse"));
      return;
    }
    if (totalPaid > grandTotal + 0.001) {
      alert(t("forms.paymentsExceedTotal"));
      return;
    }

    const paymentsToProcess = payments.filter((p) => p.account_id && p.amount > 0);

    setSaving(true);
    const header = {
      invoice_number: invoiceNumber,
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      doc_date: docDate,
      responsible_id: effectiveResponsibleId || null,
      responsible_name: effectiveResponsibleName || null,
      total_amount: grandTotal,
      paid_amount: totalPaid,
      debt_amount: debt,
      status,
      notes: notes.trim() || null,
    };

    const result = isEdit
      ? await updatePurchase(
          initialPurchase!.id,
          { header, items, invoiceNumber, payments: paymentsToProcess },
          initialPurchase!.items,
          initialPurchase!.debt_amount,
          initialPurchase!.supplier_id || ""
        )
      : await submitPurchase({ header, items, invoiceNumber, payments: paymentsToProcess });

    setSaving(false);
    if (!result.success) {
      alert(t("common.errorOccurred", { message: result.error ?? t("common.error") }));
      return;
    }
    onSuccess?.();
  };

  return (
    <>
      <div className="space-y-4 rounded-2xl border border-app bg-app-card-hover p-5">
        <div className="app-card flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-app">
              {isEdit ? t("forms.purchaseEditTitle") : t("forms.purchaseNewTitle")}
            </h2>
            <p className="text-[11px] text-app-muted">
              {t("forms.invoiceNoLabel")}:{" "}
              <span className="font-mono font-semibold text-emerald-600">{invoiceNumber}</span>
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="app-card grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block text-xs font-semibold text-app">
            {t("common.date")}
            <input
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-semibold text-app">
            {t("forms.supplier")}
            <div className="mt-1 flex gap-1">
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="min-w-0 flex-1 app-input text-sm"
              >
                <option value="">{t("common.select")}</option>
                {supplierList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                    {s.company_name ? ` (${s.company_name})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowSupplierModal(true)}
                title={t("forms.addSupplier")}
                className="flex shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-emerald-700 hover:bg-emerald-100"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </label>
          <label className="block text-xs font-semibold text-app">
            {t("forms.targetWarehouse")}
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="app-input mt-1 text-sm"
            >
              <option value="">{t("common.select")}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="block text-xs font-semibold text-app">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-emerald-600" />
              {t("forms.responsiblePerson")}
            </span>
            <div className="mt-1">
              <ResponsiblePersonField
                employees={employees}
                value={effectiveResponsibleId}
                onChange={handleResponsibleChange}
                className="app-input text-sm"
              />
            </div>
          </div>
        </div>

        <div className="app-table-wrap">
          <div className="flex items-center justify-between app-toolbar px-4 py-2.5 text-xs font-bold">
            <span>{t("forms.receivedProducts")}</span>
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("forms.addRow")}
            </button>
          </div>

          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
            <BarcodeScanField
              onScan={handleBarcodeScan}
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-app-card-hover font-bold uppercase text-app">
                <tr>
                  <th className="w-8 p-2.5">№</th>
                  <th className="p-2.5">{t("dashboard.product")}</th>
                  <th className="w-24 p-2.5">{t("forms.quantity")}</th>
                  <th className="w-28 p-2.5">{t("forms.buyPrice")}</th>
                  <th className="w-24 p-2.5 text-right">{t("forms.lineTotal")}</th>
                  <th className="w-10 p-2.5">{t("forms.remove")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((row, idx) => (
                  <tr key={row.id}>
                    <td className="p-2.5 font-mono text-app-muted">{idx + 1}</td>
                    <td className="p-2.5">
                      <div className="flex min-w-[240px] gap-1">
                        <select
                          value={row.product_id}
                          onChange={(e) => handleProductSelect(row.id, e.target.value)}
                          className="min-w-0 flex-1 rounded border px-2 py-1.5"
                        >
                          <option value="">{t("forms.selectProduct")}</option>
                          {productList.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.code})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setQuickAddProductRowId(row.id)}
                          title={t("forms.createProduct")}
                          className="flex shrink-0 items-center justify-center rounded border border-emerald-200 bg-emerald-50 px-2 text-emerald-700 hover:bg-emerald-100"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.quantity}
                        onChange={(e) =>
                          updateItem(row.id, { quantity: Number(e.target.value) || 0 })
                        }
                        className="w-full rounded border px-2 py-1 text-center"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.unit_price}
                        onChange={(e) =>
                          updateItem(row.id, { unit_price: Number(e.target.value) || 0 })
                        }
                        className="w-full rounded border px-2 py-1 font-mono"
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

        <div className="app-table-wrap">
          <div className="flex items-center justify-between border-b border-app bg-app-card-hover px-4 py-2.5">
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-app">
              <CreditCard className="h-4 w-4 text-emerald-600" />
              {t("forms.paymentsSection")}
            </h4>
            <button
              type="button"
              onClick={addPaymentRow}
              className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("forms.addPayment")}
            </button>
          </div>
          <div className="space-y-2 p-4">
            {isEdit && existingPaid > 0 && (
              <p className="rounded-lg bg-[color:var(--app-accent-soft)] px-3 py-2 text-[11px] text-app-accent">
                {t("forms.existingPaymentsHint", {
                  amount: `${existingPaid.toFixed(2)} ${t("common.currency")}`,
                })}
              </p>
            )}
            {payments.map((pay) => (
              <div key={pay.id} className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-end">
                <label className="md:col-span-4 block text-[11px] font-semibold text-app-muted">
                  {t("forms.paymentAccount")}
                  <select
                    value={pay.account_id}
                    onChange={(e) => updatePayment(pay.id, { account_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
                  >
                    <option value="">{t("common.select")}</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.type})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="md:col-span-2 block text-[11px] font-semibold text-app-muted">
                  {t("forms.paymentAmount")}
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={pay.amount || ""}
                    onChange={(e) =>
                      updatePayment(pay.id, { amount: Number(e.target.value) || 0 })
                    }
                    className="mt-1 w-full rounded-lg border px-2 py-1.5 font-mono text-sm"
                  />
                </label>
                <label className="md:col-span-2 block text-[11px] font-semibold text-app-muted">
                  {t("common.date")}
                  <input
                    type="date"
                    value={pay.payment_date}
                    onChange={(e) => updatePayment(pay.id, { payment_date: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="md:col-span-3 block text-[11px] font-semibold text-app-muted">
                  {t("common.notes")}
                  <input
                    type="text"
                    value={pay.note}
                    onChange={(e) => updatePayment(pay.id, { note: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
                  />
                </label>
                <div className="md:col-span-1 flex justify-end pb-0.5">
                  <button
                    type="button"
                    onClick={() => removePaymentRow(pay.id)}
                    className="rounded-lg p-1.5 text-app-muted hover:bg-rose-500/10 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="app-card grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-app-muted">{t("forms.purchaseTotal")}</span>
              <span className="font-mono font-bold">{grandTotal.toFixed(2)} AZN</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">{t("forms.totalPaid")}</span>
              <span className="font-mono font-bold text-emerald-600">{totalPaid.toFixed(2)} AZN</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">{t("invoice.remainingDebt")}</span>
              <span className="font-mono font-bold text-rose-600">{debt.toFixed(2)} AZN</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">{t("common.status")}</span>
              <span className="font-semibold">{status}</span>
            </div>
          </div>
        </div>

        <label className="app-card block p-4 text-xs font-semibold text-app">
          {t("common.notes")}
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal"
          />
        </label>

        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-app px-4 py-2.5 text-xs font-semibold text-app"
            >
              {t("common.cancel")}
            </button>
          )}
          <button
            type="button"
            disabled={saving || !canSavePurchase}
            onClick={handleSubmit}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving
              ? t("common.saving")
              : isEdit
                ? t("forms.saveChanges")
                : t("forms.confirmWarehouseEntry")}
          </button>
        </div>
      </div>

      {showSupplierModal && (
        <QuickAddSupplierModal
          onClose={() => setShowSupplierModal(false)}
          onCreated={handleSupplierCreated}
        />
      )}

      {quickAddProductRowId && (
        <QuickAddProductModal
          onClose={() => setQuickAddProductRowId(null)}
          onCreated={(product) => {
            handleProductCreated(product, quickAddProductRowId);
            setQuickAddProductRowId(null);
          }}
        />
      )}

      <ToastMessage message={toastMessage} />
    </>
  );
}
