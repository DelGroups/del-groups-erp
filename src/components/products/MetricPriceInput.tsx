"use client";

import {
  barPriceToMeterPrice,
  meterPriceToBarPrice,
  parseMetricBarLengthM,
} from "@/lib/polywood/metricPriceConversion";
import { useI18n } from "@/i18n/I18nProvider";

interface MetricPriceInputProps {
  label: string;
  meterValue: string;
  barLengthM: number;
  entryByBar: boolean;
  onMeterChange: (value: string) => void;
}

export default function MetricPriceInput({
  label,
  meterValue,
  barLengthM,
  entryByBar,
  onMeterChange,
}: MetricPriceInputProps) {
  const { t } = useI18n();
  const barLength = parseMetricBarLengthM(barLengthM);
  const meterPrice = parseFloat(meterValue) || 0;
  const barPrice = meterPriceToBarPrice(meterPrice, barLength);
  const displayValue = entryByBar ? (barPrice > 0 ? String(barPrice) : "") : meterValue;

  const handleChange = (raw: string) => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      onMeterChange("");
      return;
    }
    if (entryByBar) {
      onMeterChange(String(barPriceToMeterPrice(parsed, barLength)));
      return;
    }
    onMeterChange(raw);
  };

  return (
    <label className="block text-xs font-semibold text-app">
      {label}{" "}
      {entryByBar ? `(${t("forms.pricePerBarShort")})` : `(${t("forms.pricePerMeterShort")})`}
      <input
        type="number"
        step="0.01"
        min="0"
        value={displayValue}
        onChange={(event) => handleChange(event.target.value)}
        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
      />
      {!entryByBar && meterPrice > 0 && barLength > 0 ? (
        <p className="mt-1 text-[11px] font-normal text-app-muted">
          {t("forms.barPriceFromMeterHint", {
            length: barLength.toFixed(1),
            barPrice: barPrice.toFixed(2),
          })}
        </p>
      ) : null}
      {entryByBar && barPrice > 0 && barLength > 0 ? (
        <p className="mt-1 text-[11px] font-normal text-app-muted">
          {t("forms.meterPriceFromBarHint", {
            length: barLength.toFixed(1),
            meterPrice: meterPrice.toFixed(2),
          })}
        </p>
      ) : null}
    </label>
  );
}
