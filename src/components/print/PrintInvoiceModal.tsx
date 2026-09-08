"use client";

import React from "react";
import { Building2, FileText, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { PrintMode } from "@/lib/print/types";

interface PrintInvoiceModalProps {
  open: boolean;
  docNo?: string;
  officialOnly?: boolean;
  onClose: () => void;
  onSelect: (mode: PrintMode) => void;
}

export default function PrintInvoiceModal({
  open,
  docNo,
  officialOnly = false,
  onClose,
  onSelect,
}: PrintInvoiceModalProps) {
  const { t } = useI18n();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-app">{t("print.modal.title")}</h3>
            {docNo ? (
              <p className="mt-0.5 font-mono text-xs text-app-muted">{docNo}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-app-muted hover:bg-app-card-hover"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <p className="text-xs text-app-muted">
            {officialOnly ? t("print.modal.officialOnlySubtitle") : t("print.modal.subtitle")}
          </p>

          <button
            type="button"
            onClick={() => onSelect("official")}
            className="flex w-full items-start gap-3 rounded-xl border border-app bg-app-card-hover p-4 text-left transition hover:border-app-accent hover:shadow-sm"
          >
            <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <Building2 className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-bold text-app">{t("print.modal.officialTitle")}</span>
              <span className="mt-1 block text-xs text-app-muted">{t("print.modal.officialDesc")}</span>
            </span>
          </button>

          {!officialOnly ? (
            <button
              type="button"
              onClick={() => onSelect("unofficial")}
              className="flex w-full items-start gap-3 rounded-xl border border-app bg-white p-4 text-left transition hover:border-slate-400 hover:shadow-sm"
            >
              <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <FileText className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-bold text-app">{t("print.modal.unofficialTitle")}</span>
                <span className="mt-1 block text-xs text-app-muted">{t("print.modal.unofficialDesc")}</span>
              </span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
