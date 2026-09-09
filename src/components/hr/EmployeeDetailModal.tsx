"use client";

import React from "react";
import { X } from "lucide-react";
import type { Employee } from "@/types/database.types";
import { getDepartmentLabel, getEmployeeStatusLabel } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

interface EmployeeDetailModalProps {
  employee: Employee | null;
  onClose: () => void;
  onEdit?: () => void;
}

export default function EmployeeDetailModal({
  employee,
  onClose,
  onEdit,
}: EmployeeDetailModalProps) {
  const { t } = useI18n();
  if (!employee) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl app-card shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="font-bold text-app">{employee.full_name}</h3>
            <p className="font-mono text-[11px] text-app-muted">{employee.employee_code}</p>
          </div>
          <button type="button" onClick={onClose} className="text-app-muted hover:text-app">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 p-5 text-xs">
          <Detail label={t("employees.role")} value={employee.role || "—"} />
          <Detail label={t("employees.department")} value={getDepartmentLabel(employee.department)} />
          <Detail label={t("common.status")} value={getEmployeeStatusLabel(employee.status)} />
          <Detail label={t("common.phone")} value={employee.phone || "—"} />
          <Detail label={t("employees.finCode")} value={employee.fin_code || "—"} />
          <Detail label={t("employees.emergencyPhone")} value={employee.emergency_phone || "—"} />
          <Detail label={t("employees.iban")} value={employee.iban || "—"} className="col-span-2 font-mono" />
          <Detail label={t("employees.bankName")} value={employee.bank_name || "—"} className="col-span-2" />
          <Detail label={t("employees.hireDate")} value={employee.hire_date || "—"} />
          <Detail label={t("employees.contractEnd")} value={employee.contract_end_date || "—"} />
          <Detail
            label={t("employees.baseSalary")}
            value={`${employee.base_salary.toFixed(2)} ${t("common.currency")}`}
            className="font-mono font-bold"
          />
          <Detail
            label={t("employees.commissionPercent")}
            value={`%${employee.default_commission.toFixed(1)}`}
            className="font-mono text-app-accent"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-app px-5 py-4">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg border px-4 py-2 text-xs font-semibold text-app"
            >
              {t("employees.editEmployee")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-semibold text-white"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase text-app-muted">{label}</p>
      <p className={`mt-0.5 font-semibold text-app ${className}`}>{value}</p>
    </div>
  );
}
