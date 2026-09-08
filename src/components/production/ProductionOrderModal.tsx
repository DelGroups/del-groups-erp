"use client";

import React, { useMemo, useState } from "react";
import { Factory, X } from "lucide-react";
import { createProductionOrderAction, type ProductionLookups } from "@/lib/actions/production";
import { PRODUCTION_MODEL_DEFAULT } from "@/lib/production/models";
import type { ProductionOrder } from "@/lib/production/types";

interface Props {
  open: boolean;
  lookups: ProductionLookups | null;
  onClose: () => void;
  onCreated: (order: ProductionOrder) => void;
}

const PRODUCTION_CATEGORIES = [
  { value: "mebel", label: "Mebel" },
  { value: "polywood", label: "Polywood" },
  { value: "dekorasiya", label: "Dekorasiya" },
] as const;

function customerLabel(customer: ProductionLookups["customers"][number]) {
  return customer.full_name || customer.name || customer.company_name || "";
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-app-muted">
      {children}
      {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
    </span>
  );
}

export default function ProductionOrderModal({ open, lookups, onClose, onCreated }: Props) {
  const [projectName, setProjectName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [productionCategory, setProductionCategory] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [totalPrice, setTotalPrice] = useState<number | "">("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [advancePayment, setAdvancePayment] = useState<number | "">(0);
  const [advanceAccountId, setAdvanceAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destinationWarehouses = useMemo(
    () => (lookups?.warehouses || []).filter((row) => row.warehouse_type !== "polywood"),
    [lookups?.warehouses]
  );

  const treasuryAccounts = lookups?.accounts || [];
  const advanceAmount = typeof advancePayment === "number" ? advancePayment : 0;
  const requiresAdvanceAccount = advanceAmount > 0;

  if (!open) return null;

  const reset = () => {
    setProjectName("");
    setCustomerId("");
    setProductionCategory("");
    setWarehouseId("");
    setTotalPrice("");
    setExpectedDeliveryDate("");
    setAdvancePayment(0);
    setAdvanceAccountId("");
    setNotes("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = async () => {
    const name = projectName.trim();
    if (!name) {
      setError("Layihə adı tələb olunur");
      return;
    }
    if (!customerId) {
      setError("Müştəri seçilməlidir");
      return;
    }
    const price = typeof totalPrice === "number" ? totalPrice : Number(totalPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setError("Layihə qiyməti sıfırdan böyük olmalıdır");
      return;
    }
    if (requiresAdvanceAccount && !advanceAccountId) {
      setError("İlkin ödəniş üçün kassa/bank hesabı seçilməlidir");
      return;
    }

    setSaving(true);
    setError(null);

    const customer = lookups?.customers.find((row) => row.id === customerId);
    const warehouse = destinationWarehouses.find((row) => row.id === warehouseId);
    const categoryLabel =
      PRODUCTION_CATEGORIES.find((row) => row.value === productionCategory)?.label || null;

    const result = await createProductionOrderAction({
      production_model: PRODUCTION_MODEL_DEFAULT,
      type: "Custom",
      custom_workflow: "in_house",
      project_name: name,
      customer_id: customerId,
      customer_name: customer ? customerLabel(customer) : null,
      project_scope: categoryLabel,
      notes: notes.trim() || null,
      total_project_price: price,
      expected_delivery_date: expectedDeliveryDate || null,
      warehouse_id: warehouseId || null,
      warehouse_name: warehouse?.name || null,
      furniture_warehouse_id: warehouseId || null,
      advance_payment: advanceAmount,
      advance_account_id: requiresAdvanceAccount ? advanceAccountId : null,
    });
    setSaving(false);

    if (!result.success || !result.data) {
      setError(result.error || "Sənəd yaradılmadı");
      return;
    }

    reset();
    onCreated(result.data);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-2xl overflow-hidden">
        <div className="flex items-start justify-between border-b border-app px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-app-accent/10 text-app-accent">
              <Factory className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-lg font-bold text-app">Yeni istehsalat sifarişi</h3>
              <p className="text-sm text-app-muted">Qaralama — əsas layihə parametrləri</p>
            </div>
          </div>
          <button type="button" onClick={handleClose} className="rounded p-1 hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
          {error ? <p className="mb-4 rounded-lg alert-danger px-3 py-2 text-sm">{error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <FieldLabel required>Layihə adı</FieldLabel>
              <input
                className="input-field w-full"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Məs: Mətbəx mebel dəsti"
                autoFocus
              />
            </label>

            <label className="block text-sm">
              <FieldLabel required>Müştəri</FieldLabel>
              <select
                className="input-field w-full"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Seçin...</option>
                {(lookups?.customers || []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customerLabel(customer)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <FieldLabel>İstehsalat növü</FieldLabel>
              <select
                className="input-field w-full"
                value={productionCategory}
                onChange={(e) => setProductionCategory(e.target.value)}
              >
                <option value="">Seçin...</option>
                {PRODUCTION_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <FieldLabel>Məhsul anbarı</FieldLabel>
              <select
                className="input-field w-full"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Seçin...</option>
                {destinationWarehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <FieldLabel required>Layihə qiyməti (AZN)</FieldLabel>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="input-field w-full pr-14"
                  value={totalPrice}
                  onChange={(e) =>
                    setTotalPrice(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  placeholder="0.00"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-app-muted">
                  AZN
                </span>
              </div>
            </label>

            <label className="block text-sm">
              <FieldLabel>Gözlənilən təhvil tarixi</FieldLabel>
              <input
                type="date"
                className="input-field w-full"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              />
            </label>

            <div className="sm:col-span-2 rounded-xl border border-app bg-app-card-hover/40 p-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-app-muted">
                İlkin ödəniş
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <FieldLabel>İlkin ödəniş (AZN)</FieldLabel>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input-field w-full pr-14"
                      value={advancePayment}
                      onChange={(e) => {
                        const next = e.target.value === "" ? "" : Number(e.target.value);
                        setAdvancePayment(next);
                        if (next === "" || next <= 0) setAdvanceAccountId("");
                      }}
                      placeholder="0.00"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-app-muted">
                      AZN
                    </span>
                  </div>
                </label>

                <label className="block text-sm">
                  <FieldLabel required={requiresAdvanceAccount}>Ödəniş kassası / Bank</FieldLabel>
                  <select
                    className="input-field w-full disabled:cursor-not-allowed disabled:opacity-50"
                    value={advanceAccountId}
                    onChange={(e) => setAdvanceAccountId(e.target.value)}
                    disabled={!requiresAdvanceAccount}
                  >
                    <option value="">
                      {requiresAdvanceAccount ? "Hesab seçin..." : "İlkin ödəniş tələb olunmur"}
                    </option>
                    {treasuryAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <label className="block text-sm sm:col-span-2">
              <FieldLabel>Qeydlər / Spesifikasiya</FieldLabel>
              <textarea
                className="input-field w-full"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Texniki tələblər, ölçülər, materiallar haqqında qeydlər..."
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-app px-5 py-4">
          <button type="button" className="btn-secondary" disabled={saving} onClick={handleClose}>
            Ləğv et
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Yaradılır..." : "Sifarişi Yarat"}
          </button>
        </div>
      </div>
    </div>
  );
}
