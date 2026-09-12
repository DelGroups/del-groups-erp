import { roundMoney } from "@/lib/polywood/metricPriceConversion";

export type PriceEntryUnit = "meter" | "piece" | "square_meter";

export const PRODUCT_MEASURE_UNITS = ["Metr", "Ədəd", "Kvadrat Metr"] as const;
export type ProductMeasureUnit = (typeof PRODUCT_MEASURE_UNITS)[number];

export function measureUnitLabel(unit: string): string {
  if (unit === "Metr") return "Metr (m)";
  if (unit === "Kvadrat Metr") return "Kvadrat Metr (m²)";
  return "Ədəd";
}

export function isMetricMeasureUnit(unit: string): boolean {
  return unit === "Metr" || unit === "Kvadrat Metr";
}

/** Canonical storage for dimensional products is AZN per linear meter. */
export function meterPriceFromEntry(
  entryPrice: number,
  entryUnit: PriceEntryUnit,
  barLengthM: number,
  widthM: number
): number {
  if (!Number.isFinite(entryPrice) || entryPrice < 0) return 0;
  switch (entryUnit) {
    case "meter":
      return roundMoney(entryPrice);
    case "piece":
      return barLengthM > 0 ? roundMoney(entryPrice / barLengthM) : 0;
    case "square_meter":
      return widthM > 0 ? roundMoney(entryPrice * widthM) : 0;
    default:
      return roundMoney(entryPrice);
  }
}

export function entryPriceFromMeter(
  meterPrice: number,
  entryUnit: PriceEntryUnit,
  barLengthM: number,
  widthM: number
): number {
  if (!Number.isFinite(meterPrice) || meterPrice < 0) return 0;
  switch (entryUnit) {
    case "meter":
      return roundMoney(meterPrice);
    case "piece":
      return roundMoney(meterPrice * barLengthM);
    case "square_meter":
      return widthM > 0 ? roundMoney(meterPrice / widthM) : 0;
    default:
      return roundMoney(meterPrice);
  }
}

/** Canonical storage for non-dimensional piece products is AZN per Ədəd. */
export function piecePriceFromEntry(
  entryPrice: number,
  entryUnit: PriceEntryUnit,
  barLengthM: number,
  widthM: number
): number {
  if (!Number.isFinite(entryPrice) || entryPrice < 0) return 0;
  switch (entryUnit) {
    case "piece":
      return roundMoney(entryPrice);
    case "meter":
      return barLengthM > 0 ? roundMoney(entryPrice * barLengthM) : roundMoney(entryPrice);
    case "square_meter": {
      const area = barLengthM > 0 && widthM > 0 ? barLengthM * widthM : 0;
      return area > 0 ? roundMoney(entryPrice * area) : roundMoney(entryPrice);
    }
    default:
      return roundMoney(entryPrice);
  }
}

export function entryPriceFromPiece(
  piecePrice: number,
  entryUnit: PriceEntryUnit,
  barLengthM: number,
  widthM: number
): number {
  if (!Number.isFinite(piecePrice) || piecePrice < 0) return 0;
  switch (entryUnit) {
    case "piece":
      return roundMoney(piecePrice);
    case "meter":
      return barLengthM > 0 ? roundMoney(piecePrice / barLengthM) : roundMoney(piecePrice);
    case "square_meter": {
      const area = barLengthM > 0 && widthM > 0 ? barLengthM * widthM : 0;
      return area > 0 ? roundMoney(piecePrice / area) : roundMoney(piecePrice);
    }
    default:
      return roundMoney(piecePrice);
  }
}

export interface PriceHintParams {
  entryPrice: number;
  entryUnit: PriceEntryUnit;
  barLengthM: number;
  widthM: number;
}

export function resolveMeterHintPrice(params: PriceHintParams): number | null {
  const { entryPrice, entryUnit, barLengthM, widthM } = params;
  if (entryPrice <= 0) return null;
  if (entryUnit === "meter") {
    return barLengthM > 0 ? roundMoney(entryPrice / barLengthM) : null;
  }
  if (entryUnit === "piece") {
    return barLengthM > 0 ? roundMoney(entryPrice / barLengthM) : null;
  }
  if (entryUnit === "square_meter") {
    return widthM > 0 ? roundMoney(entryPrice * widthM) : null;
  }
  return null;
}

export function resolvePieceHintPrice(params: PriceHintParams): number | null {
  const { entryPrice, entryUnit, barLengthM, widthM } = params;
  if (entryPrice <= 0) return null;
  if (entryUnit === "meter") {
    return barLengthM > 0 ? roundMoney(entryPrice * barLengthM) : null;
  }
  if (entryUnit === "piece") {
    return roundMoney(entryPrice);
  }
  if (entryUnit === "square_meter") {
    const area = barLengthM > 0 && widthM > 0 ? barLengthM * widthM : 0;
    return area > 0 ? roundMoney(entryPrice * area) : null;
  }
  return null;
}

export function defaultPriceEntryUnitForMeasure(unit: string): PriceEntryUnit {
  if (unit === "Metr") return "meter";
  if (unit === "Kvadrat Metr") return "square_meter";
  return "piece";
}
