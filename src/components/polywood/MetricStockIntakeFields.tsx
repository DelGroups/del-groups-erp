"use client";

import React, { useMemo } from "react";
import {
  buildMetricLengths,
  totalMetricMeters,
  type MetricReceiveMode,
} from "@/lib/polywood/metricReceive";
import { useI18n } from "@/i18n/I18nProvider";

export interface MetricIntakeValue {
  mode: MetricReceiveMode;
  fullBarCount: number;
  customLengths: string;
}

interface MetricStockIntakeFieldsProps {
  value: MetricIntakeValue;
  standardLengthM: number;
  disabled?: boolean;
  onChange: (value: MetricIntakeValue) => void;
  onTotalMetersChange?: (totalMeters: number) => void;
}

export default function MetricStockIntakeFields({
  value,
  standardLengthM,
  disabled = false,
  onChange,
  onTotalMetersChange,
}: MetricStockIntakeFieldsProps) {
  const { t } = useI18n();

  const totalMeters = useMemo(() => {
    const lengths = buildMetricLengths(
      value.mode,
      value.fullBarCount,
      value.customLengths,
      standardLengthM
    );
    return totalMetricMeters(lengths);
  }, [value, standardLengthM]);

  React.useEffect(() => {
    onTotalMetersChange?.(totalMeters);
  }, [onTotalMetersChange, totalMeters]);

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {t("metricIntake.title")}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...value, mode: "full_bars" })}
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
            value.mode === "full_bars"
              ? "bg-blue-600 text-white"
              : "border border-slate-200 bg-white text-slate-600 hover:bg-blue-50"
          }`}
        >
          {t("metricIntake.fullBars")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...value, mode: "custom_pieces" })}
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
            value.mode === "custom_pieces"
              ? "bg-blue-600 text-white"
              : "border border-slate-200 bg-white text-slate-600 hover:bg-blue-50"
          }`}
        >
          {t("metricIntake.customPieces")}
        </button>
      </div>

      {value.mode === "full_bars" ? (
        <label className="block text-[10px] font-semibold text-slate-600">
          {t("metricIntake.fullBarCount", { length: standardLengthM.toFixed(1) })}
          <input
            type="number"
            min="0"
            step="1"
            disabled={disabled}
            value={value.fullBarCount || ""}
            onChange={(e) =>
              onChange({ ...value, fullBarCount: Math.max(0, Number(e.target.value) || 0) })
            }
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs"
          />
        </label>
      ) : (
        <label className="block text-[10px] font-semibold text-slate-600">
          {t("metricIntake.customLengthsHint")}
          <input
            type="text"
            disabled={disabled}
            value={value.customLengths}
            onChange={(e) => onChange({ ...value, customLengths: e.target.value })}
            placeholder="4.0, 4.0, 2.5, 1.5"
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs font-mono"
          />
        </label>
      )}

      <p className="text-[10px] text-slate-500">
        {t("metricIntake.totalMeters")}:{" "}
        <span className="font-mono font-bold text-slate-800">{totalMeters.toFixed(2)} m</span>
      </p>
    </div>
  );
}
