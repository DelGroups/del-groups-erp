"use client";

import React, { useMemo, useState } from "react";
import { Factory, X } from "lucide-react";
import {
  createProductionOrderAction,
  type CreateProductionOrderInput,
  type ProductionLookups,
} from "@/lib/actions/production";
import {
  PRODUCTION_CREATION_TYPES,
  legacyFromProductionModel,
  productionCreationTypeToModel,
  type ProductionCreationType,
} from "@/lib/production/models";
import type { ProductionOrder } from "@/lib/production/types";
import type { Supplier } from "@/types/database.types";

interface Props {
  open: boolean;
  lookups: ProductionLookups | null;
  onClose: () => void;
  onCreated: (order: ProductionOrder) => void;
}

function customerLabel(customer: ProductionLookups["customers"][number]) {
  return customer.full_name || customer.name || customer.company_name || "";
}

function supplierLabel(supplier: Supplier) {
  return supplier.company_name || supplier.full_name || supplier.code || "Podratçı";
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

function nullIfEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export default function ProductionOrderModal({ open, lookups, onClose, onCreated }: Props) {
  const [projectName, setProjectName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [productionType, setProductionType] = useState<ProductionCreationType>("internal_custom");
  const [bomId, setBomId] = useState("");
  const [subcontractorId, setSubcontractorId] = useState("");
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
  const selectedBom = useMemo(
    () => (lookups?.boms || []).find((row) => row.id === bomId) || null,
    [lookups?.boms, bomId]
  );
  const selectedSupplier = useMemo(
    () => (lookups?.suppliers || []).find((row) => row.id === subcontractorId) || null,
    [lookups?.suppliers, subcontractorId]
  );

  if (!open) return null;

  const reset = () => {
    setProjectName("");
    setCustomerId("");
    setProductionType("internal_custom");
    setBomId("");
    setSubcontractorId("");
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

  const handleProductionTypeChange = (value: ProductionCreationType) => {
    setProductionType(value);
    setBomId("");
    setSubcontractorId("");
  };

  const buildPayload = (): CreateProductionOrderInput | { error: string } => {
    const name = projectName.trim();
    if (!name) return { error: "Layihə adı tələb olunur" };
    if (!customerId) return { error: "Müştəri seçilməlidir" };

    const price = typeof totalPrice === "number" ? totalPrice : Number(totalPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return { error: "Layihə qiyməti sıfırdan böyük olmalıdır" };
    }
    if (requiresAdvanceAccount && !advanceAccountId.trim()) {
      return { error: "İlkin ödəniş üçün kassa/bank hesabı seçilməlidir" };
    }
    if (productionType === "bom_series" && !bomId) {
      return { error: "BOM / Resept seçilməlidir" };
    }
    if (productionType === "contractor_outsource" && !subcontractorId) {
      return { error: "Podratçı şirkət / usta seçilməlidir" };
    }

    const customer = lookups?.customers.find((row) => row.id === customerId);
    const warehouse = destinationWarehouses.find((row) => row.id === warehouseId);
    const model = productionCreationTypeToModel(productionType);
    const legacy = legacyFromProductionModel(model);
    const resolvedWarehouseId = nullIfEmpty(warehouseId);

    const base: CreateProductionOrderInput = {
      production_model: model,
      production_type: productionType,
      type: legacy.type,
      custom_workflow: legacy.custom_workflow,
      project_name: name,
      customer_id: customerId,
      customer_name: customer ? customerLabel(customer) : null,
      notes: notes.trim() || null,
      total_project_price: price,
      expected_delivery_date: nullIfEmpty(expectedDeliveryDate),
      warehouse_id: resolvedWarehouseId,
      warehouse_name: warehouse?.name || null,
      raw_material_warehouse_id: resolvedWarehouseId,
      furniture_warehouse_id: resolvedWarehouseId,
      advance_payment: advanceAmount,
      advance_account_id: requiresAdvanceAccount ? nullIfEmpty(advanceAccountId) : null,
    };

    if (productionType === "bom_series" && selectedBom) {
      return {
        ...base,
        finished_product_id: selectedBom.finished_product_id,
      };
    }

    if (productionType === "contractor_outsource" && selectedSupplier) {
      const contractorName = supplierLabel(selectedSupplier);
      return {
        ...base,
        subcontractor_id: subcontractorId,
        contractor: {
          contractor_id: subcontractorId,
          contractor_name: contractorName,
        },
      };
    }

    return base;
  };

  const handleSave = async () => {
    const payload = buildPayload();
    if ("error" in payload) {
      setError(payload.error);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await createProductionOrderAction(payload);
      if (!result.success || !result.data) {
        setError(result.error || "Sənəd yaradılmadı");
        return;
      }
      reset();
      onCreated(result.data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err && "message" in err
            ? String((err as { message?: unknown }).message)
            : "Naməlum xəta baş verdi";
      setError(message);
    } finally {
      setSaving(false);
    }
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

            <label className="block text-sm sm:col-span-2">
              <FieldLabel required>İstehsalat növü</FieldLabel>
              <select
                className="input-field w-full"
                value={productionType}
                onChange={(e) => handleProductionTypeChange(e.target.value as ProductionCreationType)}
              >
                {PRODUCTION_CREATION_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {productionType === "bom_series" ? (
              <label className="block text-sm sm:col-span-2">
                <FieldLabel required>BOM / Resept seçin</FieldLabel>
                <select
                  className="input-field w-full"
                  value={bomId}
                  onChange={(e) => setBomId(e.target.value)}
                >
                  <option value="">Resept seçin...</option>
                  {(lookups?.boms || []).map((bom) => (
                    <option key={bom.id} value={bom.id}>
                      {bom.name} ({bom.items.length} material)
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {productionType === "contractor_outsource" ? (
              <label className="block text-sm sm:col-span-2">
                <FieldLabel required>Podratçı şirkət / Usta</FieldLabel>
                <select
                  className="input-field w-full"
                  value={subcontractorId}
                  onChange={(e) => setSubcontractorId(e.target.value)}
                >
                  <option value="">Podratçı seçin...</option>
                  {(lookups?.suppliers || []).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplierLabel(supplier)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

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

            <label className="block text-sm sm:col-span-2">
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
