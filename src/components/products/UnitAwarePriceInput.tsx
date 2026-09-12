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
import {
  formInputGroupClass,
  formNumberInputClass,
  formSelectClass,
} from "@/components/ui/form-field-styles";
import { FormField } from "@/components/ui/form-field";
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
    <FormField label={label} hint={hint}>
      <div className={formInputGroupClass}>
        <input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={storedValue.trim() === "" ? "" : String(displayValue)}
          onChange={(event) => handleValueChange(event.target.value)}
          className={formNumberInputClass}
        />
        <select
          value={entryUnit}
          onChange={(event) => onEntryUnitChange(event.target.value as PriceEntryUnit)}
          className={formSelectClass}
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
    </FormField>
  );
}
