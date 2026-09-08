"use client";

import React, { useCallback, useEffect, useState } from "react";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { useI18n } from "@/i18n/I18nProvider";
import {
  createFinancialCategoryAction,
  deleteFinancialCategoryAction,
  fetchFinancialCategoryTreeAction,
  updateFinancialCategoryAction,
} from "@/lib/actions/finance";
import type { FinancialCategoryTreeNode } from "@/lib/finance/financialCategories";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import { FolderTree, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";

interface Props {
  canManage: boolean;
  onChanged?: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

type EditorMode = "create-parent" | "create-child" | "edit";

export default function ExpenseCategoriesManager({
  canManage,
  onChanged,
  onError,
  onSuccess,
}: Props) {
  const { t } = useI18n();
  const [tree, setTree] = useState<FinancialCategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create-parent");
  const [editingNode, setEditingNode] = useState<FinancialCategoryTreeNode | null>(null);
  const [parentPresetId, setParentPresetId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FinancialCategoryTreeNode | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadTree = useCallback(async () => {
    setLoading(true);
    const result = await fetchFinancialCategoryTreeAction();
    if (!result.success || !result.data) {
      onError(result.error || t("common.error"));
      setTree([]);
    } else {
      setTree(result.data);
    }
    setLoading(false);
  }, [onError, t]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const parentOptions = tree.filter((node) => !node.parent_id);

  const openCreateParent = () => {
    setEditorMode("create-parent");
    setEditingNode(null);
    setParentPresetId(null);
    setName("");
    setParentId("");
    setEditorOpen(true);
  };

  const openCreateChild = (parent: FinancialCategoryTreeNode) => {
    setEditorMode("create-child");
    setEditingNode(null);
    setParentPresetId(parent.id);
    setName("");
    setParentId(parent.id);
    setEditorOpen(true);
  };

  const openEdit = (node: FinancialCategoryTreeNode) => {
    setEditorMode("edit");
    setEditingNode(node);
    setParentPresetId(null);
    setName(node.name);
    setParentId(node.parent_id || "");
    setEditorOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);

    const trimmed = name.trim();
    if (!trimmed) {
      setSaving(false);
      onError(t("expenses.categoryNameRequired"));
      return;
    }

    if (editorMode === "edit" && editingNode) {
      const result = await updateFinancialCategoryAction({
        categoryId: editingNode.id,
        name: trimmed,
        parentId: parentId || null,
      });
      setSaving(false);
      if (!result.success) {
        onError(formatRpcError(result.error, t));
        return;
      }
      onSuccess(t("expenses.categoryUpdateSuccess"));
    } else {
      const result = await createFinancialCategoryAction({
        name: trimmed,
        parentId: editorMode === "create-child" ? parentPresetId || parentId : null,
        type: "EXPENSE",
      });
      setSaving(false);
      if (!result.success) {
        onError(formatRpcError(result.error, t));
        return;
      }
      onSuccess(t("expenses.categoryCreateSuccess"));
    }

    setEditorOpen(false);
    void loadTree();
    onChanged?.();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await deleteFinancialCategoryAction(deleteTarget.id);
    setDeleting(false);
    if (!result.success) {
      onError(formatRpcError(result.error, t));
      return;
    }
    onSuccess(
      result.data?.softDeleted
        ? t("expenses.categorySoftDeleteSuccess")
        : t("expenses.categoryDeleteSuccess")
    );
    setDeleteTarget(null);
    void loadTree();
    onChanged?.();
  };

  const renderNode = (node: FinancialCategoryTreeNode, depth = 0) => {
    const isParent = node.children.length > 0;
    return (
      <React.Fragment key={node.id}>
        <tr className="border-t border-app hover:bg-app-card-hover">
          <td className="px-4 py-3" style={{ paddingLeft: `${16 + depth * 24}px` }}>
            <div className="flex items-center gap-2">
              {isParent ? <FolderTree className="h-4 w-4 text-amber-500" /> : null}
              <span className={isParent ? "font-bold text-app" : "text-app"}>{node.name}</span>
              {!node.is_active ? (
                <span className="rounded-full bg-app-card-hover px-2 py-0.5 text-[10px] text-app-muted">
                  {t("expenses.inactiveCategory")}
                </span>
              ) : null}
            </div>
          </td>
          <td className="px-4 py-3 text-xs text-app-muted">
            {isParent ? t("expenses.parentCategory") : t("expenses.subcategory")}
          </td>
          <td className="px-4 py-3">
            {canManage ? (
              <div className="flex justify-end gap-1.5">
                {!node.parent_id ? (
                  <button
                    type="button"
                    title={t("expenses.addSubcategory")}
                    onClick={() => openCreateChild(node)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("expenses.addSubcategoryShort")}
                  </button>
                ) : null}
                <button
                  type="button"
                  title={t("common.edit")}
                  onClick={() => openEdit(node)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title={t("common.delete")}
                  onClick={() => setDeleteTarget(node)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span className="text-app-muted">—</span>
            )}
          </td>
        </tr>
        {node.children.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-app">{t("expenses.categoriesTabTitle")}</h3>
          <p className="text-xs text-app-muted">{t("expenses.categoriesTabDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadTree()}
            className="rounded-lg border p-2 hover:bg-app-card-hover"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          {canManage ? (
            <button type="button" onClick={openCreateParent} className="btn-primary text-xs">
              <Plus className="h-4 w-4" />
              {t("expenses.addParentCategory")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="app-table-wrap">
        {loading ? (
          <div className="p-8 text-center text-sm text-app-muted">{t("common.loading")}</div>
        ) : tree.length === 0 ? (
          <div className="p-8 text-center text-sm text-app-muted">{t("expenses.emptyCategories")}</div>
        ) : (
          <table className="app-table">
            <thead className="border-b border-app bg-app-card-hover text-xs uppercase text-app-muted">
              <tr>
                <th className="px-4 py-3 text-left">{t("expenses.categoryName")}</th>
                <th className="px-4 py-3 text-left">{t("expenses.categoryLevel")}</th>
                <th className="px-4 py-3 text-right">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>{tree.map((node) => renderNode(node))}</tbody>
          </table>
        )}
      </div>

      {editorOpen ? (
        <div className="app-modal-overlay">
          <div className="app-modal w-full max-w-md">
            <div className="app-modal-header flex items-center justify-between">
              <h3 className="font-bold text-app">
                {editorMode === "edit"
                  ? t("expenses.editCategoryTitle")
                  : editorMode === "create-child"
                    ? t("expenses.addSubcategoryTitle")
                    : t("expenses.addParentCategoryTitle")}
              </h3>
              <button type="button" onClick={() => setEditorOpen(false)} className="text-app-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4 p-6">
              <label className="block text-sm">
                <span className="text-app-muted">{t("expenses.categoryName")}</span>
                <input
                  className="input-field mt-1 w-full"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              {editorMode === "edit" ? (
                <label className="block text-sm">
                  <span className="text-app-muted">{t("expenses.parentCategoryOptional")}</span>
                  <select
                    className="input-field mt-1 w-full"
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                  >
                    <option value="">{t("expenses.noParentCategory")}</option>
                    {parentOptions
                      .filter((node) => node.id !== editingNode?.id)
                      .map((node) => (
                        <option key={node.id} value={node.id}>{node.name}</option>
                      ))}
                  </select>
                </label>
              ) : null}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => setEditorOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn-primary text-xs" disabled={saving}>
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteModal
        open={Boolean(deleteTarget)}
        loading={deleting}
        message={t("expenses.categoryDeleteConfirm")}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
