"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Employee, LeaveType } from "@/types/database.types";
import { calcLeaveDays } from "@/types/database.types";
import { useI18n } from "@/i18n/I18nProvider";

interface LeaveFormModalProps {
  isOpen: boolean;
  employees: Employee[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    employeeId: string;
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    notes: string;
  }) => void | Promise<void>;
}

export default function LeaveFormModal({
  isOpen,
  employees,
  saving,
  onClose,
  onSubmit,
}: LeaveFormModalProps) {
  const { t } = useI18n();
  const [employeeId, setEmployeeId] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("PAID");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setEmployeeId(employees[0]?.id || "");
    setLeaveType("PAID");
    setStartDate("");
    setEndDate("");
    setNotes("");
  }, [isOpen, employees]);

  if (!isOpen) return null;

  const daysCount = startDate && endDate ? calcLeaveDays(startDate, endDate) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl app-card shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="font-bold text-app">{t("employees.leaves.newTitle")}</h3>
          <button type="button" onClick={onClose} className="text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit({ employeeId, leaveType, startDate, endDate, notes });
          }}
          className="space-y-4 p-5"
        >
          <label className="block text-xs font-semibold text-app">
            {t("employees.employee")} *
            <select
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="app-input mt-1 text-sm"
            >
              <option value="">{t("common.select")}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold text-app">
            {t("employees.leaves.type")}
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
              className="app-input mt-1 text-sm"
            >
              <option value="PAID">{t("employees.leaves.typePaid")}</option>
              <option value="UNPAID">{t("employees.leaves.typeUnpaid")}</option>
              <option value="SICK">{t("employees.leaves.typeSick")}</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-app">
              {t("employees.leaves.startDate")} *
              <input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-app">
              {t("employees.leaves.endDate")} *
              <input
                required
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              />
            </label>
          </div>

          {daysCount > 0 && (
            <p className="rounded-lg bg-app-card-hover px-3 py-2 text-xs font-semibold text-app">
              {t("employees.leaves.daysCount", { count: daysCount })}
            </p>
          )}

          <label className="block text-xs font-semibold text-app">
            {t("common.notes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-xs font-semibold">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !employeeId || daysCount <= 0}
              className="rounded-lg bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
