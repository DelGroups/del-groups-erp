export type GlobalDiscountMode = "percent" | "amount";

export function calcGlobalDiscountAmount(
  netAfterLineDiscounts: number,
  mode: GlobalDiscountMode,
  value: number
): number {
  const net = Math.max(0, Number(netAfterLineDiscounts) || 0);
  const raw = Math.max(0, Number(value) || 0);
  if (raw <= 0 || net <= 0) return 0;

  if (mode === "percent") {
    const pct = Math.min(raw, 100);
    return Math.round((net * pct) / 100 * 100) / 100;
  }

  return Math.min(raw, net);
}
