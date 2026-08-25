"use client";

import React, { useState } from "react";
import { FolderPlus, Layers, Plus, Trash2, X } from "lucide-react";
import type { Category } from "@/types/database.types";
import { createCategory, deleteCategory, getCategoryFullName } from "@/lib/products/api";

interface CategoryManagerModalProps {
  isOpen: boolean;
  categories: Category[];
  onClose: () => void;
  onUpdated: () => void;
}

export default function CategoryManagerModal({
  isOpen,
  categories,
  onClose,
  onUpdated,
}: CategoryManagerModalProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", parent_id: "" });

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    setSaving(true);
    const result = await createCategory(form.name, form.parent_id || null);
    setSaving(false);

    if (!result.ok) {
      alert("Xəta: " + result.error);
      return;
    }

    setForm({ name: "", parent_id: "" });
    onUpdated();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Bu kateqoriyanı silməyə əminsiniz?")) return;
    const result = await deleteCategory(id);
    if (!result.ok) {
      alert("Xəta: " + result.error);
      return;
    }
    onUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="app-modal flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-app bg-app-card-hover px-6 py-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-app">
            <Layers className="h-4 w-4 text-app-accent" />
            Kateqoriyaların idarəsi
          </h3>
          <button type="button" onClick={onClose} className="text-app-muted hover:text-app-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <form
            onSubmit={handleCreate}
            className="space-y-3 rounded-xl border border-app bg-app-card-hover p-4"
          >
            <h4 className="text-xs font-bold uppercase text-app">
              Yeni kateqoriya / alt kateqoriya
            </h4>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="text"
                required
                placeholder="Kateqoriya adı *"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="app-input text-xs"
              />
              <select
                value={form.parent_id}
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
                className="app-input text-xs"
              >
                <option value="">Ana kateqoriya (yoxdur)</option>
                {categories
                  .filter((c) => !c.parent_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Yadda saxla
              </button>
            </div>
          </form>

          <div className="space-y-2">
            <h4 className="flex items-center gap-1 text-xs font-bold uppercase text-app">
              <FolderPlus className="h-3.5 w-3.5" />
              Mövcud kateqoriyalar
            </h4>
            <div className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border">
              {categories.length === 0 ? (
                <div className="p-4 text-center text-xs text-app-muted">Kateqoriya yoxdur</div>
              ) : (
                categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between p-2.5 text-xs hover:bg-app-card-hover"
                  >
                    <span
                      className={`font-semibold ${cat.parent_id ? "pl-4 text-app-muted" : "text-app"}`}
                    >
                      {cat.parent_id ? "└─ " : ""}
                      {getCategoryFullName(categories, cat)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(cat.id)}
                      className="p-1 text-rose-500 hover:text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
