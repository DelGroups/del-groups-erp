import { LENGTH_EPSILON } from "@/lib/polywood/constants";

export interface MetricProductPricing {
  sell_price?: number | null;
  sell_price_cut?: number | null;
  base_length?: number | null;
  full_sheet_length_m?: number | null;
}

export function resolveBarLengthM(product: MetricProductPricing | null | undefined): number {
  const fromBase = Number(product?.base_length);
  if (fromBase > 0) return fromBase;
  const fromSheet = Number(product?.full_sheet_length_m);
  if (fromSheet > 0) return fromSheet;
  return 4;
}

/** True when requested length is an exact multiple of the standard bar (e.g. 4m, 8m, 12m). */
export function isWholeBarMeterQuantity(
  requestedM: number,
  barLengthM: number,
  epsilon = LENGTH_EPSILON
): boolean {
  if (requestedM <= 0 || barLengthM <= 0) return false;
  const bars = requestedM / barLengthM;
  const rounded = Math.round(bars);
  return rounded > 0 && Math.abs(bars - rounded) <= epsilon;
}

export function resolveMetricSellPricePerMeter(
  product: MetricProductPricing | null | undefined,
  requestedM: number
): number {
  const wholeBarPrice = Number(product?.sell_price) || 0;
  const cutPrice = Number(product?.sell_price_cut);
  const cutPriceResolved = cutPrice > 0 ? cutPrice : wholeBarPrice;
  const barLengthM = resolveBarLengthM(product);

  if (isWholeBarMeterQuantity(requestedM, barLengthM)) {
    return wholeBarPrice;
  }
  return cutPriceResolved;
}

export function resolvePolywoodLineUnitPrice(
  product: MetricProductPricing | null | undefined,
  requestedM: number,
  mode: "linear_m" | "full_sheet" | null | undefined
): number {
  const barLengthM = resolveBarLengthM(product);
  if (mode === "full_sheet") {
    const perMeter = resolveMetricSellPricePerMeter(product, barLengthM);
    return Math.round(perMeter * barLengthM * 100) / 100;
  }
  const perMeter = resolveMetricSellPricePerMeter(product, requestedM);
  return Math.round(perMeter * 100) / 100;
}
