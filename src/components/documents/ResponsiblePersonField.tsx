"use client";

import React from "react";
import { Lock } from "lucide-react";
import {
  useResponsiblePerson,
  type EmployeeLike,
} from "@/hooks/useResponsiblePerson";
import { EntityLookup } from "@/components/lookups";
import { useUiStandard } from "@/design-system/components";
import { useI18n } from "@/i18n/I18nProvider";

interface ResponsiblePersonFieldProps {
  employees: EmployeeLike[];
  /** Effective employee id — see `useResponsiblePerson` for locked forms. */
  value: string;
  onChange: (employeeId: string, displayName: string) => void;
  placeholder?: string;
  className?: string;
}

function employeeName(employee: EmployeeLike): string {
  return employee.full_name || employee.name || "Adsız əməkdaş";
}

/**
 * Employee picker for document headers. Sales reps are pinned to their own
 * name; Admins and Managers may select another active employee as issuer.
 */
export default function ResponsiblePersonField({
  employees,
  value,
  onChange,
  placeholder = "-- Əməkdaş seçin --",
  className = "",
}: ResponsiblePersonFieldProps) {
  const { locked, lockedEmployeeId, lockedName } = useResponsiblePerson(employees);
  // UI_STANDARD (UI-2 lookups): the free choice goes through EntityLookup (employee quick-create).
  const uiStandard = useUiStandard();
  const { t } = useI18n();

  const baseClass = `w-full rounded-lg border border-app bg-app-card-hover p-2 font-semibold ${className}`;

  if (locked) {
    return (
      <div className="space-y-1">
        {lockedEmployeeId ? (
          <select
            value={lockedEmployeeId}
            disabled
            className={`${baseClass} text-app-muted`}
          >
            <option value={lockedEmployeeId}>{lockedName}</option>
          </select>
        ) : (
          <input
            type="text"
            value={lockedName}
            readOnly
            className={`${baseClass} text-app-muted`}
          />
        )}
        <p className="flex items-center gap-1 text-[10px] font-semibold text-app-muted">
          <Lock className="h-3 w-3 shrink-0" />
          Satış nümayəndəsi yalnız öz adınıza təyin olunur
        </p>
      </div>
    );
  }

  if (uiStandard) {
    const current = employees.find((employee) => employee.id === value);
    return (
      <EntityLookup
        entity="employee"
        value={value}
        selectedLabel={current ? employeeName(current) : undefined}
        placeholder={placeholder}
        className={className}
        aria-label={t("lookup.entities.employee")}
        onChange={(id, row) => onChange(id ?? "", row ? String(row.full_name || row.name || "") : "")}
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        const selected = employees.find((employee) => employee.id === e.target.value);
        onChange(e.target.value, selected ? employeeName(selected) : "");
      }}
      className={baseClass}
    >
      <option value="">{placeholder}</option>
      {employees.map((employee) => (
        <option key={employee.id} value={employee.id}>
          {employeeName(employee)}
        </option>
      ))}
    </select>
  );
}
