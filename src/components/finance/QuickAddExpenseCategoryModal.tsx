"use client";

import React, { useState } from "react";
import { Save, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { quickCreateExpenseCategoryAction } from "@/lib/actions/finance";
import type { ExpenseCategoryOption } from "@/lib/finance/financialCategories";
import { formatRpcError } from "@/lib/forms/rpcErrors";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

interface QuickAddExpenseCategoryModalProps {
  onClose: () => void;
  onCreated: (category: ExpenseCategoryOption) => void;
}

export default function QuickAddExpenseCategoryModal({
  onClose,
  onCreated,
}: QuickAddExpenseCategoryModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const { message: toastMessage, variant: toastVariant, showError } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      showError(t("expenses.categoryNameRequired"));
      return;
    }

    setSaving(true);
    const result = await quickCreateExpenseCategoryAction(trimmed);
    setSaving(false);

    if (!result.success || !result.data) {
      showError(formatRpcError(result.error, t));
      return;
    }

    onCreated(result.data);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center app-scrim p-4">
        <div className="app-modal w-full max-w-md">
          <div className="flex items-center justify-between border-b border-app px-5 py-4">
            <h3 className="text-sm font-bold text-app">{t("forms.quickAddExpenseCategoryTitle")}</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-app-muted hover:bg-app-card-hover"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
            <label className="block font-semibold text-app">
              {t("expenses.categoryName")}
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("forms.expenseLabelPlaceholder")}
                className="mt-1 w-full rounded-lg border border-app px-3 py-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-app px-4 py-2 font-semibold text-app"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </form>
        </div>
      </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
