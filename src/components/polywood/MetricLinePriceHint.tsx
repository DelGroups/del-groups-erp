"use client";

import { resolveMetricLinePrices } from "@/lib/polywood/metricPriceConversion";
import { useI18n } from "@/i18n/I18nProvider";

interface MetricLinePriceHintProps {
  unitPrice: number;
  barLengthM: number;
  mode?: "linear_m" | "full_sheet" | null;
}

export default function MetricLinePriceHint({
  unitPrice,
  barLengthM,
  mode = "linear_m",
}: MetricLinePriceHintProps) {
  const { t } = useI18n();
  if (unitPrice <= 0 || barLengthM <= 0) return null;

  const { perMeter, perBar } = resolveMetricLinePrices(unitPrice, barLengthM, mode);

  return (
    <p className="mt-0.5 text-center text-[10px] text-app-muted">
      {t("forms.metricLinePriceHint", {
        perMeter: perMeter.toFixed(2),
        perBar: perBar.toFixed(2),
      })}
    </p>
  );
}
