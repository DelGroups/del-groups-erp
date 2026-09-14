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

function PriceColumn({
  title,
  sheetLabel,
  areaLabel,
  sheetValue,
  areaValue,
  onSheetChange,
  onAreaChange,
  sheetBadge,
  areaBadge,
  sheetPlaceholder,
  areaPlaceholder,
  conversionHint,
  canConvert,
}: {
  title: string;
  sheetLabel: string;
  areaLabel: string;
  sheetValue: string;
  areaValue: string;
  onSheetChange: (value: string) => void;
  onAreaChange: (value: string) => void;
  sheetBadge: string;
  areaBadge: string;
  sheetPlaceholder: string;
  areaPlaceholder: string;
  conversionHint: string | null;
  canConvert: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3 rounded-[var(--erp-radius-md)] border border-[color:var(--erp-border-default)] bg-[color:var(--erp-bg-table-header)]/40 p-3">
      <p className="text-[length:var(--erp-text-sm)] font-semibold text-[color:var(--erp-text-main)]">
        {title}
      </p>
      <div className="space-y-3">
        <PriceInputWithBadge
          label={sheetLabel}
          value={sheetValue}
          onChange={onSheetChange}
          badge={sheetBadge}
          placeholder={sheetPlaceholder}
        />
        <PriceInputWithBadge
          label={areaLabel}
          value={areaValue}
          onChange={onAreaChange}
          badge={areaBadge}
          placeholder={areaPlaceholder}
          disabled={!canConvert}
          hint={conversionHint}
        />
      </div>
    </div>
  );
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

  const sheetLabel = t("forms.sheetUnitPrice");
  const areaLabel = t("forms.meterAreaPrice");

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

  const buildHint = (pieceValue: string, areaValue: string) => {
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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <PriceColumn
        title={t("forms.purchasePriceColumn")}
        sheetLabel={sheetLabel}
        areaLabel={areaLabel}
        sheetValue={buy.pieceDisplay}
        areaValue={buy.areaDisplay}
        onSheetChange={buy.onPieceChange}
        onAreaChange={buy.onAreaChange}
        sheetBadge={pieceBadge}
        areaBadge={areaBadge}
        sheetPlaceholder={t("forms.sheetPricePlaceholder")}
        areaPlaceholder={t("forms.meterPricePlaceholder")}
        conversionHint={buildHint(buy.pieceDisplay, buy.areaDisplay)}
        canConvert={canConvert}
      />
      <PriceColumn
        title={t("forms.sellingPriceColumn")}
        sheetLabel={sheetLabel}
        areaLabel={areaLabel}
        sheetValue={sell.pieceDisplay}
        areaValue={sell.areaDisplay}
        onSheetChange={sell.onPieceChange}
        onAreaChange={sell.onAreaChange}
        sheetBadge={pieceBadge}
        areaBadge={areaBadge}
        sheetPlaceholder={t("forms.sellSheetPricePlaceholder")}
        areaPlaceholder={t("forms.sellMeterPricePlaceholder")}
        conversionHint={buildHint(sell.pieceDisplay, sell.areaDisplay)}
        canConvert={canConvert}
      />
    </div>
  );
}
