"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Employee, EmployeeInsert } from "@/types/database.types";
import {
  EMPLOYEE_DEPARTMENTS,
  generateEmployeeCode,
} from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

export type EmployeeFormValues = EmployeeInsert;

interface EmployeeFormModalProps {
  isOpen: boolean;
  initial?: Employee | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (values: EmployeeFormValues) => void | Promise<void>;
}

const emptyForm = (): EmployeeFormValues => ({
  employee_code: generateEmployeeCode(),
  full_name: "",
  role: "",
  department: "general",
  phone: null,
  base_salary: 0,
  default_commission: 0,
  status: "active",
});

export default function EmployeeFormModal({
  isOpen,
  initial,
  saving,
  onClose,
  onSubmit,
}: EmployeeFormModalProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<EmployeeFormValues>(emptyForm());

  useEffect(() => {
    if (!isOpen) return;
    if (initial) {
      setForm({
        employee_code: initial.employee_code || generateEmployeeCode(),
        full_name: initial.full_name,
        role: initial.role,
        department: initial.department,
        phone: initial.phone,
        base_salary: initial.base_salary,
        default_commission: initial.default_commission,
        status: initial.status,
      });
    } else {
      setForm(emptyForm());
    }
  }, [isOpen, initial]);

  if (!isOpen) return null;

  const set = (patch: Partial<EmployeeFormValues>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl app-card shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="font-bold text-app">
            {initial ? t("modals.employee.editTitle") : t("modals.employee.newTitle")}
          </h3>
          <button type="button" onClick={onClose} className="text-app-muted hover:text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit(form);
          }}
          className="space-y-4 p-5"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-xs font-semibold text-app">
              {t("common.fullName")} *
              <input
                required
                value={form.full_name}
                onChange={(e) => set({ full_name: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("employees.role")}
              <input
                value={form.role}
                onChange={(e) => set({ role: e.target.value })}
                placeholder={t("modals.employee.rolePlaceholder")}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("employees.department")} *
              <select
                required
                value={form.department}
                onChange={(e) => set({ department: e.target.value })}
                className="app-input mt-1 text-sm"
              >
                {EMPLOYEE_DEPARTMENTS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("common.status")}
              <select
                value={form.status}
                onChange={(e) => set({ status: e.target.value })}
                className="app-input mt-1 text-sm"
              >
                <option value="active">{t("common.active")}</option>
                <option value="inactive">{t("common.inactive")}</option>
                <option value="on_leave">{t("modals.employee.statusOnLeave")}</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("common.phone")}
              <input
                value={form.phone || ""}
                onChange={(e) => set({ phone: e.target.value || null })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("modals.employee.employeeCode")}
              <input
                value={form.employee_code}
                onChange={(e) => set({ employee_code: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("employees.baseSalary")} ({t("common.currency")})
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.base_salary}
                onChange={(e) => set({ base_salary: Number(e.target.value) || 0 })}
                className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("modals.employee.defaultCommission")}
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.default_commission}
                onChange={(e) => set({ default_commission: Number(e.target.value) || 0 })}
                className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
