"use client";

import React, { useState } from "react";
import { Save, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Customer } from "@/types/database.types";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

interface QuickAddCustomerModalProps {
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}

export default function QuickAddCustomerModal({ onClose, onCreated }: QuickAddCustomerModalProps) {
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      showError("Müştəri adını daxil edin");
      return;
    }

    setSaving(true);
    const code = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
    const { data, error } = await supabase
      .from("customers")
      .insert([
        {
          code,
          full_name: fullName.trim(),
          company_name: companyName.trim() || null,
          phone: phone.trim() || null,
          balance: 0,
        },
      ])
      .select("*")
      .single();
    setSaving(false);

    if (error || !data) {
      showError("Xəta: " + (error?.message || "Müştəri yaradılmadı"));
      return;
    }

    onCreated(data as Customer);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
        <div className="app-modal w-full max-w-md">
          <div className="flex items-center justify-between border-b border-app px-5 py-4">
            <h3 className="text-sm font-bold text-app">Yeni Müştəri</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover"
            >
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
                className="app-input mt-1"
              />
            </label>
            <label className="block font-semibold text-app">
              Şirkət adı
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="app-input mt-1"
              />
            </label>
            <label className="block font-semibold text-app">
              Telefon
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="app-input mt-1"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn-secondary">Ləğv et</button>
              <button type="submit" disabled={saving} className="btn-primary">
                <Save className="h-4 w-4" />
                {saving ? "Yaradılır..." : "Saxla"}
              </button>
            </div>
          </form>
        </div>
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
