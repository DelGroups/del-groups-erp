"use client";

import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface MaterialShortageConfirmModalProps {
  open: boolean;
  available: number;
  deficit: number;
  unit: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function MaterialShortageConfirmModal({
  open,
  available,
  deficit,
  unit,
  loading = false,
  onConfirm,
  onCancel,
}: MaterialShortageConfirmModalProps) {
  const { t } = useI18n();

  if (!open) return null;

  const formatQty = (value: number) => {
    if (unit.toLowerCase().includes("m") && !unit.includes("²")) {
      return value.toFixed(2).replace(/\.00$/, "");
    }
    return String(Math.round(value * 100) / 100);
  };

  return (
    <div className="fixed inset-0 z-[10003] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-lg overflow-hidden">
        <div className="flex items-start justify-between border-b border-app px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h3 className="text-sm font-bold text-app">{t("production.workflow.shortageConfirmTitle")}</h3>
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
          <p className="text-sm text-app-muted">
            {t("production.workflow.shortageConfirmMessage", {
              available: formatQty(available),
              deficit: formatQty(deficit),
              unit,
            })}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={loading} className="btn-secondary text-xs">
              {t("production.workflow.shortageConfirmNo")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="btn-primary text-xs"
            >
              {loading ? t("common.saving") : t("production.workflow.shortageConfirmYes")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
