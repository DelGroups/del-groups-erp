"use client";

import { useMemo } from "react";
import PriceInputWithBadge from "@/components/products/PriceInputWithBadge";
import {
  entryPriceFromMeter,
  entryPriceFromPiece,
  meterPriceFromEntry,
  piecePriceFromEntry,
  type PriceEntryUnit,
} from "@/lib/products/productPriceUnits";
import { useI18n } from "@/i18n/I18nProvider";

interface DualUnitPriceGroupProps {
  buyStored: string;
  sellStored: string;
  onBuyChange: (value: string) => void;
  onSellChange: (value: string) => void;
  barLengthM: number;
  widthM: number;
  storageMode: "per_meter" | "per_piece";
  measureUnit: string;
}

function formatDisplay(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function useDualPrices(
  storedValue: string,
  onStoredChange: (value: string) => void,
  barLengthM: number,
  widthM: number,
  storageMode: "per_meter" | "per_piece",
  areaUnit: PriceEntryUnit
) {
  const stored = parseFloat(storedValue) || 0;

  const pieceDisplay = useMemo(() => {
    const value =
      storageMode === "per_meter"
        ? entryPriceFromMeter(stored, "piece", barLengthM, widthM)
        : entryPriceFromPiece(stored, "piece", barLengthM, widthM);
    return formatDisplay(value);
  }, [stored, storageMode, barLengthM, widthM]);

  const areaDisplay = useMemo(() => {
    const value =
      storageMode === "per_meter"
        ? entryPriceFromMeter(stored, areaUnit, barLengthM, widthM)
        : entryPriceFromPiece(stored, areaUnit, barLengthM, widthM);
    return formatDisplay(value);
  }, [stored, storageMode, barLengthM, widthM, areaUnit]);

  const onPieceChange = (raw: string) => {
    if (raw.trim() === "") {
      onStoredChange("");
      return;
    }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const nextStored =
      storageMode === "per_meter"
        ? meterPriceFromEntry(parsed, "piece", barLengthM, widthM)
        : piecePriceFromEntry(parsed, "piece", barLengthM, widthM);
    onStoredChange(String(nextStored));
  };

  const onAreaChange = (raw: string) => {
    if (raw.trim() === "") {
      onStoredChange("");
      return;
    }
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const nextStored =
      storageMode === "per_meter"
        ? meterPriceFromEntry(parsed, areaUnit, barLengthM, widthM)
        : piecePriceFromEntry(parsed, areaUnit, barLengthM, widthM);
    onStoredChange(String(nextStored));
  };

  return { pieceDisplay, areaDisplay, onPieceChange, onAreaChange };
}

export default function DualUnitPriceGroup({
  buyStored,
  sellStored,
  onBuyChange,
  onSellChange,
  barLengthM,
  widthM,
  storageMode,
  measureUnit,
}: DualUnitPriceGroupProps) {
  const { t } = useI18n();
  const areaUnit: PriceEntryUnit = measureUnit === "Kvadrat Metr" ? "square_meter" : "meter";
  const areaBadge = areaUnit === "square_meter" ? t("forms.badgeAznSqm") : t("forms.badgeAznMeter");
  const pieceBadge = t("forms.badgeAznPiece");
  const canConvert = barLengthM > 0 && (areaUnit === "meter" || widthM > 0);

  const buy = useDualPrices(
    buyStored,
    onBuyChange,
    barLengthM,
    widthM,
    storageMode,
    areaUnit
  );
  const sell = useDualPrices(
    sellStored,
    onSellChange,
    barLengthM,
    widthM,
    storageMode,
    areaUnit
  );

  const conversionHint = (pieceValue: string, areaValue: string) => {
    if (!canConvert || !pieceValue || !areaValue) return null;
    if (areaUnit === "square_meter") {
      return t("forms.priceConversionSheetToArea", {
        sheet: pieceValue,
        area: areaValue,
        length: barLengthM.toFixed(2),
        width: widthM.toFixed(2),
      });
    }
    return t("forms.priceConversionSheetToMeter", {
      sheet: pieceValue,
      meter: areaValue,
      length: barLengthM.toFixed(2),
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PriceInputWithBadge
          label={t("forms.buyPriceSheetPiece")}
          value={buy.pieceDisplay}
          onChange={buy.onPieceChange}
          badge={pieceBadge}
          hint={conversionHint(buy.pieceDisplay, buy.areaDisplay)}
        />
        <PriceInputWithBadge
          label={
            areaUnit === "square_meter"
              ? t("forms.buyPriceMeterArea")
              : t("forms.buyPriceMeterOnly")
          }
          value={buy.areaDisplay}
          onChange={buy.onAreaChange}
          badge={areaBadge}
          disabled={!canConvert}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PriceInputWithBadge
          label={t("forms.sellPriceSheetPiece")}
          value={sell.pieceDisplay}
          onChange={sell.onPieceChange}
          badge={pieceBadge}
          hint={conversionHint(sell.pieceDisplay, sell.areaDisplay)}
        />
        <PriceInputWithBadge
          label={
            areaUnit === "square_meter"
              ? t("forms.sellPriceMeterArea")
              : t("forms.sellPriceMeterOnly")
          }
          value={sell.areaDisplay}
          onChange={sell.onAreaChange}
          badge={areaBadge}
          disabled={!canConvert}
        />
      </div>
    </div>
  );
}
