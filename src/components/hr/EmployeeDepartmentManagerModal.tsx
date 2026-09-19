"use client";

import React, { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import Button from "@/components/ui/button";
import type { EmployeeDepartmentRow } from "@/lib/hr/employeeDepartments";
import { slugifyDepartmentCode } from "@/lib/hr/employeeDepartments";
import {
  createEmployeeDepartmentAction,
  deleteEmployeeDepartmentAction,
  updateEmployeeDepartmentAction,
} from "@/lib/actions/employeeDepartments";
import { useI18n } from "@/i18n/I18nProvider";

interface EmployeeDepartmentManagerModalProps {
  isOpen: boolean;
  departments: EmployeeDepartmentRow[];
  onClose: () => void;
  onUpdated: () => void;
}

export default function EmployeeDepartmentManagerModal({
  isOpen,
  departments,
  onClose,
  onUpdated,
}: EmployeeDepartmentManagerModalProps) {
  const { t } = useI18n();
  const [list, setList] = useState(departments);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ name: "", code: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", code: "", sort_order: 0 });

  useEffect(() => {
    if (!isOpen) return;
    setList(departments);
    setError(null);
    setEditingId(null);
    setCreateForm({ name: "", code: "" });
  }, [isOpen, departments]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createForm.name.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    const result = await createEmployeeDepartmentAction({
      name,
      code: createForm.code.trim() || undefined,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (result.data) setList((prev) => [...prev, result.data!].sort(sortDepartments));
    setCreateForm({ name: "", code: "" });
    onUpdated();
  };

  const startEdit = (row: EmployeeDepartmentRow) => {
    setEditingId(row.id);
    setEditForm({ name: row.name, code: row.code, sort_order: row.sort_order });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    const result = await updateEmployeeDepartmentAction(editingId, {
      name: editForm.name,
      code: editForm.code,
      sort_order: editForm.sort_order,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    if (result.data) {
      setList((prev) =>
        prev.map((row) => (row.id === editingId ? result.data! : row)).sort(sortDepartments)
      );
    }
    setEditingId(null);
    onUpdated();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("employees.departments.deleteConfirm"))) return;
    setSaving(true);
    setError(null);
    const result = await deleteEmployeeDepartmentAction(id);
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setList((prev) => prev.filter((row) => row.id !== id));
    if (editingId === id) setEditingId(null);
    onUpdated();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center app-scrim p-4">
      <div className="app-modal flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <h3 className="font-bold text-app">{t("employees.departments.title")}</h3>
          <button type="button" onClick={onClose} className="text-app-muted hover:text-app">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error ? (
            <p className="rounded-lg border border-[var(--erp-color-danger-border)] bg-[var(--erp-color-danger-bg)] px-3 py-2 text-xs text-[var(--erp-color-danger)]">
              {error}
            </p>
          ) : null}

          <form onSubmit={handleCreate} className="space-y-2 rounded-xl border border-app p-3">
            <p className="text-xs font-semibold text-app">{t("employees.departments.add")}</p>
            <input
              required
              value={createForm.name}
              onChange={(e) =>
                setCreateForm((prev) => ({
                  ...prev,
                  name: e.target.value,
                  code: prev.code || slugifyDepartmentCode(e.target.value),
                }))
              }
              placeholder={t("employees.departments.namePlaceholder")}
              className="app-input w-full text-sm"
            />
            <input
              value={createForm.code}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, code: e.target.value }))}
              placeholder={t("employees.departments.codePlaceholder")}
              className="app-input w-full font-mono text-sm"
            />
            <Button type="submit" size="sm" disabled={saving}>
              <Plus className="h-3.5 w-3.5" />
              {t("common.add")}
            </Button>
          </form>

          <ul className="divide-y divide-app rounded-xl border border-app">
            {list.length === 0 ? (
              <li className="p-4 text-center text-xs text-app-muted">
                {t("employees.departments.empty")}
              </li>
            ) : (
              list.map((row) =>
                editingId === row.id ? (
                  <li key={row.id} className="space-y-2 p-3">
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="app-input w-full text-sm"
                    />
                    <input
                      value={editForm.code}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, code: e.target.value }))}
                      className="app-input w-full font-mono text-sm"
                    />
                    <input
                      type="number"
                      value={editForm.sort_order}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          sort_order: Number(e.target.value) || 0,
                        }))
                      }
                      className="app-input w-full text-sm"
                    />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => void handleSaveEdit()} disabled={saving}>
                        {t("common.save")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        appearance="outline"
                        onClick={() => setEditingId(null)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </li>
                ) : (
                  <li key={row.id} className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-app">{row.name}</p>
                      <p className="font-mono text-[11px] text-app-muted">{row.code}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded-lg p-2 text-app-muted hover:bg-app-card-hover"
                        onClick={() => startEdit(row)}
                        aria-label={t("common.edit")}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-[var(--erp-color-danger)] hover:bg-[var(--erp-color-danger-bg)]"
                        onClick={() => void handleDelete(row.id)}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                )
              )
            )}
          </ul>
        </div>

        <div className="border-t border-app px-5 py-3 text-right">
          <Button type="button" appearance="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function sortDepartments(a: EmployeeDepartmentRow, b: EmployeeDepartmentRow) {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}
