"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, FolderPlus, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Category } from "@/types/database.types";
import { createCategory, deleteCategory, updateCategory } from "@/lib/products/api";

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
  const [list, setList] = useState<Category[]>(categories);
  const [form, setForm] = useState({ name: "", parent_id: "" });
  const [editing, setEditing] = useState<{ id: string; name: string; parent_id: string }>({
    id: "",
    name: "",
    parent_id: "",
  });
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setList(categories);
    const defaults: Record<string, boolean> = {};
    for (const cat of categories) {
      if (!cat.parent_id) defaults[cat.id] = true;
    }
    setExpandedParents(defaults);
  }, [categories]);

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

    if (!result.category) return;

    setList((prev) => [...prev, result.category!]);
    setExpandedParents((prev) => ({
      ...prev,
      ...(result.category?.parent_id ? { [result.category.parent_id]: true } : { [result.category!.id]: true }),
    }));
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
    setList((prev) => prev.filter((cat) => cat.id !== id && cat.parent_id !== id));
    if (editing.id === id) {
      setEditing({ id: "", name: "", parent_id: "" });
    }
    onUpdated();
  };

  const handleStartEdit = (cat: Category) => {
    setEditing({
      id: cat.id,
      name: cat.name,
      parent_id: cat.parent_id || "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editing.id || !editing.name.trim()) return;
    if (editing.id === editing.parent_id) {
      alert("Kateqoriya özünə parent ola bilməz.");
      return;
    }
    const result = await updateCategory(editing.id, {
      name: editing.name,
      parent_id: editing.parent_id || null,
    });
    if (!result.ok || !result.category) {
      alert("Xəta: " + result.error);
      return;
    }
    setList((prev) => prev.map((cat) => (cat.id === editing.id ? result.category! : cat)));
    setExpandedParents((prev) => ({
      ...prev,
      ...(result.category?.parent_id ? { [result.category.parent_id]: true } : {}),
    }));
    setEditing({ id: "", name: "", parent_id: "" });
    onUpdated();
  };

  const topLevelCategories = useMemo(
    () => [...list].filter((cat) => !cat.parent_id).sort((a, b) => a.name.localeCompare(b.name)),
    [list]
  );

  const childrenMap = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const cat of list) {
      if (!cat.parent_id) continue;
      const arr = map.get(cat.parent_id) || [];
      arr.push(cat);
      map.set(cat.parent_id, arr);
    }
    for (const [key, value] of map.entries()) {
      map.set(key, value.sort((a, b) => a.name.localeCompare(b.name)));
    }
    return map;
  }, [list]);

  const parentOptions = topLevelCategories;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center app-scrim p-4">
      <div className="app-modal flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden">
        <div className="app-modal-header">
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
                {parentOptions.map((c) => (
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
                className="flex items-center gap-1 rounded-lg bg-[image:var(--app-gradient)] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
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
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {list.length === 0 ? (
                <div className="p-4 text-center text-xs text-app-muted">Kateqoriya yoxdur</div>
              ) : (
                topLevelCategories.map((parent) => {
                  const children = childrenMap.get(parent.id) || [];
                  const expanded = expandedParents[parent.id] ?? true;
                  return (
                    <div key={parent.id} className="border-b border-app last:border-0">
                      <div className="flex items-center justify-between px-2.5 py-2 text-xs hover:bg-app-card-hover">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedParents((prev) => ({ ...prev, [parent.id]: !expanded }))
                          }
                          className="flex items-center gap-1.5 font-semibold text-app"
                        >
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
                          />
                          {parent.name}
                          <span className="text-[10px] text-app-muted">({children.length})</span>
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(parent)}
                            className="p-1 text-app-muted hover:text-blue-600"
                            title="Düzəliş et"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(parent.id)}
                            className="p-1 text-rose-500 hover:text-rose-700"
                            title="Sil"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {expanded && children.length > 0 ? (
                        <div className="pb-1 pl-8 pr-2">
                          {children.map((child) => (
                            <div
                              key={child.id}
                              className="mb-1 flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-app-card-hover"
                            >
                              <span className="text-app-muted">{child.name}</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(child)}
                                  className="p-1 text-app-muted hover:text-blue-600"
                                  title="Düzəliş et"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(child.id)}
                                  className="p-1 text-rose-500 hover:text-rose-700"
                                  title="Sil"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {editing.id ? (
            <div className="space-y-3 rounded-xl border border-app bg-app-card-hover p-4">
              <h4 className="text-xs font-bold uppercase text-app">Kateqoriya düzəlişi</h4>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing((prev) => ({ ...prev, name: e.target.value }))}
                  className="app-input text-xs"
                />
                <select
                  value={editing.parent_id}
                  onChange={(e) => setEditing((prev) => ({ ...prev, parent_id: e.target.value }))}
                  className="app-input text-xs"
                >
                  <option value="">Ana kateqoriya (yoxdur)</option>
                  {parentOptions
                    .filter((cat) => cat.id !== editing.id)
                    .map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing({ id: "", name: "", parent_id: "" })}
                  className="rounded-lg border border-app px-3 py-1.5 text-xs font-semibold text-app"
                >
                  Ləğv et
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="rounded-lg bg-[image:var(--app-gradient)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                >
                  Yadda saxla
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
