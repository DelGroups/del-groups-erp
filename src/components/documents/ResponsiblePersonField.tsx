"use client";

import React from "react";
import { Lock } from "lucide-react";
import {
  useResponsiblePerson,
  type EmployeeLike,
} from "@/hooks/useResponsiblePerson";

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
 * Employee picker for document headers. Non-admins are pinned to their own
 * name and the control is rendered read-only. The owning form must derive the
 * submitted value from `useResponsiblePerson` so the lock cannot be bypassed.
 */
export default function ResponsiblePersonField({
  employees,
  value,
  onChange,
  placeholder = "-- Əməkdaş seçin --",
  className = "",
}: ResponsiblePersonFieldProps) {
  const { locked, lockedEmployeeId, lockedName } = useResponsiblePerson(employees);

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
          Sənədləri yalnız öz adınıza yarada bilərsiniz
        </p>
      </div>
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
