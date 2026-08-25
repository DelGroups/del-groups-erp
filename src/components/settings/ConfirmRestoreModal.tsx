"use client";

import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface ConfirmRestoreModalProps {
  open: boolean;
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmRestoreModal({
  open,
  filename,
  onConfirm,
  onCancel,
  loading,
}: ConfirmRestoreModalProps) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="app-modal-overlay">
      <div className="app-modal w-full max-w-md border-amber-500/30 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-500/15 p-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-app">{t("backup.restoreConfirmTitle")}</h3>
              <p className="mt-2 text-xs leading-relaxed text-app-muted">
                {t("backup.restoreConfirmBody")}
              </p>
              <p className="mt-2 truncate font-mono text-[11px] text-amber-300">{filename}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="btn-ghost !p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={loading} className="btn-ghost">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-app transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {loading ? t("backup.restoring") : t("backup.confirmRestore")}
          </button>
        </div>
      </div>
    </div>
  );
}
