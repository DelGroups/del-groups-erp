export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseMetricBarLengthM(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return parsed > 0 ? parsed : 4;
}

export function meterPriceToBarPrice(meterPrice: number, barLengthM: number): number {
  if (barLengthM <= 0) return 0;
  return roundMoney(meterPrice * barLengthM);
}

export function barPriceToMeterPrice(barPrice: number, barLengthM: number): number {
  if (barLengthM <= 0) return 0;
  return roundMoney(barPrice / barLengthM);
}

export function resolveMetricLinePrices(
  unitPrice: number,
  barLengthM: number,
  mode: "linear_m" | "full_sheet" | null | undefined = "linear_m"
): { perMeter: number; perBar: number } {
  if (barLengthM <= 0 || unitPrice <= 0) {
    return { perMeter: unitPrice, perBar: unitPrice };
  }
  if (mode === "full_sheet") {
    return {
      perMeter: roundMoney(unitPrice / barLengthM),
      perBar: roundMoney(unitPrice),
    };
  }
  return {
    perMeter: roundMoney(unitPrice),
    perBar: meterPriceToBarPrice(unitPrice, barLengthM),
  };
}
