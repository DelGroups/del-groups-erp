"use client";

import React, { useEffect, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import ToastMessage from "@/components/ui/ToastMessage";
import { useToast } from "@/hooks/useToast";

interface DeliveryTimeModalProps {
  isOpen: boolean;
  documentLabel: string;
  documentNumber: string;
  onConfirm: (deliveryDueAtIso: string) => void;
  onCancel: () => void;
  loading?: boolean;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Default: current time + 2 hours, rounded to next 15 minutes. */
export function getDefaultDeliveryDueLocal(): string {
  const date = new Date();
  date.setHours(date.getHours() + 2);
  const minutes = Math.ceil(date.getMinutes() / 15) * 15;
  date.setMinutes(minutes % 60);
  if (minutes >= 60) {
    date.setHours(date.getHours() + 1);
  }
  date.setSeconds(0, 0);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function localDatetimeToIso(localValue: string): string {
  return new Date(localValue).toISOString();
}

export default function DeliveryTimeModal({
  isOpen,
  documentLabel,
  documentNumber,
  onConfirm,
  onCancel,
  loading = false,
}: DeliveryTimeModalProps) {
  const { t } = useI18n();
  const { message: toastMessage, variant: toastVariant, showError: showToastError } = useToast();
  const [localValue, setLocalValue] = useState(getDefaultDeliveryDueLocal);

  useEffect(() => {
    if (isOpen) {
      setLocalValue(getDefaultDeliveryDueLocal());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localValue) return;
    const parsed = new Date(localValue);
    if (Number.isNaN(parsed.getTime())) {
      showToastError(t("modals.deliveryTime.invalidDateTime"));
      return;
    }
    onConfirm(parsed.toISOString());
  };

  return (
    <>
    <div className="fixed inset-0 z-[10001] flex items-center justify-center app-scrim p-4">
      <div className="app-modal w-full max-w-md">
        <div className="flex items-start justify-between border-b border-app px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-indigo-100 p-2">
              <CalendarClock className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-app">{t("modals.deliveryTime.title")}</h3>
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

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <p className="text-xs text-app-muted">{t("modals.deliveryTime.description")}</p>

          <label className="block text-xs font-semibold text-app">
            {t("modals.deliveryTime.label")}
            <input
              type="datetime-local"
              required
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-app px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>

          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="rounded-lg border border-app px-4 py-2 text-xs font-semibold text-app hover:bg-app-card-hover disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-[image:var(--app-gradient)] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {loading ? t("common.sending") : t("warehouseSend.send")}
            </button>
          </div>
        </form>
      </div>
    </div>
      <ToastMessage message={toastMessage} variant={toastVariant} />
    </>
  );
}
