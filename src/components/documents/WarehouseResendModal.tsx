"use client";

import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface WarehouseResendModalProps {
  isOpen: boolean;
  documentLabel: string;
  documentNumber: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function WarehouseResendModal({
  isOpen,
  documentLabel,
  documentNumber,
  onConfirm,
  onCancel,
  loading = false,
}: WarehouseResendModalProps) {
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="app-modal w-full max-w-md">
        <div className="flex items-start justify-between border-b border-app px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-100 p-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-app">{t("modals.warehouseResend.title")}</h3>
              <p className="mt-1 text-xs text-app-muted">
                {documentLabel}: <span className="font-mono font-semibold">{documentNumber}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-app-muted hover:text-app-muted"
            disabled={loading}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 text-sm text-app">{t("modals.warehouseResend.body")}</div>

        <div className="flex justify-end gap-2 border-t border-app px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-app px-4 py-2 text-xs font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {loading ? t("common.sending") : t("modals.warehouseResend.confirmYes")}
          </button>
        </div>
      </div>
    </div>
  );
}
