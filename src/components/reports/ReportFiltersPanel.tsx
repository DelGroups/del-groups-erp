"use client";

import React from "react";
import { Calendar, Filter, RefreshCw } from "lucide-react";
import { DATE_PRESET_LABELS, getDateRangeBounds } from "@/lib/reports/dateRange";
import type { Category, ReportDatePreset, ReportFilters, Warehouse } from "@/types/database.types";
import type { EmployeeOption } from "@/types/database.types";

interface ReportFiltersPanelProps {
  filters: ReportFilters;
  warehouses: Warehouse[];
  categories: Category[];
  employees: EmployeeOption[];
  loading?: boolean;
  onChange: (filters: ReportFilters) => void;
  onApply: () => void;
  showWarehouse?: boolean;
  showCategory?: boolean;
  showEmployee?: boolean;
}

const presets: ReportDatePreset[] = ["today", "week", "month", "custom"];

export default function ReportFiltersPanel({
  filters,
  warehouses,
  categories,
  employees,
  loading,
  onChange,
  onApply,
  showWarehouse = true,
  showCategory = true,
  showEmployee = true,
}: ReportFiltersPanelProps) {
  const setPreset = (preset: ReportDatePreset) => {
    const bounds = getDateRangeBounds(preset, filters.startDate, filters.endDate);
    onChange({
      ...filters,
      datePreset: preset,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
    });
  };

  return (
    <div className="app-card app-card-elevated p-4">
      <div className="mb-4 flex items-center gap-2">
        <Filter className="h-4 w-4 text-app-accent" />
        <h3 className="text-sm font-bold text-app">Hesabat filtrləri</h3>
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase text-app-muted">Tarix aralığı</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setPreset(preset)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filters.datePreset === preset
                    ? "bg-[image:var(--app-gradient)] text-white"
                    : "bg-app-card-hover text-app-muted hover:bg-app-card-hover"
                }`}
              >
                {DATE_PRESET_LABELS[preset]}
              </button>
            ))}
          </div>
        </div>

        {filters.datePreset === "custom" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-xs font-semibold text-app">
              Başlanğıc
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => onChange({ ...filters, startDate: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              Bitmə
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => onChange({ ...filters, endDate: e.target.value })}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {showWarehouse && (
            <label className="block text-xs font-semibold text-app">
              Anbar
              <select
                value={filters.warehouseId}
                onChange={(e) => onChange({ ...filters, warehouseId: e.target.value })}
                className="app-input mt-1 text-sm"
              >
                <option value="">Hamısı</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showCategory && (
            <label className="block text-xs font-semibold text-app">
              Kateqoriya
              <select
                value={filters.category}
                onChange={(e) => onChange({ ...filters, category: e.target.value })}
                className="app-input mt-1 text-sm"
              >
                <option value="">Hamısı</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showEmployee && (
            <label className="block text-xs font-semibold text-app">
              Satıcı / İşçi
              <select
                value={filters.employeeId}
                onChange={(e) => onChange({ ...filters, employeeId: e.target.value })}
                className="app-input mt-1 text-sm"
              >
                <option value="">Hamısı</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-app pt-3">
          <p className="flex items-center gap-1 text-[11px] text-app-muted">
            <Calendar className="h-3.5 w-3.5" />
            {filters.startDate} — {filters.endDate}
          </p>
          <button
            type="button"
            onClick={onApply}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Hesabatı yenilə
          </button>
        </div>
      </div>
    </div>
  );
}
