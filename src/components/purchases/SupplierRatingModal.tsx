"use client";

import React, { useState } from "react";
import { Star, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface SupplierRatingModalProps {
  supplierName: string;
  saving?: boolean;
  onSkip: () => void;
  onSubmit: (scores: { qualityScore: number; deliverySpeedScore: number }) => void | Promise<void>;
}

function StarPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-app">
      {label}
      <div className="mt-1 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            className="rounded p-0.5 hover:bg-amber-50"
            aria-label={`${star}`}
          >
            <Star
              className={`h-6 w-6 ${
                star <= value ? "fill-amber-400 text-amber-500" : "text-slate-300"
              }`}
            />
          </button>
        ))}
        <span className="ml-2 font-mono text-sm text-app-muted">{value}/5</span>
      </div>
    </label>
  );
}

export default function SupplierRatingModal({
  supplierName,
  saving,
  onSkip,
  onSubmit,
}: SupplierRatingModalProps) {
  const { t } = useI18n();
  const [qualityScore, setQualityScore] = useState(5);
  const [deliverySpeedScore, setDeliverySpeedScore] = useState(5);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center app-scrim p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl app-card shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-5 py-4">
          <div>
            <h3 className="font-bold text-app">{t("purchases.rateSupplierTitle")}</h3>
            <p className="text-[11px] text-app-muted">{supplierName}</p>
          </div>
          <button type="button" onClick={onSkip} className="text-app-muted" disabled={saving}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-xs text-app">{t("purchases.rateSupplierHint")}</p>
          <StarPicker
            label={t("purchases.qualityScore")}
            value={qualityScore}
            onChange={setQualityScore}
          />
          <StarPicker
            label={t("purchases.deliverySpeedScore")}
            value={deliverySpeedScore}
            onChange={setDeliverySpeedScore}
          />
          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <button
              type="button"
              onClick={onSkip}
              disabled={saving}
              className="rounded-lg border px-4 py-2 text-xs font-semibold"
            >
              {t("purchases.rateSkip")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSubmit({ qualityScore, deliverySpeedScore })}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? t("purchases.rateSaving") : t("purchases.rateConfirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
