"use client";

import React, { useState } from "react";
import { Save, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Employee } from "@/types/database.types";
import { normalizeEmployee } from "@/types/database.types";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

interface QuickAddEmployeeModalProps {
  title?: string;
  onClose: () => void;
  onCreated: (employee: Employee) => void;
}

export default function QuickAddEmployeeModal({
  title = "Yeni Usta",
  onClose,
  onCreated,
}: QuickAddEmployeeModalProps) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Usta");
  const [saving, setSaving] = useState(false);
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      showError("Usta adını daxil edin");
      return;
    }

    setSaving(true);
    const employeeCode = `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
    const { data, error } = await supabase
      .from("employees")
      .insert([
        {
          employee_code: employeeCode,
          full_name: fullName.trim(),
          role: role.trim() || "Usta",
          department: "İstehsalat",
          phone: phone.trim() || null,
          base_salary: 0,
          default_commission: 0,
          status: "active",
        },
      ])
      .select("*")
      .single();
    setSaving(false);

    if (error || !data) {
      showError("Xəta: " + (error?.message || "Usta yaradılmadı"));
      return;
    }

    onCreated(normalizeEmployee(data as Record<string, unknown>));
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
        <div className="app-modal w-full max-w-md">
          <div className="flex items-center justify-between border-b border-app px-5 py-4">
            <h3 className="text-sm font-bold text-app">{title}</h3>
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
              Rol
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
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
