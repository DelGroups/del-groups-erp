"use client";

import React from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface ConfirmDeleteModalProps {
  open: boolean;
  title?: string;
  message?: string;
  itemName?: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDeleteModal({
  open,
  title,
  message,
  itemName,
  confirmLabel,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) {
  const { t } = useI18n();

  if (!open) return null;

  const resolvedTitle = title ?? t("common.deleteConfirmTitle");
  const resolvedMessage =
    message ??
    (itemName ? t("common.confirmDelete", { name: itemName }) : t("common.deleteConfirmMessage"));

  return (
    <div className="fixed inset-0 z-[10003] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-md overflow-hidden">
        <div className="flex items-start justify-between border-b border-app px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h3 className="text-sm font-bold text-app">{resolvedTitle}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg p-1.5 text-app-muted hover:bg-app-card-hover disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-app-muted">{resolvedMessage}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={loading} className="btn-secondary text-xs">
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {loading ? t("common.deleting") : confirmLabel ?? t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
