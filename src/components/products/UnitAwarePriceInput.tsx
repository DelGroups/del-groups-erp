"use client";

import {
  entryPriceFromMeter,
  entryPriceFromPiece,
  meterPriceFromEntry,
  piecePriceFromEntry,
  type PriceEntryUnit,
  resolveMeterHintPrice,
  resolvePieceHintPrice,
} from "@/lib/products/productPriceUnits";
import { parseMetricBarLengthM } from "@/lib/polywood/metricPriceConversion";
import { formInputClass, formLabelClass, formSelectClass } from "@/components/ui/form-field-styles";
import { useI18n } from "@/i18n/I18nProvider";

interface UnitAwarePriceInputProps {
  label: string;
  storedValue: string;
  entryUnit: PriceEntryUnit;
  onEntryUnitChange: (unit: PriceEntryUnit) => void;
  onStoredValueChange: (value: string) => void;
  barLengthM: number;
  widthM: number;
  storageMode: "per_meter" | "per_piece";
}

const PRICE_UNITS: PriceEntryUnit[] = ["meter", "piece", "square_meter"];

export default function UnitAwarePriceInput({
  label,
  storedValue,
  entryUnit,
  onEntryUnitChange,
  onStoredValueChange,
  barLengthM,
  widthM,
  storageMode,
}: UnitAwarePriceInputProps) {
  const { t } = useI18n();
  const barLength = parseMetricBarLengthM(barLengthM);
  const width = widthM > 0 ? widthM : 0;
  const stored = parseFloat(storedValue) || 0;

  const displayValue =
    storageMode === "per_meter"
      ? entryPriceFromMeter(stored, entryUnit, barLength, width)
      : entryPriceFromPiece(stored, entryUnit, barLength, width);

  const handleValueChange = (raw: string) => {
    if (raw.trim() === "") {
      onStoredValueChange("");
      return;
    }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      onStoredValueChange("");
      return;
    }
    const nextStored =
      storageMode === "per_meter"
        ? meterPriceFromEntry(parsed, entryUnit, barLength, width)
        : piecePriceFromEntry(parsed, entryUnit, barLength, width);
    onStoredValueChange(String(nextStored));
  };

  const hintParams = {
    entryPrice: displayValue,
    entryUnit,
    barLengthM: barLength,
    widthM: width,
  };
  const meterHint = resolveMeterHintPrice(hintParams);
  const pieceHint = resolvePieceHintPrice(hintParams);

  let hint: string | null = null;
  if (entryUnit === "meter" && pieceHint !== null && barLength > 0) {
    hint = t("forms.priceHintMeterEntry", {
      length: barLength.toFixed(2),
      piecePrice: pieceHint.toFixed(2),
    });
  } else if (entryUnit === "piece" && meterHint !== null && barLength > 0) {
    hint = t("forms.priceHintPieceEntry", {
      meterPrice: meterHint.toFixed(2),
    });
  } else if (entryUnit === "square_meter" && meterHint !== null && width > 0) {
    hint = t("forms.priceHintSquareMeterEntry", {
      meterPrice: meterHint.toFixed(2),
      width: width.toFixed(2),
    });
  }

  return (
    <div>
      <label className={formLabelClass}>{label}</label>
      <div className="flex gap-2">
        <input
          type="number"
          step="0.01"
          min="0"
          value={storedValue.trim() === "" ? "" : String(displayValue)}
          onChange={(event) => handleValueChange(event.target.value)}
          className={`${formInputClass} min-w-0 flex-1`}
        />
        <select
          value={entryUnit}
          onChange={(event) => onEntryUnitChange(event.target.value as PriceEntryUnit)}
          className={`${formSelectClass} w-[7.5rem] shrink-0`}
        >
          {PRICE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit === "meter"
                ? t("forms.priceUnitMeter")
                : unit === "piece"
                  ? t("forms.priceUnitPiece")
                  : t("forms.priceUnitSquareMeter")}
            </option>
          ))}
        </select>
      </div>
      {hint ? <p className="mt-1 text-xs font-normal text-slate-700 dark:text-app-muted">{hint}</p> : null}
    </div>
  );
}
