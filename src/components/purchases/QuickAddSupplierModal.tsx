"use client";

import React, { useState } from "react";
import { Save, X } from "lucide-react";
import { createSupplier } from "@/lib/suppliers/api";
import type { Supplier } from "@/types/database.types";

interface QuickAddSupplierModalProps {
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
}

export default function QuickAddSupplierModal({ onClose, onCreated }: QuickAddSupplierModalProps) {
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const result = await createSupplier({
      full_name: fullName,
      company_name: companyName,
      phone,
    });
    setSaving(false);

    if (!result.ok || !result.supplier) {
      alert("Xəta: " + (result.error || "Təchizatçı yaradılmadı"));
      return;
    }

    onCreated(result.supplier);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-md">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="text-sm font-bold text-app">Təchizatçı əlavə et</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
          <label className="block font-semibold text-app">
            Ad / Soyad *
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block font-semibold text-app">
            Şirkət adı
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="block font-semibold text-app">
            Telefon
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-app px-4 py-2 font-semibold text-app"
            >
              Ləğv et
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saxlanılır..." : "Yadda saxla"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
