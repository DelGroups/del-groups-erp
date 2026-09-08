"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import { createProductionOrderAction, type ProductionLookups } from "@/lib/actions/production";
import { PRODUCTION_MODEL_DEFAULT } from "@/lib/production/models";
import type { ProductionOrder } from "@/lib/production/types";

interface Props {
  open: boolean;
  lookups: ProductionLookups | null;
  onClose: () => void;
  onCreated: (order: ProductionOrder) => void;
}

function customerLabel(customer: ProductionLookups["customers"][number]) {
  return customer.full_name || customer.name || customer.company_name || "";
}

export default function ProductionOrderModal({ open, lookups, onClose, onCreated }: Props) {
  const [projectName, setProjectName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [totalPrice, setTotalPrice] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setProjectName("");
    setCustomerId("");
    setNotes("");
    setTotalPrice(0);
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

    setSaving(true);
    setError(null);
    const customer = lookups?.customers.find((row) => row.id === customerId);
    const result = await createProductionOrderAction({
      production_model: PRODUCTION_MODEL_DEFAULT,
      type: "Custom",
      custom_workflow: "in_house",
      project_name: name,
      customer_id: customerId || null,
      customer_name: customer ? customerLabel(customer) : null,
      notes: notes.trim() || null,
      total_project_price: totalPrice,
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
      <div className="app-modal w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <div>
            <h3 className="font-bold text-app">Yeni istehsalat sifarişi</h3>
            <p className="text-xs text-app-muted">Qaralama — yalnız ümumi məlumat</p>
          </div>
          <button type="button" onClick={handleClose} className="rounded p-1 hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {error ? <p className="rounded-lg alert-danger px-3 py-2 text-sm">{error}</p> : null}

          <label className="block text-sm">
            <span className="text-app-muted">Layihə adı</span>
            <input
              className="input-field mt-1 w-full"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              autoFocus
            />
          </label>

          <label className="block text-sm">
            <span className="text-app-muted">Müştəri</span>
            <select
              className="input-field mt-1 w-full"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">—</option>
              {(lookups?.customers || []).map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customerLabel(customer)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-app-muted">Layihə qiyməti</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input-field mt-1 w-full"
              value={totalPrice || ""}
              onChange={(e) => setTotalPrice(Number(e.target.value))}
            />
          </label>

          <label className="block text-sm">
            <span className="text-app-muted">Qeydlər</span>
            <textarea
              className="input-field mt-1 w-full"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-app px-4 py-3">
          <button type="button" className="btn-secondary" disabled={saving} onClick={handleClose}>
            Ləğv et
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saxlanır..." : "Saxla"}
          </button>
        </div>
      </div>
    </div>
  );
}
